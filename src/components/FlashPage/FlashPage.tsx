'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  HStack,
  Separator,
  Stack,
  Text,
} from '@chakra-ui/react';
import {
  LuChevronDown,
  LuChevronRight,
  LuCircleAlert,
  LuCircleCheck,
  LuDownload,
  LuHardDrive,
  LuRotateCcw,
  LuScanSearch,
  LuTriangleAlert,
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
  const { actions, debugActions, stepData, isRunning } = useEspOperations();

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

  // ─── Scroll progress card into view when an operation starts ───────────
  const progressRef = useRef<HTMLDivElement | null>(null);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (isRunning && progressRef.current) {
      progressRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
    // When a fresh operation starts, invalidate any cached identify result —
    // the partition state may have changed once the operation completes.
    if (isRunning && !wasRunningRef.current) {
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
            <HStack justifyContent="space-between" alignItems="flex-start">
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
                <Text color="fg.muted" textStyle="sm">
                  {config.chipName}
                </Text>
              </Stack>
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
                Identify current firmware
              </Button>
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
                Click <b>Identify</b> to read both app partitions and detect
                what&apos;s currently installed. Optional — every action below
                works without identifying first.
              </Text>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* ─── 2. Primary: install / update CrossPoint ────────────────────── */}
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

      {/* ─── 4. Reset to factory ────────────────────────────────────────── */}
      {hasResetSection && (
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
      )}

      {/* ─── 5. Progress card (scrolls into view on start) ──────────────── */}
      <Box ref={progressRef}>
      <Card.Root variant="subtle">
        <Card.Body>
          <Stack gap={3}>
            <HStack justifyContent="space-between" alignItems="center">
              <Heading size="md">Progress</Heading>
              {isRunning ? (
                <HStack gap={1} color="blue.solid" textStyle="sm">
                  <LuCircleAlert />
                  <Text>Running — do not disconnect</Text>
                </HStack>
              ) : stepData.length > 0 ? (
                <HStack gap={1} color="green.solid" textStyle="sm">
                  <LuCircleCheck />
                  <Text>Last run complete</Text>
                </HStack>
              ) : null}
            </HStack>
            {stepData.length > 0 ? (
              <Steps steps={stepData} />
            ) : (
              <Text color="fg.muted" textStyle="sm">
                Progress will appear here once you start an operation.
              </Text>
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
        </Card.Body>
      </Card.Root>
      </Box>

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
