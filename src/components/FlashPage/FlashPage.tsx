'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Heading,
  Em,
  Separator,
  Card,
  Alert,
  Stack,
  Flex,
} from '@chakra-ui/react';
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
}

export default function FlashPage({ config }: { config: DeviceConfig }) {
  const { actions, stepData, isRunning } = useEspOperations();
  const [firmwareVersions, setFirmwareVersions] = useState<{
    version: string;
    releaseDate: string;
  } | null>(null);
  const [stockVersions, setStockVersions] = useState<{
    en: string;
    ch: string;
  } | null>(null);
  const fullFlashFileInput = useRef<FileUploadHandle>(null);
  const appPartitionFileInput = useRef<FileUploadHandle>(null);

  useEffect(() => {
    config.fetchVersions().then(setFirmwareVersions);
    config.stockFirmware?.fetchVersions().then(setStockVersions);
  }, [config]);

  const flashRemote = actions[config.flashFirmwareAction];

  return (
    <Flex direction="column" gap="20px">
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Chrome or Edge required</Alert.Title>
          <Alert.Description>
            This tool uses the Web Serial API which is <b>only supported in
            Chrome and Edge</b>. Safari, Firefox, and other browsers will not
            work. Please open this page in Chrome or Edge before proceeding.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>

      <Alert.Root status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Proceed with caution</Alert.Title>
          <Alert.Description>
            <Stack>
              <p>
                I've tried to make this foolproof and while the likelihood of
                unrecoverable things going wrong is extremely low, it's never
                zero. So proceed with care.
              </p>
              <p>
                Once you start <b>Write flash from file</b> or{' '}
                <b>Flash {config.firmwareLabel} firmware</b>, you should avoid
                disconnecting your device or closing the tab until the operation
                is complete.
              </p>
              <p>
                If your device is not detected, you may need to enter download
                mode manually: <b>{config.bootModeHint}</b>.
              </p>
            </Stack>
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>

      <Stack gap={3} as="section">
        <div>
          <Heading size="xl">Full flash controls</Heading>
          <Stack gap={1} color="grey" textStyle="sm">
            <p>
              These actions allow you to read or write the entire 16 MB flash
              of your {config.deviceName}.
            </p>
            <p>
              <b>Save full flash</b> will read your device's flash and save it
              as <Em>flash.bin</Em>. This will take around 25 minutes.
              You can use that file with <b>Write full flash from file</b> to
              restore your device later.
            </p>
            <p>
              <b>Note:</b> {config.factoryNote}
            </p>
          </Stack>
        </div>
        <Stack as="section">
          <Button
            variant="subtle"
            onClick={actions.saveFullFlash}
            disabled={isRunning}
          >
            Save full flash
          </Button>
          <Stack direction="row">
            <Flex grow={1}>
              <FileUpload ref={fullFlashFileInput} />
            </Flex>
            <Button
              variant="subtle"
              flexGrow={1}
              onClick={() =>
                actions.writeFullFlash(() =>
                  fullFlashFileInput.current?.getFile(),
                )
              }
              disabled={isRunning}
            >
              Write full flash from file
            </Button>
          </Stack>
        </Stack>
      </Stack>
      <Separator />
      <Stack gap={3} as="section">
        <div>
          <Heading size="xl">OTA fast flash controls</Heading>
          <Stack gap={1} color="grey" textStyle="sm">
            <p>
              Before using this, I'd strongly recommend taking a backup of your
              device using <b>Save full flash</b> above.
            </p>
            <p>
              <b>Flash {config.firmwareLabel} firmware</b> will download the
              latest CrossPoint firmware for {config.deviceName}, overwrite the
              backup partition with the new firmware, and swap over to using this
              partition (leaving your existing firmware as the new backup). This
              is significantly faster than a full flash write and will retain
              all your settings. If it goes wrong, it should be fine to run
              again.
            </p>
          </Stack>
        </div>
        <Stack as="section">
          <Button
            variant="subtle"
            onClick={flashRemote}
            disabled={isRunning || !firmwareVersions}
            loading={!firmwareVersions}
          >
            Flash {config.firmwareLabel} firmware (
            {firmwareVersions?.version ?? '...'}) -{' '}
            {firmwareVersions?.releaseDate ?? '...'}
          </Button>
          <Stack direction="row">
            <Flex grow={1}>
              <FileUpload ref={appPartitionFileInput} />
            </Flex>
            <Button
              variant="subtle"
              flexGrow={1}
              onClick={() =>
                actions.flashCustomFirmware(
                  () => appPartitionFileInput.current?.getFile(),
                  config.deviceName,
                )
              }
              disabled={isRunning}
            >
              Flash firmware from file
            </Button>
          </Stack>
          {process.env.NODE_ENV === 'development' && (
            <Button
              variant="subtle"
              onClick={actions.fakeWriteFullFlash}
              disabled={isRunning}
            >
              Fake write full flash
            </Button>
          )}
        </Stack>
      </Stack>
      {config.stockFirmware && (
        <>
          <Separator />
          <Stack gap={3} as="section">
            <div>
              <Heading size="xl">Stock firmware</Heading>
              <Stack gap={1} color="grey" textStyle="sm">
                <p>
                  Restore your {config.deviceName} to the official Xteink stock
                  firmware. This uses OTA fast flash and requires the device to
                  already be running CrossPoint or stock firmware with the
                  default partition table.
                </p>
              </Stack>
            </div>
            <Stack as="section">
              <Button
                variant="subtle"
                onClick={actions.flashStockEnglishFirmware}
                disabled={isRunning || !stockVersions}
                loading={!stockVersions}
              >
                Flash stock English firmware ({stockVersions?.en ?? '...'})
              </Button>
              <Button
                variant="subtle"
                onClick={actions.flashStockChineseFirmware}
                disabled={isRunning || !stockVersions}
                loading={!stockVersions}
              >
                Flash stock Chinese firmware ({stockVersions?.ch ?? '...'})
              </Button>
            </Stack>
          </Stack>
        </>
      )}
      <Separator />
      <Card.Root variant="subtle">
        <Card.Header>
          <Heading size="lg">Steps</Heading>
        </Card.Header>
        <Card.Body>
          {stepData.length > 0 ? (
            <Steps steps={stepData} />
          ) : (
            <Alert.Root status="info" variant="surface">
              <Alert.Indicator />
              <Alert.Title>
                Progress will be shown here once you start an operation
              </Alert.Title>
            </Alert.Root>
          )}
        </Card.Body>
      </Card.Root>
      <Alert.Root status="info">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Device restart instructions</Alert.Title>
          <Alert.Description>
            {config.restartHint}
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Flex>
  );
}
