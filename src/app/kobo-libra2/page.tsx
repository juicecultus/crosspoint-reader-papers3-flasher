'use client';

// Put InkHub on a Kobo Libra 2.
//
// The copy here is the installer's own, sentence for sentence, in this site's
// typography. Everything that decides anything is in src/kobo: the fastboot
// protocol, the manifest parser, the identity gate and what a release lets you
// do. This file draws them.
//
// Two things are not negotiable and are both visible below. Nothing is written
// until every getvar answer matches the profile, which is the gate in
// src/kobo/profile.ts and the Install button being out of reach until it
// passes. And the install asks for a typed word first.

import React, { useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  DataList,
  Field,
  Heading,
  HStack,
  Input,
  Link,
  List,
  Stack,
  Table,
  Tabs,
  Text,
} from '@chakra-ui/react';
import {
  LuBookOpen,
  LuCircleCheck,
  LuHardDrive,
  LuLifeBuoy,
  LuPlug,
  LuRotateCcw,
  LuZap,
} from 'react-icons/lu';
import ActionCard from '@/components/ActionCard';
import Disclosure from '@/components/Disclosure';
import Steps from '@/components/Steps';
import {
  useKoboOperations,
  type Connection,
  type LogKind,
} from '@/kobo/useKoboOperations';
import type { Offer } from '@/kobo/offers';
import { TAB_NAMES } from '@/kobo/tabs';
import { useTabHash } from '@/kobo/useTabHash';
import type { CheckState } from '@/kobo/profile';

const STATE_WORDS: Record<CheckState, string> = {
  pass: 'matches',
  fail: 'refused',
  declined: 'not answered',
  noted: 'noted',
};

const CONNECTION_STATUS: Record<
  Connection['kind'],
  'success' | 'info' | 'error'
> = {
  connected: 'success',
  cancelled: 'info',
  failed: 'error',
  refused: 'error',
};

const LOG_COLOURS: Record<LogKind, string | undefined> = {
  plain: undefined,
  good: 'green.fg',
  bad: 'red.fg',
};

const STATE_COLOURS: Record<CheckState, string> = {
  pass: 'green',
  fail: 'red',
  declined: 'orange',
  noted: 'gray',
};

/**
 * One of the four numbered steps that get a device ready. They are the same
 * for trying it and for installing it, so they are written once and shown for
 * both tabs.
 */
function StepCard({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card.Root variant="subtle">
      <Card.Body>
        <Stack gap={3}>
          <HStack gap={2} alignItems="center">
            <Box
              bg="bg.emphasized"
              color="fg"
              borderRadius="full"
              minW="24px"
              h="24px"
              display="inline-flex"
              alignItems="center"
              justifyContent="center"
              fontSize="xs"
              fontWeight="bold"
              flexShrink={0}
            >
              {n}
            </Box>
            <Heading size="md">{title}</Heading>
          </HStack>
          {children}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The line under a button that is out of reach. Before a connection it carries
 * a next step rather than a refusal, and it is not drawn in the refusal's
 * colour.
 */
function Unavailable({ offer }: { offer: Offer }) {
  if (offer.ok) return null;
  return (
    <Text textStyle="xs" color={offer.quiet ? 'fg.muted' : 'red.fg'}>
      {offer.why}
    </Text>
  );
}

export default function KoboLibra2Page() {
  const {
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
    actions,
  } = useKoboOperations();

  const { tab, show } = useTabHash(TAB_NAMES);
  const [typed, setTyped] = useState('');
  const canInstall =
    offers.install.ok && typed.trim().toLowerCase() === 'install';
  const gates = connection && 'gates' in connection ? connection.gates : null;

  // Whether this release can check its own work. The three writes are the
  // install either way, so this is a fact about what happens after them and not
  // a reason to refuse anything.
  const installVerify = (() => {
    if (!offers.install.ok) return null;
    return offers.install.plan.present.some((a) => a.optional)
      ? 'After writing, this page starts a small program on the device. It reads all three back and says on the screen whether each one matched.'
      : 'This release has nothing to check the writing with. The install is still complete, and the first time the device starts is the check.';
  })();

  // ─── 1. Your browser ─────────────────────────────────────────────────────
  const browserStep = (
    <StepCard n={1} title="Your browser">
      {support === null && (
        <Text textStyle="sm" color="fg.muted">
          Checking.
        </Text>
      )}
      {support !== null && support.ok && (
        <Alert.Root status="success" variant="surface">
          <Alert.Indicator />
          <Alert.Description textStyle="sm">
            This browser can do it. Chrome or Edge on a computer, on a secure
            connection, with WebUSB.
          </Alert.Description>
        </Alert.Root>
      )}
      {support !== null && !support.ok && (
        <Alert.Root status="error" variant="surface">
          <Alert.Indicator />
          <Alert.Content>
            {support.reasons.map((reason) => (
              <Alert.Description key={reason} textStyle="sm">
                {reason}
              </Alert.Description>
            ))}
          </Alert.Content>
        </Alert.Root>
      )}
    </StepCard>
  );

  // ─── 2. The release ──────────────────────────────────────────────────────
  const releaseStep = (
    <StepCard n={2} title="The release">
      {release.status === 'loading' && (
        <Text textStyle="sm" color="fg.muted">
          Looking for the latest release.
        </Text>
      )}
      {release.status === 'none' && (
        <Alert.Root status="info" variant="surface">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>There is no release to send yet.</Alert.Title>
            <Alert.Description textStyle="sm">
              InkHub runs on hardware today and the code is public. What is not
              published yet is a downloadable image. When there is one, this
              page will find it and offer it here.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {release.status === 'error' && (
        <Alert.Root status="error" variant="surface">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description textStyle="sm">
              {release.message}
            </Alert.Description>
            {release.detail && (
              <Alert.Description textStyle="xs" color="fg.muted">
                {release.detail}
              </Alert.Description>
            )}
          </Alert.Content>
        </Alert.Root>
      )}
      {release.status === 'ready' && (
        <Stack gap={3}>
          <Alert.Root status="success" variant="surface">
            <Alert.Indicator />
            <Alert.Description textStyle="sm">
              InkHub {release.manifest.version}, build {release.manifest.build}.
            </Alert.Description>
          </Alert.Root>
          <DataList.Root orientation="horizontal" size="sm">
            <DataList.Item>
              <DataList.ItemLabel>version</DataList.ItemLabel>
              <DataList.ItemValue>
                {release.manifest.version}
              </DataList.ItemValue>
            </DataList.Item>
            <DataList.Item>
              <DataList.ItemLabel>build</DataList.ItemLabel>
              <DataList.ItemValue>
                {String(release.manifest.build)}
              </DataList.ItemValue>
            </DataList.Item>
            {release.manifest.commit && (
              <DataList.Item>
                <DataList.ItemLabel>commit</DataList.ItemLabel>
                <DataList.ItemValue>
                  {release.manifest.commit}
                </DataList.ItemValue>
              </DataList.Item>
            )}
            {release.manifest.date && (
              <DataList.Item>
                <DataList.ItemLabel>published</DataList.ItemLabel>
                <DataList.ItemValue>{release.manifest.date}</DataList.ItemValue>
              </DataList.Item>
            )}
          </DataList.Root>
          {release.manifest.notes && (
            <Stack gap={1}>
              <Text textStyle="sm" color="fg.muted">
                {release.manifest.notes}
              </Text>
              {release.manifest.notesUrl && (
                <Link
                  href={release.manifest.notesUrl}
                  textStyle="sm"
                  colorPalette="blue"
                >
                  The full release notes.
                </Link>
              )}
            </Stack>
          )}
        </Stack>
      )}
    </StepCard>
  );

  // ─── 3. Put the device into fastboot ─────────────────────────────────────
  //
  // The button sequence is page copy, written once, because there is one
  // gesture and the page shows it to both tabs. The warnings around it are the
  // profile's, because they are facts about this device.
  const entryStep = (
    <StepCard n={3} title="Put the device into fastboot">
      <Text textStyle="sm">
        Fastboot is a small mode inside the device&apos;s own bootloader. Plug
        the cable straight into your computer, not through a hub, then:
      </Text>
      <List.Root as="ol" gap={1} ps={5} textStyle="sm">
        <List.Item>Power the device fully off.</List.Item>
        <List.Item>Hold the TOP page-turn button.</List.Item>
        <List.Item>
          Short-press power, and keep holding the top button for ten seconds.
        </List.Item>
        <List.Item>
          The screen stays dark. That is right, and the page will see the
          device.
        </List.Item>
      </List.Root>
      <Alert.Root status="warning" variant="surface">
        <Alert.Indicator />
        <Alert.Content>
          {profile.entry.warnings.map((warning) => (
            <Alert.Description key={warning} textStyle="sm">
              {warning}
            </Alert.Description>
          ))}
        </Alert.Content>
      </Alert.Root>
      <Disclosure label="If the device does not appear">
        <List.Root gap={2} ps={5} textStyle="sm" color="fg.muted">
          <List.Item>
            An empty picker means the device is not in fastboot yet. Power it
            fully off and run the four steps again. A failed attempt costs
            nothing.
          </List.Item>
          <List.Item>
            Try a different cable and a port on the computer itself. The
            bootloader&apos;s USB does not survive a hub.
          </List.Item>
          <List.Item>
            On Windows the fastboot interface needs the WinUSB driver bound to
            it, and on Linux a udev rule. A Mac needs nothing.
          </List.Item>
        </List.Root>
      </Disclosure>
    </StepCard>
  );

  // ─── 4. Connect ──────────────────────────────────────────────────────────
  const connectStep = (
    <StepCard n={4} title="Connect">
      <Text textStyle="sm">
        Your browser asks you to pick the device. There will be one entry. This
        page reads what the bootloader says about itself and writes nothing at
        all until every answer matches a Libra 2.
      </Text>
      <Box>
        <Button
          variant="solid"
          colorPalette="blue"
          onClick={() => actions.connect()}
          disabled={isRunning || support === null || !support.ok}
        >
          <LuPlug />
          Connect to the device
        </Button>
      </Box>
      {connection && (
        <Alert.Root
          status={CONNECTION_STATUS[connection.kind]}
          variant="surface"
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description textStyle="sm">
              {connection.message}
            </Alert.Description>
            {'detail' in connection && connection.detail && (
              <Alert.Description textStyle="xs" color="fg.muted">
                {connection.detail}
              </Alert.Description>
            )}
          </Alert.Content>
        </Alert.Root>
      )}
      {gates && (
        <Disclosure label="What the bootloader said about itself">
          <Stack gap={3}>
            <Text textStyle="xs" color="fg.muted">
              Every answer, and what this page wanted.
            </Text>
            <Table.ScrollArea>
              <Table.Root size="sm" variant="outline">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Check</Table.ColumnHeader>
                    <Table.ColumnHeader>Expected</Table.ColumnHeader>
                    <Table.ColumnHeader>Answered</Table.ColumnHeader>
                    <Table.ColumnHeader>Verdict</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {gates.install.checks.map((check) => (
                    <Table.Row key={check.id}>
                      <Table.Cell fontWeight="medium">{check.label}</Table.Cell>
                      <Table.Cell fontFamily="mono" textStyle="xs">
                        {check.expected === null ? 'anything' : check.expected}
                      </Table.Cell>
                      <Table.Cell fontFamily="mono" textStyle="xs">
                        {check.actual === null
                          ? check.detail || 'no answer'
                          : check.actual}
                      </Table.Cell>
                      <Table.Cell>
                        <Badge
                          size="sm"
                          colorPalette={STATE_COLOURS[check.state]}
                        >
                          {STATE_WORDS[check.state]}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
            {connection?.kind === 'connected' &&
              connection.notes.map((note) => (
                <Text key={note} textStyle="sm" color="fg.muted">
                  {note}
                </Text>
              ))}
          </Stack>
        </Disclosure>
      )}
    </StepCard>
  );

  // ─── What is happening, and what to do at the end ────────────────────────
  const progress = (stepData.length > 0 || phase) && (
    <Card.Root variant="subtle">
      <Card.Body>
        <Stack gap={4}>
          <Heading size="md">What is happening</Heading>
          <Text textStyle="sm" color="fg.muted">
            {phase || 'Starting.'}
          </Text>
          {stepData.length > 0 && <Steps steps={stepData} />}
          {isRunning && (
            <Alert.Root status="warning" variant="surface">
              <Alert.Indicator />
              <Alert.Description textStyle="sm">
                Do not unplug your device or close this tab until the operation
                finishes.
              </Alert.Description>
            </Alert.Root>
          )}
          {failure && (
            <Alert.Root status="error" variant="surface">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description textStyle="sm">
                  {failure.message}
                </Alert.Description>
                <Alert.Description textStyle="sm">
                  Nothing further was sent. Unplug the cable, power the device
                  off by holding the power button, and start again from step 3.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}
          <Stack gap={1}>
            <Heading size="sm">The log</Heading>
            <Box
              as="pre"
              aria-live="polite"
              maxH="260px"
              overflowY="auto"
              overflowX="auto"
              bg="bg.muted"
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              p={3}
              fontFamily="mono"
              fontSize="xs"
              lineHeight="1.6"
            >
              {log.map((line, index) => (
                <Box
                  as="span"
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  display="block"
                  color={LOG_COLOURS[line.kind]}
                >
                  {line.text || ' '}
                </Box>
              ))}
            </Box>
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );

  const finishSection = finish && (
    <Card.Root variant="subtle" borderColor="green.solid" borderLeftWidth="3px">
      <Card.Body>
        <Stack gap={3}>
          <HStack gap={2} alignItems="center">
            <Box color="green.solid" display="inline-flex" fontSize="lg">
              <LuCircleCheck />
            </Box>
            <Heading size="md">{finish.title}</Heading>
          </HStack>
          <List.Root as="ol" gap={1} ps={5} textStyle="sm">
            {finish.steps.map((step) => (
              <List.Item key={step}>{step}</List.Item>
            ))}
          </List.Root>
          <Text textStyle="sm" color="fg.muted">
            {finish.expect}
          </Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );

  // The four steps that get a device ready are the same for trying it and for
  // installing it, so they are written once and shown for both tabs.
  const prepare = (
    <Stack gap={4}>
      {browserStep}
      {releaseStep}
      {entryStep}
      {connectStep}
    </Stack>
  );

  const afterwards = (
    <Stack gap={4}>
      {progress}
      {finishSection}
    </Stack>
  );

  return (
    <Stack gap={6}>
      <Stack gap={2} py={2}>
        <Text
          textStyle="xs"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          InkHub · a Linux operating system for the Kobo Libra 2
        </Text>
        <Heading size="2xl">Put InkHub on your Kobo Libra 2</Heading>
        <Text color="fg.muted" textStyle="lg">
          It all happens here, over the USB cable, in Chrome or Edge on a
          computer. Nothing to install first. Try the whole system from memory
          without writing anything to your e-reader, or install it when you are
          ready.
        </Text>
      </Stack>

      {/* The fragment names the open tab, so /kobo-libra2#install is a link
          somebody can paste and #back and #help are the same. */}
      <Tabs.Root
        value={tab}
        onValueChange={(event) => show(event.value)}
        variant="enclosed"
        fitted
      >
        <Tabs.List>
          <Tabs.Trigger value="try">
            <LuZap />
            Try it
          </Tabs.Trigger>
          <Tabs.Trigger value="install">
            <LuHardDrive />
            Install
          </Tabs.Trigger>
          <Tabs.Trigger value="back">
            <LuRotateCcw />
            Go back to Kobo
          </Tabs.Trigger>
          <Tabs.Trigger value="help">
            <LuLifeBuoy />
            Help
          </Tabs.Trigger>
        </Tabs.List>

        {/* ─── Try it ───────────────────────────────────────────────────── */}
        <Tabs.Content value="try">
          <Stack gap={4}>
            {prepare}
            <ActionCard
              tone="primary"
              icon={<LuZap />}
              title="Try InkHub Live"
              description="The whole system runs from memory: the launcher, the terminal, Wi-Fi, the frontlight, and your own books, mounted read only."
            >
              <Badge colorPalette="green" variant="surface" alignSelf="start">
                Live from memory, nothing written
              </Badge>
              <Text textStyle="sm">
                Nothing is saved and nothing is written. Hold the power button
                until the device goes off, turn it back on, and your Kobo is
                exactly as it was.
              </Text>
              <Box>
                <Button
                  variant="solid"
                  colorPalette="blue"
                  size="lg"
                  onClick={() => actions.runLive()}
                  disabled={isRunning || !offers.live.ok}
                >
                  Try InkHub Live
                </Button>
              </Box>
              <Unavailable offer={offers.live} />
              <Disclosure label="KOReader is not in this one">
                <Text textStyle="sm" color="fg.muted">
                  A live image has to fit in memory and KOReader is too big to
                  come along. The tile on the home screen says so. An install
                  has it.
                </Text>
              </Disclosure>
            </ActionCard>
            {afterwards}
          </Stack>
        </Tabs.Content>

        {/* ─── Install ──────────────────────────────────────────────────── */}
        <Tabs.Content value="install">
          <Stack gap={4}>
            {prepare}

            <ActionCard
              icon={<LuHardDrive />}
              title="Back up first"
              description="The device copies Kobo's own system and the two files Bluetooth needs into one new folder on the card your books are on, which takes two to four minutes and writes nothing anywhere else."
            >
              <Badge colorPalette="gray" variant="surface" alignSelf="start">
                Writes one folder to your own card
              </Badge>
              <Box>
                <Button
                  variant="outline"
                  onClick={() => actions.runBackup()}
                  disabled={isRunning || !offers.backup.ok}
                >
                  Back up the device
                </Button>
              </Box>
              <Unavailable offer={offers.backup} />
              <Disclosure label="Why this means starting again afterwards">
                <Text textStyle="sm" color="fg.muted">
                  The backup leaves the device running from memory, and nothing
                  can put it back into fastboot from there. So it goes: back up,
                  hold power until the device is off, run step 3 again, Connect
                  again, then Install. The page says so again when the backup is
                  done.
                </Text>
              </Disclosure>
            </ActionCard>

            <ActionCard
              tone="warning"
              icon={<LuZap />}
              title="Install InkHub"
              description="This writes the system, the kernel and the device tree, and from then on InkHub is what your Libra 2 starts."
            >
              <Badge colorPalette="red" variant="surface" alignSelf="start">
                Writes to the device
              </Badge>
              <Text textStyle="sm">
                Your books stay. They live on the third partition and nothing
                here writes to it. Kobo&apos;s reading positions and annotations
                do not come across: they belong to Kobo&apos;s reader, which
                stops running.
              </Text>
              <Text textStyle="sm">
                You do not need a backup to come back. The way back uses the
                recovery partition, and that is one of the things this page
                never writes to.
              </Text>
              <Text textStyle="sm">
                Bluetooth keeps working if you ran the backup pass first,
                because that pass copies the two files it needs off Kobo&apos;s
                own system.
              </Text>
              {installVerify && (
                <Text textStyle="xs" color="fg.muted">
                  {installVerify}
                </Text>
              )}
              {offers.install.ok && (
                <Field.Root maxW="260px">
                  <Field.Label textStyle="sm">
                    Type <b>install</b> to start.
                  </Field.Label>
                  <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    size="sm"
                  />
                </Field.Root>
              )}
              <Box>
                <Button
                  variant="solid"
                  colorPalette="orange"
                  size="lg"
                  onClick={() => actions.runInstall()}
                  disabled={isRunning || !canInstall}
                >
                  Install InkHub
                </Button>
              </Box>
              <Unavailable offer={offers.install} />
              <Disclosure label="What is never touched">
                <Text textStyle="sm" color="fg.muted">
                  The recovery partition, the bootloader, your device&apos;s
                  serial number and the panel calibration. Everything Kobo needs
                  to put itself back is still on the device afterwards.
                </Text>
              </Disclosure>
              <Disclosure label="The full byte-for-byte copy">
                <Text textStyle="sm" color="fg.muted">
                  A complete copy of the card is a developer&apos;s procedure: a
                  shell on the device, a second machine and an evening. It is{' '}
                  <Link
                    href="https://github.com/juicecultus/libra2-linuxos/blob/main/docs/second-device.md"
                    colorPalette="blue"
                  >
                    docs/second-device.md
                  </Link>{' '}
                  if you want one.
                </Text>
              </Disclosure>
            </ActionCard>

            {afterwards}
          </Stack>
        </Tabs.Content>

        {/* ─── Go back to Kobo ──────────────────────────────────────────── */}
        <Tabs.Content value="back">
          <ActionCard
            icon={<LuRotateCcw />}
            title="Go back to Kobo"
            description="Open Settings in InkHub, go to Device information, and choose Go back to Kobo on the last sheet. That is the whole thing."
          >
            <Text textStyle="sm">
              It erases the device the way a Kobo factory reset does and hands
              it back to Kobo&apos;s own software, so copy anything you want to
              keep off the device first.
            </Text>
            <Disclosure label="The other way back">
              <Text textStyle="sm" color="fg.muted">
                Kobo&apos;s own firmware, sent over this same cable. It needs no
                InkHub running at all, which is why it is the one to reach for
                if the device will not start.
              </Text>
            </Disclosure>
            <Disclosure label="The button gesture is not the way back">
              <Text textStyle="sm" color="fg.muted">
                Holding power and a page key together is Kobo&apos;s factory
                restore, and it only fires with Kobo&apos;s own images in the
                slots. On a device running InkHub it is an ordinary start, every
                time we have tried it.
              </Text>
            </Disclosure>
          </ActionCard>
        </Tabs.Content>

        {/* ─── Help ─────────────────────────────────────────────────────── */}
        <Tabs.Content value="help">
          <Stack gap={4}>
            <Stack direction={{ base: 'column', md: 'row' }} gap={4}>
              <Card.Root variant="outline" flex="1">
                <Card.Body>
                  <Stack gap={2}>
                    <Heading size="sm">What you get</Heading>
                    <Text textStyle="sm" color="fg.muted">
                      A mainline Linux kernel, a launcher drawn to match the
                      stock reader&apos;s own screens, KOReader, a terminal,
                      Wi-Fi, and the frontlight on Kobo&apos;s own calibration.
                      No store and no account. The{' '}
                      <Link
                        href="https://github.com/juicecultus/libra2-linuxos"
                        colorPalette="blue"
                      >
                        source is on GitHub
                      </Link>{' '}
                      and everything on the image is built from it.
                    </Text>
                  </Stack>
                </Card.Body>
              </Card.Root>
              <Card.Root variant="outline" flex="1">
                <Card.Body>
                  <Stack gap={2}>
                    <Heading size="sm">What you lose</Heading>
                    <Text textStyle="sm" color="fg.muted">
                      Kobo&apos;s own software stops running: no Kobo sync, no
                      Kobo store, no Overdrive, no Kobo reader. Bluetooth works
                      when you run the backup pass first; it copies the two
                      files Bluetooth needs off Kobo&apos;s own system, which is
                      the only place they exist. Skip that pass and the radio
                      has nothing to load.
                    </Text>
                  </Stack>
                </Card.Body>
              </Card.Root>
            </Stack>

            <ActionCard
              icon={<LuBookOpen />}
              title="Browsers"
              description="Chrome or Edge, on a computer. Safari has no WebUSB, so it cannot reach the device at all. Windows should work and we have not tested it."
            >
              <Stack gap={1}>
                <Heading size="sm">The first start on a Mac</Heading>
                <Text textStyle="sm" color="fg.muted">
                  A Mac asks once whether to allow the new device the first time
                  InkHub starts. Allow it, or the cable carries nothing.
                </Text>
              </Stack>

              <Disclosure label="What this page can and cannot do">
                <Stack gap={2} textStyle="sm" color="fg.muted">
                  <Text>
                    It can read the four things the bootloader will say about
                    itself, run the live image from memory, and write the
                    system, the kernel and the device tree. Those three writes
                    are the whole install.
                  </Text>
                  <Text>
                    It cannot read anything back, because fastboot has no read
                    command. When a release carries the small checking program,
                    this page starts it from memory and the device says on its
                    own screen whether each part matched. When a release does
                    not carry it, the install is still complete and the first
                    start is the check.
                  </Text>
                  <Text>
                    It cannot restart the device either. You power it off and on
                    by hand at the end, and the page tells you when.
                  </Text>
                </Stack>
              </Disclosure>

              <Disclosure label="If something goes wrong">
                <List.Root gap={2} ps={5} textStyle="sm" color="fg.muted">
                  <List.Item>
                    <b>It stopped part way.</b> Unplug the cable, hold the power
                    button until the device goes off, and start again at step 3.
                    Nothing further was sent.
                  </List.Item>
                  <List.Item>
                    <b>It will not start after an install.</b> Power it fully
                    off, put it back in fastboot and install again, or send it
                    Kobo&apos;s own software over the same cable.
                  </List.Item>
                  <List.Item>
                    <b>The browser could not open the device.</b> On Windows the
                    fastboot interface needs the WinUSB driver bound to it, and
                    on Linux a udev rule.
                  </List.Item>
                </List.Root>
              </Disclosure>
            </ActionCard>
          </Stack>
        </Tabs.Content>
      </Tabs.Root>

      <Stack gap={2} textStyle="xs" color="fg.muted">
        <Text>
          InkHub is GPL-2.0-or-later.{' '}
          <Link
            href="https://github.com/juicecultus/libra2-linuxos"
            colorPalette="blue"
          >
            The source, the engineering log and the runbooks are on GitHub.
          </Link>
        </Text>
        <Text>
          This page is not affiliated with Rakuten Kobo. Kobo and Libra are
          their trademarks and are used here to say which device this software
          runs on.
        </Text>
      </Stack>
    </Stack>
  );
}
