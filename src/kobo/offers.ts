// offers.ts - what a device and a release together allow, and why not.
//
// This was app.js's canDo() and hasCheck(). It is the decision that puts a
// button in reach or leaves it out of reach with a sentence: no release, a gate
// that did not pass, a release that does not carry the artefact this action
// sends. Nothing here falls back to something it can do instead.
//
// Pure functions over plain objects, so the tests can drive every refusal from
// node without a device or a browser.

import { planArtefacts, type ArtefactPlan, type Manifest } from './manifest.ts';
import type { DeviceProfile, GateResult, ProfileAction } from './profile.ts';

export type Offer =
  | { ok: true; plan: ArtefactPlan }
  // quiet marks the line that carries a next step rather than a refusal: before
  // anything is connected there is nothing to refuse yet, and it is not drawn
  // in the refusal's colour.
  | { ok: false; why: string; quiet: boolean };

export type Offers = Record<ProfileAction, Offer>;

// Every action is out of reach until a device has answered, and each says why.
export function lockedOffers(why: string): Offers {
  const locked: Offer = { ok: false, why, quiet: true };
  return { backup: locked, live: locked, install: locked };
}

export function offerAction(
  profile: DeviceProfile,
  manifest: Manifest | null,
  gate: GateResult | null,
  action: ProfileAction,
): Offer {
  if (!manifest) {
    return { ok: false, why: 'There is no release to send.', quiet: false };
  }
  if (!gate || !gate.ok) {
    return {
      ok: false,
      why: 'The identity checks this needs did not pass.',
      quiet: false,
    };
  }
  let plan: ArtefactPlan;
  try {
    plan = planArtefacts(profile, manifest, action);
  } catch (err) {
    return { ok: false, why: (err as Error).message, quiet: false };
  }
  if (!plan.ok) {
    const names = plan.missing.map((m) => `${m.label} (${m.asset})`).join(', ');
    return {
      ok: false,
      why: `This release does not carry ${names}, so this page cannot do it.`,
      quiet: false,
    };
  }
  return { ok: true, plan };
}

export function offerActions(
  profile: DeviceProfile,
  manifest: Manifest | null,
  gates: Record<ProfileAction, GateResult> | null,
): Offers {
  return {
    backup: offerAction(
      profile,
      manifest,
      gates ? gates.backup : null,
      'backup',
    ),
    live: offerAction(profile, manifest, gates ? gates.live : null, 'live'),
    install: offerAction(
      profile,
      manifest,
      gates ? gates.install : null,
      'install',
    ),
  };
}

// The check step is optional. A plan that carries it verifies; a plan that does
// not still installs, and the page says which of the two it is doing.
export function hasCheck(plan: ArtefactPlan | null): boolean {
  return Boolean(plan && plan.present.some((a) => a.optional));
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} bytes`;
}
