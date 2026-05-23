'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CloseButton,
  Dialog,
  Heading,
  HStack,
  Portal,
  Separator,
  Spinner,
  Stack,
  Tabs,
  Text,
} from '@chakra-ui/react';
import {
  LuChevronDown,
  LuChevronRight,
  LuCircleCheck,
  LuDownload,
  LuHardDrive,
  LuPlug,
  LuRotateCcw,
  LuScanSearch,
  LuTriangleAlert,
  LuUnplug,
  LuUpload,
  LuZap,
} from 'react-icons/lu';
import type { FirmwareInfo } from '@/utils/firmwareIdentifier';
import FileUpload, { FileUploadHandle } from '@/components/FileUpload';
import Steps from '@/components/Steps';
import { useEspOperations } from '@/esp/useEspOperations';

export interface DeviceConfig {
  deviceName: string;
  chipName: string;
  firmwareLabel: string;
  factoryNote: string;
  bootModeHint: string;
  restartHint: string;
  fetchVersions: () => Promise<{ version: string; releaseDate: string }>;
  flashFirmwareAction: 'flashCrossPointFirmware' | 'flashX3Firmware';
  stockFirmware?: {
    fetchVersions: () => Promise<{ en: string; ch: string }>;
  };
  stockFullFlash?: {
    version: string;
    firmwareUrl: string;
  };
  dynamicStockFullFlash?: {
    buttonLabel: string;
    sourceNote?: React.ReactNode;
    fetchVersion: () => Promise<{ version: string; releaseDate: string }>;
    flashAction: 'flashStockPaperS3FullFlash';
  };
  crossPointFullFlash?: {
    buttonLabel: string;
    fetchVersion: () => Promise<{ version: string; releaseDate: string }>;
    flashAction: 'flashCrossPointPaperS3FullFlash';
  };
}

type VersionInfo = { version: string; releaseDate: string };

/**
 * Helper: section card with a leading icon, title, description, and body slot.
 * Keeps every card visually consistent — same padding, border, gap.
 */
function ActionCard({
  icon,
  title,
  description,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'primary' | 'warning';
}) {
  const accent =
    tone === 'primary'
      ? 'blue.solid'
      : tone === 'warning'
      ? 'orange.solid'
      : 'border';
  return (
    <Card.Root variant="outline" borderColor={accent} borderLeftWidth="3px">
      <Card.Body>
        <Stack gap={4}>
          <Stack gap={1}>
            <HStack gap={2} alignItems="center">
              <Box color={accent} display="inline-flex" fontSize="lg">
                {icon}
              </Box>
              <Heading size="md">{title}</Heading>
            </HStack>
            {description && (
              <Text color="fg.muted" textStyle="sm">
                {description}
              </Text>
            )}
          </Stack>
          {children}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Helper: lightweight disclosure with chevron, used for "Other install options"
 * and the bottom "Help & safety" accordion.
 */
function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Stack gap={2}>
      <Button
        variant="ghost"
        size="sm"
        justifyContent="flex-start"
        onClick={() => setOpen((o) => !o)}
        color="fg.muted"
        px={2}
      >
        <Box as="span" mr={1} display="inline-flex">
          {open ? <LuChevronDown /> : <LuChevronRight />}
        </Box>
        {label}
      </Button>
      {open && <Box pl={6}>{children}</Box>}
    </Stack>
  );
}

function VersionMeta({
  version,
  releaseDate,
}: {
  version?: string;
  releaseDate?: string;
}) {
  return (
    <Text color="fg.muted" textStyle="xs">
      {version ? `${version}` : 'Loading…'}
      {releaseDate ? ` · released ${releaseDate}` : ''}
    </Text>
  );
}

export default function FlashPage({ config }: { config: DeviceConfig }) {
  // ─── Persistent device connection ──────────────────────────────────────
  // Once the user picks a device via "Connect", the SerialPort lives in this
  // state and every action reuses it — no more per-action chooser prompt.
  const [serialPort, setSerialPort] = useState<SerialPort | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const { actions, debugActions, stepData, isRunning } = useEspOperations({
    serialPort,
  });

  // ─── Remote version state ──────────────────────────────────────────────
  const [firmwareVersions, setFirmwareVersions] = useState<VersionInfo | null>(
    null,
  );
  const [stockVersions, setStockVersions] = useState<{
    en: string;
    ch: string;
  } | null>(null);
  const [dynamicStockVersion, setDynamicStockVersion] =
    useState<VersionInfo | null>(null);
  const [crossPointFullFlashVersion, setCrossPointFullFlashVersion] =
    useState<VersionInfo | null>(null);

  // ─── Local file picker refs ────────────────────────────────────────────
  const fullFlashFileInput = useRef<FileUploadHandle>(null);
  const appPartitionFileInput = useRef<FileUploadHandle>(null);

  // ─── Browser feature detection ─────────────────────────────────────────
  const [serialSupported, setSerialSupported] = useState<boolean | null>(null);

  // ─── Identified firmware (populated on demand) ─────────────────────────
  const [identifiedFirmware, setIdentifiedFirmware] = useState<{
    app0: FirmwareInfo;
    app1: FirmwareInfo;
    currentBoot: 'app0' | 'app1';
  } | null>(null);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  // ─── Debug flag (NODE_ENV=development OR ?debug=1 in URL) ──────────────
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      setDebugMode(true);
      return;
    }
    if (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1'
    ) {
      setDebugMode(true);
    }
  }, []);

  // ─── Progress modal ────────────────────────────────────────────────────
  // The modal opens automatically when an operation starts and stays open
  // (locked, no click-outside dismissal) until the operation finishes. After
  // completion the user reviews the result and closes manually — that way
  // critical 'do not disconnect' state is impossible to miss.
  const [progressOpen, setProgressOpen] = useState(false);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    // Auto-open when a new operation starts.
    if (isRunning && !wasRunningRef.current) {
      setProgressOpen(true);
      // Invalidate any cached identify result — partition state may change.
      setIdentifiedFirmware(null);
      setIdentifyError(null);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    setSerialSupported(
      typeof navigator !== 'undefined' && 'serial' in navigator,
    );
  }, []);

  // Clear cached port if the user unplugs the device — otherwise we'd try to
  // open a dead handle on the next action and silently fail.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) return;
    const handler = (event: Event) => {
      const target = (event as unknown as { target?: SerialPort }).target;
      if (target && target === serialPort) {
        setSerialPort(null);
      }
    };
    navigator.serial.addEventListener('disconnect', handler);
    return () => navigator.serial.removeEventListener('disconnect', handler);
  }, [serialPort]);

  const connectDevice = async () => {
    setConnectError(null);
    try {
      // Use the same Espressif filter as EspController.requestDevice() so the
      // user only sees their flasher-eligible ports.
      const port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 12346, usbProductId: 4097 }],
      });
      setSerialPort(port);
      setIdentifiedFirmware(null);
      setIdentifyError(null);
    } catch (e) {
      // Aborted prompts throw DOMException with name 'NotFoundError' — that's
      // just the user cancelling, not worth surfacing.
      if ((e as DOMException).name !== 'NotFoundError') {
        setConnectError((e as Error).message || 'Connect failed');
      }
    }
  };

  const disconnectDevice = () => {
    setSerialPort(null);
    setIdentifiedFirmware(null);
    setIdentifyError(null);
    setConnectError(null);
  };

  useEffect(() => {
    config.fetchVersions().then(setFirmwareVersions);
    config.stockFirmware?.fetchVersions().then(setStockVersions);
    config.dynamicStockFullFlash?.fetchVersion().then(setDynamicStockVersion);
    config.crossPointFullFlash
      ?.fetchVersion()
      .then(setCrossPointFullFlashVersion);
  }, [config]);

  const flashRemote = actions[config.flashFirmwareAction];
  const hasResetSection = Boolean(
    config.stockFirmware || config.stockFullFlash || config.dynamicStockFullFlash,
  );

  return (
    <Stack gap={5}>
      {/* ─── Browser support banner (only if WebSerial missing) ─────────── */}
      {serialSupported === false && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>This browser can&apos;t flash devices</Alert.Title>
            <Alert.Description>
              EinkHub uses the Web Serial API, which only works in Chrome and
              Edge (desktop). Open this page in Chrome or Edge to continue.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {/* ─── 1. Device card ─────────────────────────────────────────────── */}
      <Card.Root variant="subtle">
        <Card.Body>
          <Stack gap={3}>
            <HStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3}>
              <Stack gap={0}>
                <Text
                  textStyle="xs"
                  color="fg.muted"
                  textTransform="uppercase"
                  letterSpacing="wider"
                >
                  Device
                </Text>
                <Heading size="lg">{config.deviceName}</Heading>
                <HStack gap={2}>
                  <Text color="fg.muted" textStyle="sm">
                    {config.chipName}
                  </Text>
                  {serialPort && (
                    <HStack gap={1} color="green.solid" textStyle="sm">
                      <LuCircleCheck />
                      <Text fontWeight="medium">Connected</Text>
                    </HStack>
                  )}
                </HStack>
              </Stack>
              <HStack gap={2}>
                {serialPort ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIdentifyError(null);
                        debugActions
                          .readAndIdentifyAllFirmware()
                          .then((data) => setIdentifiedFirmware(data))
                          .catch((e: Error) =>
                            setIdentifyError(e.message || 'Identify failed'),
                          );
                      }}
                      disabled={isRunning}
                    >
                      <LuScanSearch />
                      Identify firmware
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={disconnectDevice}
                      disabled={isRunning}
                    >
                      <LuUnplug />
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="solid"
                    colorPalette="blue"
                    size="sm"
                    onClick={connectDevice}
                    disabled={isRunning || serialSupported === false}
                  >
                    <LuPlug />
                    Connect device
                  </Button>
                )}
              </HStack>
            </HStack>

            {identifiedFirmware && (
              <Stack
                gap={2}
                borderTopWidth="1px"
                borderColor="border"
                pt={3}
              >
                <Text textStyle="xs" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
                  Currently installed
                </Text>
                <HStack gap={4} flexWrap="wrap">
                  {(['app0', 'app1'] as const).map((slot) => {
                    const info = identifiedFirmware[slot];
                    const isActive = identifiedFirmware.currentBoot === slot;
                    return (
                      <Box key={slot} flex="1" minW="200px">
                        <HStack gap={2}>
                          <Text textStyle="sm" fontWeight="medium">
                            {slot}
                          </Text>
                          {isActive && (
                            <Box
                              bg="green.solid"
                              color="white"
                              px={2}
                              py="0.5"
                              borderRadius="sm"
                              fontSize="xs"
                              fontWeight="bold"
                            >
                              ACTIVE
                            </Box>
                          )}
                        </HStack>
                        <Text textStyle="sm">{info.displayName}</Text>
                        {info.version && info.version !== 'unknown' && (
                          <Text textStyle="xs" color="fg.muted">
                            {info.version}
                          </Text>
                        )}
                      </Box>
                    );
                  })}
                </HStack>
              </Stack>
            )}

            {identifyError && (
              <Alert.Root status="error" variant="surface" size="sm">
                <Alert.Indicator />
                <Alert.Description textStyle="xs">
                  {identifyError}
                </Alert.Description>
              </Alert.Root>
            )}

            {!identifiedFirmware && !identifyError && (
              <Text textStyle="xs" color="fg.muted">
                {serialPort ? (
                  <>
                    Click <b>Identify firmware</b> to read both app partitions
                    and detect what&apos;s currently installed. Optional — all
                    actions below work without identifying.
                  </>
                ) : (
                  <>
                    Click <b>Connect device</b> once and every action below
                    reuses the same connection — no more per-action chooser
                    prompts.
                  </>
                )}
              </Text>
            )}

            {connectError && (
              <Alert.Root status="error" variant="surface" size="sm">
                <Alert.Indicator />
                <Alert.Description textStyle="xs">
                  {connectError}
                </Alert.Description>
              </Alert.Root>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* ─── 2-4. Action tabs ───────────────────────────────────────────── */}
      <Tabs.Root defaultValue="install" variant="enclosed" fitted>
        <Tabs.List>
          <Tabs.Trigger value="install">
            <LuZap />
            Install / update
          </Tabs.Trigger>
          <Tabs.Trigger value="backup">
            <LuHardDrive />
            Back up & restore
          </Tabs.Trigger>
          {hasResetSection && (
            <Tabs.Trigger value="reset">
              <LuRotateCcw />
              Reset to factory
            </Tabs.Trigger>
          )}
        </Tabs.List>

        <Tabs.Content value="install">
      <ActionCard
        tone="primary"
        icon={<LuZap />}
        title={`Install or update ${config.firmwareLabel}`}
        description={
          <>
            Fast update — overwrites the backup app slot and swaps to it.
            Keeps your books, fonts, and settings. ~30 seconds.
          </>
        }
      >
        <Button
          variant="solid"
          colorPalette="blue"
          size="lg"
          onClick={flashRemote}
          disabled={isRunning || !firmwareVersions}
          loading={!firmwareVersions}
        >
          Install CrossPoint
        </Button>
        <VersionMeta
          version={firmwareVersions?.version}
          releaseDate={firmwareVersions?.releaseDate}
        />

        <Disclosure label="Other install options">
          <Stack gap={4}>
            {config.crossPointFullFlash && (
              <Stack gap={2}>
                <Text textStyle="sm" fontWeight="medium">
                  Full install (recovery)
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  Use this if you&apos;re currently on stock M5Stack firmware,
                  bmorcelli&apos;s Launcher, or any non-CrossPoint image —
                  fast update can&apos;t run from those states. Writes a
                  complete CrossPoint image from address 0, restoring the
                  dual-OTA layout. ~25 minutes.
                </Text>
                <Button
                  variant="outline"
                  onClick={actions[config.crossPointFullFlash.flashAction]}
                  disabled={isRunning || !crossPointFullFlashVersion}
                  loading={!crossPointFullFlashVersion}
                >
                  Full install CrossPoint
                </Button>
                <VersionMeta
                  version={crossPointFullFlashVersion?.version}
                  releaseDate={crossPointFullFlashVersion?.releaseDate}
                />
              </Stack>
            )}

            <Stack gap={2}>
              <Text textStyle="sm" fontWeight="medium">
                Install from custom .bin
              </Text>
              <Text textStyle="xs" color="fg.muted">
                For advanced users — flashes any app-partition binary you
                provide into the backup OTA slot.
              </Text>
              <HStack gap={2}>
                <Box flex="1">
                  <FileUpload ref={appPartitionFileInput} />
                </Box>
                <Button
                  variant="outline"
                  onClick={() =>
                    actions.flashCustomFirmware(
                      () => appPartitionFileInput.current?.getFile(),
                      config.deviceName,
                    )
                  }
                  disabled={isRunning}
                >
                  Install from file
                </Button>
              </HStack>
            </Stack>

            {debugMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={actions.fakeWriteFullFlash}
                disabled={isRunning}
              >
                Fake write full flash (dev)
              </Button>
            )}
          </Stack>
        </Disclosure>
      </ActionCard>

        </Tabs.Content>

        <Tabs.Content value="backup">
      {/* ─── 3. Backup & restore ────────────────────────────────────────── */}
      <ActionCard
        icon={<LuHardDrive />}
        title="Back up & restore"
        description={
          <>
            Save a full 16 MB image of your device, or restore from one you
            saved earlier. {config.factoryNote && <>{config.factoryNote}</>}
          </>
        }
      >
        <HStack gap={2} alignItems="stretch" flexWrap="wrap">
          <Button
            variant="outline"
            onClick={actions.saveFullFlash}
            disabled={isRunning}
            flex="1"
            minW="200px"
          >
            <LuDownload />
            Back up device (~25 min)
          </Button>
        </HStack>
        <Stack gap={2}>
          <Text textStyle="xs" color="fg.muted">
            Restore from a previous backup
          </Text>
          <HStack gap={2} alignItems="stretch" flexWrap="wrap">
            <Box flex="1" minW="200px">
              <FileUpload ref={fullFlashFileInput} />
            </Box>
            <Button
              variant="outline"
              onClick={() =>
                actions.writeFullFlash(() =>
                  fullFlashFileInput.current?.getFile(),
                )
              }
              disabled={isRunning}
            >
              <LuUpload />
              Restore from backup
            </Button>
          </HStack>
        </Stack>
      </ActionCard>

        </Tabs.Content>

        {hasResetSection && (
          <Tabs.Content value="reset">
      {/* ─── 4. Reset to factory ────────────────────────────────────────── */}
        <ActionCard
          tone="warning"
          icon={<LuRotateCcw />}
          title="Reset to factory firmware"
          description={
            <>
              Restores the manufacturer&apos;s stock firmware. SD card
              contents are preserved.
            </>
          }
        >
          {config.dynamicStockFullFlash && (
            <Stack gap={2}>
              <Button
                variant="outline"
                colorPalette="orange"
                onClick={actions[config.dynamicStockFullFlash.flashAction]}
                disabled={isRunning || !dynamicStockVersion}
                loading={!dynamicStockVersion}
              >
                {config.dynamicStockFullFlash.buttonLabel} (~25 min)
              </Button>
              <VersionMeta
                version={dynamicStockVersion?.version}
                releaseDate={dynamicStockVersion?.releaseDate}
              />
              {config.dynamicStockFullFlash.sourceNote && (
                <Text textStyle="xs" color="fg.muted">
                  {config.dynamicStockFullFlash.sourceNote}
                </Text>
              )}
            </Stack>
          )}

          {config.stockFullFlash && (
            <Stack gap={2}>
              <Button
                variant="outline"
                colorPalette="orange"
                onClick={() =>
                  actions.flashStockFullFlash(config.stockFullFlash!.firmwareUrl)
                }
                disabled={isRunning}
              >
                Reset to stock {config.deviceName} firmware (~25 min)
              </Button>
              <Text textStyle="xs" color="fg.muted">
                {config.stockFullFlash.version}
              </Text>
            </Stack>
          )}

          {config.stockFirmware && (
            <Disclosure label="Stock firmware variants (OTA fast flash)">
              <Stack gap={2}>
                <Text textStyle="xs" color="fg.muted">
                  Fast OTA reset — requires the device to still have the
                  dual-OTA partition layout.
                </Text>
                <Button
                  variant="ghost"
                  onClick={actions.flashStockEnglishFirmware}
                  disabled={isRunning || !stockVersions}
                  loading={!stockVersions}
                >
                  English ({stockVersions?.en ?? '…'})
                </Button>
                <Button
                  variant="ghost"
                  onClick={actions.flashStockChineseFirmware}
                  disabled={isRunning || !stockVersions}
                  loading={!stockVersions}
                >
                  Chinese ({stockVersions?.ch ?? '…'})
                </Button>
              </Stack>
            </Disclosure>
          )}

          <Alert.Root status="warning" variant="surface">
            <Alert.Indicator />
            <Alert.Description textStyle="xs">
              This firmware is the intellectual property of its manufacturer
              and is provided here solely for emergency recovery. EinkHub is
              not affiliated with the manufacturer and provides no warranty
              or support for it.
            </Alert.Description>
          </Alert.Root>
        </ActionCard>
          </Tabs.Content>
        )}
      </Tabs.Root>

      {/* ─── 5. Progress modal (auto-opens on operation start) ──────────── */}
      <Dialog.Root
        open={progressOpen}
        onOpenChange={(details) => {
          // Lock the modal while running — accidental dismissal mid-flash
          // would still leave the operation running but hide all feedback.
          if (isRunning) return;
          setProgressOpen(details.open);
        }}
        size="lg"
        modal
        closeOnInteractOutside={!isRunning}
        closeOnEscape={!isRunning}
        placement="center"
        scrollBehavior="inside"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <HStack gap={2} alignItems="center">
                  {isRunning ? (
                    <>
                      <Spinner size="sm" color="blue.solid" />
                      <Dialog.Title>Running — do not disconnect</Dialog.Title>
                    </>
                  ) : (
                    <>
                      <Box color="green.solid" display="inline-flex">
                        <LuCircleCheck />
                      </Box>
                      <Dialog.Title>Operation complete</Dialog.Title>
                    </>
                  )}
                </HStack>
                {!isRunning && (
                  <Dialog.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Dialog.CloseTrigger>
                )}
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap={4}>
                  {stepData.length > 0 ? (
                    <Steps steps={stepData} />
                  ) : (
                    <Text color="fg.muted" textStyle="sm">
                      Starting…
                    </Text>
                  )}
                  {isRunning && (
                    <Alert.Root status="warning" variant="surface">
                      <Alert.Indicator />
                      <Alert.Description textStyle="sm">
                        Do not unplug your device or close this tab until the
                        operation finishes.
                      </Alert.Description>
                    </Alert.Root>
                  )}
                  {!isRunning && stepData.length > 0 && (
                    <Alert.Root status="info" variant="surface">
                      <Alert.Indicator />
                      <Alert.Description textStyle="sm">
                        {config.restartHint}
                      </Alert.Description>
                    </Alert.Root>
                  )}
                </Stack>
              </Dialog.Body>
              {!isRunning && (
                <Dialog.Footer>
                  <Button
                    variant="solid"
                    colorPalette="blue"
                    onClick={() => setProgressOpen(false)}
                  >
                    Done
                  </Button>
                </Dialog.Footer>
              )}
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Re-open last run (only after a completed run, when dialog closed) */}
      {!progressOpen && stepData.length > 0 && !isRunning && (
        <HStack justifyContent="center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProgressOpen(true)}
          >
            <LuCircleCheck />
            View last run details
          </Button>
        </HStack>
      )}

      {/* ─── 6. Help & safety (collapsed) ───────────────────────────────── */}
      <Card.Root variant="outline" borderStyle="dashed">
        <Card.Body>
          <Stack gap={2}>
            <Disclosure label="Device not detected? Entering download mode">
              <Text textStyle="sm" color="fg.muted">
                {config.bootModeHint
                  .charAt(0)
                  .toUpperCase() + config.bootModeHint.slice(1)}
                .
              </Text>
            </Disclosure>
            <Separator />
            <Disclosure label="Safety & disclaimer">
              <Stack gap={2} textStyle="sm" color="fg.muted">
                <HStack gap={2} alignItems="flex-start">
                  <Box color="orange.solid" mt="0.5" display="inline-flex">
                    <LuTriangleAlert />
                  </Box>
                  <Text>
                    The likelihood of unrecoverable damage is extremely low
                    but never zero. Once an operation starts, do not
                    disconnect your device or close the tab until it
                    completes.
                  </Text>
                </HStack>
                <Text>
                  Take a backup with <b>Back up device</b> before installing
                  CrossPoint for the first time if you want a way back to
                  exactly the firmware you started on.
                </Text>
              </Stack>
            </Disclosure>
            <Separator />
            <Disclosure label="What does fast install vs. full install do?">
              <Stack gap={2} textStyle="sm" color="fg.muted">
                <Text>
                  <b>Fast install</b> writes the new firmware into your
                  device&apos;s backup OTA app slot and swaps to it. Your
                  previous firmware becomes the new backup, so if anything
                  goes wrong you can fast-install again to revert. Settings
                  are preserved. Takes ~30 seconds.
                </Text>
                <Text>
                  <b>Full install</b> writes a complete 16 MB image starting
                  at address 0 — bootloader, partition table, and app — so
                  it works from any starting state, including a wiped or
                  non-OTA partition layout. Takes ~25 minutes and erases
                  on-chip data (SD card unaffected).
                </Text>
              </Stack>
            </Disclosure>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
