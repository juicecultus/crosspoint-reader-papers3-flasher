'use client';

// useKoboOperations - app.js's wiring, as React state.
//
// Everything that decides anything lives beside this file; this hook reads the
// profile, holds what those decisions say, and drives the cable. The page draws
// it, the way FlashPage draws useEspOperations.
//
// Two rules it keeps throughout, unchanged from the page this is a port of:
//
//   Nothing is sent to the device that has not been checked against a sha256
//   from the release manifest.
//
//   Nothing is written to the device unless the bootloader answered the board
//   revision and the panel and both matched. A bootloader that will not answer
//   is a refusal.

import { useEffect, useRef, useState } from 'react';
import useStepRunner from '@/esp/useStepRunner';
import {
  browserSupport,
  FastbootDevice,
  FastbootError,
  type BrowserSupport,
} from './fastboot.ts';
import koboLibra2 from './koboLibra2.ts';
import {
  checkDownloadSize,
  parseManifest,
  type Manifest,
  type PlannedArtefact,
} from './manifest.ts';
import {
  formatBytes,
  hasCheck,
  lockedOffers,
  offerActions,
  type Offers,
} from './offers.ts';
import {
  gateIdentity,
  getvarNames,
  type GateResult,
  type GetvarAnswer,
  type InstallWrite,
  type ProfileAction,
} from './profile.ts';
import {
  fetchArtefact,
  fetchManifestText,
  manifestUrl,
  ReleaseError,
  resolveArtefactUrl,
} from './release.ts';

export type LogKind = 'plain' | 'good' | 'bad';

export interface LogLine {
  text: string;
  kind: LogKind;
}

export type ReleaseState =
  | { status: 'loading' }
  // There is no release to send yet: the fact, not the reason.
  | { status: 'none' }
  | { status: 'error'; message: string; detail: string | null }
  | { status: 'ready'; manifest: Manifest };

export type Gates = Record<ProfileAction, GateResult>;

export type Connection =
  | { kind: 'cancelled'; message: string; detail: string }
  | { kind: 'failed'; message: string; detail: string | null }
  | { kind: 'refused'; message: string; detail: string; gates: Gates }
  | { kind: 'connected'; message: string; notes: string[]; gates: Gates };

export interface FinishNotice {
  title: string;
  steps: string[];
  expect: string;
}

export interface Failure {
  message: string;
  detail: string | null;
}

const NOT_CONNECTED_YET = 'Connect the device in step 4 first.';
const NOT_A_LIBRA =
  'The device that answered is not a Libra 2, so nothing is offered for it.';
const CONNECTION_GONE = 'The device connection is gone. Start again at step 3.';

export function useKoboOperations() {
  const profile = koboLibra2;
  const { stepData, initializeSteps, updateStepData, runStep } =
    useStepRunner();

  const [isRunning, setIsRunning] = useState(false);
  const [support, setSupport] = useState<BrowserSupport | null>(null);
  const [release, setRelease] = useState<ReleaseState>({ status: 'loading' });
  const [connection, setConnection] = useState<Connection | null>(null);
  const [offers, setOffers] = useState<Offers>(() =>
    lockedOffers(NOT_CONNECTED_YET),
  );
  const [log, setLog] = useState<LogLine[]>([]);
  const [phase, setPhase] = useState<string | null>(null);
  const [finish, setFinish] = useState<FinishNotice | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const deviceRef = useRef<FastbootDevice | null>(null);
  const getvarsRef = useRef<Record<string, GetvarAnswer>>({});
  const offersRef = useRef<Offers>(offers);
  const busyRef = useRef(false);

  const manifest = release.status === 'ready' ? release.manifest : null;

  useEffect(() => {
    offersRef.current = offers;
  }, [offers]);

  // --- step 1: the browser ---------------------------------------------------
  //
  // navigator and isSecureContext are the browser's, so this runs after mount
  // rather than during the server render.
  useEffect(() => {
    setSupport(browserSupport(navigator, window.isSecureContext));
  }, []);

  // --- step 2: the release ---------------------------------------------------

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let text: string;
      try {
        text = await fetchManifestText(manifestUrl(profile));
      } catch (err) {
        if (!alive) return;
        if (err instanceof ReleaseError && err.message === 'NO_RELEASE') {
          setRelease({ status: 'none' });
          return;
        }
        const e = err as ReleaseError;
        setRelease({
          status: 'error',
          message: e.message,
          detail: e.detail ?? null,
        });
        return;
      }

      let parsed: Manifest;
      try {
        parsed = parseManifest(text);
      } catch (err) {
        if (!alive) return;
        setRelease({
          status: 'error',
          message:
            'The release manifest could not be read, so nothing will be sent to any device.',
          detail: (err as Error).message,
        });
        return;
      }
      if (!alive) return;
      setRelease({ status: 'ready', manifest: parsed });
    };
    load();
    return () => {
      alive = false;
    };
  }, [profile]);

  // --- step 5: what is on offer ----------------------------------------------
  //
  // A device that answered and a release that carries the artefact. Either can
  // arrive first, so this is recomputed from both rather than at the end of the
  // connection.
  useEffect(() => {
    if (!connection || connection.kind !== 'connected') return;
    setOffers(offerActions(profile, manifest, connection.gates));
  }, [connection, manifest, profile]);

  // --- step 4: connect and gate ----------------------------------------------

  const connect = async () => {
    let usbDevice: USBDevice;
    try {
      usbDevice = await navigator.usb.requestDevice({
        filters: FastbootDevice.filters(profile),
      });
    } catch (err) {
      setConnection({
        kind: 'cancelled',
        message:
          'No device was picked. If the list was empty, the device is not in fastboot yet: power it fully off and run step 3 again.',
        detail: (err as Error).message,
      });
      return;
    }

    const fb = new FastbootDevice(usbDevice);
    try {
      await fb.open(profile);
    } catch (err) {
      const e = err as FastbootError;
      setConnection({
        kind: 'failed',
        message: e.message,
        detail: e.detail ?? null,
      });
      return;
    }

    deviceRef.current = fb;

    // Ask for everything the profile names, once. A refusal is an answer and is
    // recorded as one.
    const answers: Record<string, GetvarAnswer> = {};
    for (const name of getvarNames(profile)) {
      // eslint-disable-next-line no-await-in-loop
      answers[name] = await fb.tryGetvar(name);
    }
    getvarsRef.current = answers;

    const gates: Gates = {
      backup: gateIdentity(profile, 'backup', fb.description, answers),
      live: gateIdentity(profile, 'live', fb.description, answers),
      install: gateIdentity(profile, 'install', fb.description, answers),
    };

    if (!gates.live.ok) {
      setConnection({
        kind: 'refused',
        message:
          'This is not a Kobo Libra 2 running the bootloader this software was built against, so this page will not send it anything.',
        detail: `${gates.live.failed.map((c) => c.label).join(', ')} did not match.`,
        gates,
      });
      setOffers(lockedOffers(NOT_A_LIBRA));
      return;
    }

    const notes: string[] = [];
    if (gates.install.ok) {
      notes.push('Every check an install needs was answered and matched.');
    } else {
      const names = gates.install.failed.map((c) => c.label).join(', ');
      notes.push(
        `Install is not offered: ${names} did not match or was not answered. Trying InkHub Live is still safe, because it writes nothing and the image checks the board on the device before it starts anything.`,
      );
    }
    if (gates.install.declined.length > 0 || gates.live.declined.length > 0) {
      notes.push(
        'A check shown as not answered is a variable this bootloader declines to report. That is expected for some of them and it is why an install refuses when the board revision is one of them.',
      );
    }

    setConnection({
      kind: 'connected',
      message: 'Connected. The bootloader answered and this is a Libra 2.',
      notes,
      gates,
    });
  };

  // --- sending ---------------------------------------------------------------

  const say = (text: string, kind: LogKind = 'plain') => {
    setLog((lines) => [...lines, { text, kind }]);
  };

  const getBytes = async (stepName: string, artefact: PlannedArtefact) => {
    const url = resolveArtefactUrl(profile, artefact.url);
    say(`fetching ${artefact.label} from ${url}`);
    const data = await fetchArtefact({ ...artefact, url }, (p) => {
      setPhase(
        p.phase === 'download'
          ? `Downloading ${artefact.label}`
          : `Unpacking ${artefact.label}`,
      );
      // A manifest that names no unpacked size reports a total of zero, and a
      // bar over zero is not a bar. The log still says what is happening.
      if (p.total > 0) {
        updateStepData(stepName, {
          progress: { current: p.done, total: p.total },
        });
      }
    });
    say(`checksum matches, ${formatBytes(data.length)} ready`, 'good');
    return data;
  };

  const sendDownload = async (
    stepName: string,
    artefact: PlannedArtefact,
    data: Uint8Array,
  ) => {
    const device = deviceRef.current;
    if (!device) {
      throw new Error(CONNECTION_GONE);
    }
    const max = getvarsRef.current['max-download-size'];
    checkDownloadSize(data.length, max && max.value ? max.value : '');
    setPhase(`Sending ${artefact.label} to the device`);
    say(`download: ${data.length} bytes`);
    await device.download(data, (done, total) => {
      updateStepData(stepName, { progress: { current: done, total } });
    });
    say('the device took every byte', 'good');
  };

  const bootDevice = async () => {
    const device = deviceRef.current;
    if (!device) {
      throw new Error(CONNECTION_GONE);
    }
    say('boot');
    await device.boot((info) => say(`device: ${info.trim()}`));
  };

  const failed = (err: unknown) => {
    const known = err instanceof FastbootError || err instanceof ReleaseError;
    const message = known
      ? err.message
      : `${(err as Error).name}: ${(err as Error).message}`;
    const detail = known ? err.detail : null;
    setLog((lines) => {
      const next: LogLine[] = [...lines, { text: message, kind: 'bad' }];
      if (detail) next.push({ text: detail, kind: 'bad' });
      return next;
    });
    setPhase('It stopped here.');
    setFailure({ message, detail });
  };

  const startRun = () => {
    setLog([]);
    setFailure(null);
    setFinish(null);
    setIsRunning(true);
    busyRef.current = true;
  };

  const endRun = () => {
    setIsRunning(false);
    busyRef.current = false;
  };

  // The backup pass, sent the way Live is: one artefact, checked against the
  // release's own hash, downloaded to the device and RAM-booted. The device does
  // the rest on its own screen and this page never sees a byte of it back,
  // because this channel cannot read.
  const runBackup = async () => {
    if (busyRef.current) return;
    const offer = offersRef.current.backup;
    if (!offer.ok) return;
    const artefact = offer.plan.present[0];
    if (!artefact) return;

    const fetching = `Download ${artefact.label}`;
    const sending = `Send ${artefact.label} to the device`;
    const starting = 'Start the backup on the device';
    startRun();
    initializeSteps([fetching, sending, starting]);

    try {
      const data = await runStep(fetching, () => getBytes(fetching, artefact));
      await runStep(sending, () => sendDownload(sending, artefact, data));
      await runStep(starting, async () => {
        setPhase('Starting the backup on the device');
        await bootDevice();
        say('the device left fastboot to run the backup', 'good');
      });
      setPhase('The backup is running on the device. Watch its screen.');
      // What happens after the backup pass, in the words the device itself puts
      // on the glass (mainline/phase2/backup/libra2-backup section 5). The
      // button sequence is not repeated here: it is step 3 of this page,
      // written once, and the device ends up back in fastboot by the same four
      // lines it got there by.
      setFinish({
        title: 'Then put the device back into fastboot',
        steps: [
          'The device draws a line for each part as it copies it. Two to four minutes, and the cable can stay where it is.',
          'Wait for Backup complete. Everything it copied is on the device, in a folder named backup.',
          'Hold the power button until the screen goes dark.',
          'Run the four lines in step 3 again. The device cannot be put back into fastboot any other way.',
          'Press Connect to the device in step 4, then Install below.',
        ],
        expect:
          'Stopping here costs nothing. The folder is on your own card, the device is untouched otherwise, and it starts Kobo the way it always did.',
      });
    } catch (err) {
      failed(err);
    } finally {
      endRun();
    }
  };

  const runLive = async () => {
    if (busyRef.current) return;
    const offer = offersRef.current.live;
    if (!offer.ok) return;
    const artefact = offer.plan.present[0];
    if (!artefact) return;

    const fetching = `Download ${artefact.label}`;
    const sending = `Send ${artefact.label} to the device`;
    const starting = 'Start InkHub from memory';
    startRun();
    initializeSteps([fetching, sending, starting]);

    try {
      const data = await runStep(fetching, () => getBytes(fetching, artefact));
      await runStep(sending, () => sendDownload(sending, artefact, data));
      await runStep(starting, async () => {
        setPhase('Starting InkHub from memory');
        await bootDevice();
        say('the device left fastboot to run the image', 'good');
      });
      setPhase('InkHub is starting on the device. Nothing was written to it.');
      setFinish({
        title: 'Watch the screen',
        steps: [
          'Nothing shows for the first few seconds while the kernel unpacks the system.',
          'By about twenty seconds, the InkHub splash: the name on a white screen.',
          'By about a minute, the home screen: the status bar, the app tiles, and the version along the bottom.',
          'If the screen has not changed after two and a half minutes, hold the power button for about ten seconds. That is the end of the session and nothing was written.',
        ],
        expect:
          "To end a live session at any point, hold the power button until the device goes off, then power it on normally. It comes back on Kobo's own firmware, untouched.",
      });
    } catch (err) {
      failed(err);
    } finally {
      endRun();
    }
  };

  const runInstall = async () => {
    if (busyRef.current) return;
    const offer = offersRef.current.install;
    if (!offer.ok) return;

    const plan = offer.plan;
    const byName = Object.fromEntries(plan.present.map((a) => [a.name, a]));
    const writes = profile.actions.install.writes;
    const checking = hasCheck(plan);

    const nameOf = (step: InstallWrite) => ({
      fetching: `Download ${step.label}`,
      sending: `Send ${step.label} to the device`,
      writing:
        step.via === 'fastboot-flash'
          ? `Write ${step.label}`
          : 'Start the check on the device',
    });

    // The steps this run will take, named before it starts so the list does not
    // grow underneath a reader. A step the release cannot supply is left out
    // only when the profile marks it optional; there is exactly one of those
    // and it is the check.
    const planned = writes.filter(
      (step) => byName[step.artefact] !== undefined || !step.optional,
    );

    startRun();
    initializeSteps(
      planned.flatMap((step) => {
        const n = nameOf(step);
        return [n.fetching, n.sending, n.writing];
      }),
    );

    try {
      say(
        'The longest transfer goes first, while every raw slot is still the one',
      );
      say(
        'Kobo shipped. The device tree goes last, because writing it is what makes',
      );
      say('the device start from it.');
      say('');

      for (const step of writes) {
        const artefact = byName[step.artefact];
        if (!artefact) {
          // A step the release cannot supply is a refusal, unless the profile
          // says the step is the optional one. There is exactly one of those
          // and it is the check.
          if (step.optional) {
            say(
              `${step.label}: this release does not carry it, so it is skipped`,
            );
            say('');
            continue;
          }
          throw new Error(`${step.label}: the release does not carry it.`);
        }
        const n = nameOf(step);
        // eslint-disable-next-line no-await-in-loop
        const data = await runStep(n.fetching, () =>
          getBytes(n.fetching, artefact),
        );
        // eslint-disable-next-line no-await-in-loop
        await runStep(n.sending, () => sendDownload(n.sending, artefact, data));

        if (step.via === 'fastboot-flash') {
          // eslint-disable-next-line no-await-in-loop
          await runStep(n.writing, async () => {
            const device = deviceRef.current;
            if (!device) {
              throw new Error(CONNECTION_GONE);
            }
            setPhase(`Writing ${step.label}`);
            say(`flash:${step.target}`);
            await device.flash(step.target!, (info) =>
              say(`device: ${info.trim()}`),
            );
            say(`${step.label} written`, 'good');
            say('this channel cannot read it back');
          });
        } else if (step.via === 'fastboot-boot') {
          // eslint-disable-next-line no-await-in-loop
          await runStep(n.writing, async () => {
            setPhase('Starting the check on the device');
            await bootDevice();
            say('the check is running on the device', 'good');
          });
        } else {
          throw new Error(`Unknown step type ${step.via}.`);
        }
        say('');
      }

      setPhase(
        checking
          ? 'Everything is written. The device is checking it now.'
          : 'Everything is written. The install is complete and nothing has checked it, so the first start is the check.',
      );
      setFinish({
        title: profile.finish.title,
        steps: [
          checking
            ? 'Wait for the device to report on its own screen. It reads back everything that was just written and says whether each part matched. If it says a part did not match, do not power the device off and on: read what it says, then put the device back into fastboot and write it again.'
            : "Nothing read the writing back, so the first start is the check. If the device does not come up, put it back into fastboot and install again, or send it Kobo's own software over the same cable.",
          ...profile.finish.steps,
        ],
        expect: profile.finish.expect,
      });
    } catch (err) {
      failed(err);
    } finally {
      endRun();
    }
  };

  return {
    profile,
    support,
    release,
    connection,
    offers,
    log,
    phase,
    finish,
    failure,
    stepData,
    isRunning,
    actions: {
      connect,
      runBackup,
      runLive,
      runInstall,
    },
  };
}
