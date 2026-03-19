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
import { getCrossPointFirmwareRemoteData } from '@/remote/firmwareFetcher';

export default function Home() {
  const { actions, stepData, isRunning } = useEspOperations();
  const [crossPointFirmwareVersions, setCrossPointFirmwareVersions] = useState<{
    crossPoint: { version: string; releaseDate: string };
  } | null>(null);
  const fullFlashFileInput = useRef<FileUploadHandle>(null);
  const appPartitionFileInput = useRef<FileUploadHandle>(null);

  useEffect(() => {
    getCrossPointFirmwareRemoteData().then(setCrossPointFirmwareVersions);
  }, []);

  return (
    <Flex direction="column" gap="20px">
      <Alert.Root status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Proceed with caution</Alert.Title>
          <Alert.Description>
            <Stack>
              <p>
                I've tried to make this foolproof and while the likelihood of
                unrecoverable things going wrong is extremely low, it's never
                zero. So proceed with care and make sure to grab a backup using{' '}
                <b>Save full flash</b> before flashing your device.
              </p>
              <p>
                Once you start <b>Write flash from file</b> or{' '}
                <b>Flash CrossPoint firmware</b>, you should avoid disconnecting
                your device or closing the tab until the operation is complete.
                Writing a full flash from your backup should always restore your
                device to its old state.
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
              These actions will allow you to take a full backup of your M5Stack
              Paper S3 device in order to be able to restore it in the case that
              anything goes wrong.
            </p>
            <p>
              <b>Save full flash</b> will read your device's flash and save it
              as <Em>flash.bin</Em>. This will take around 25 minutes to
              complete. You can use that file (or someone else's) with{' '}
              <b>Write full flash from file</b> to overwrite your device's
              entire flash.
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
              <b>Flash CrossPoint firmware</b> will download the latest
              CrossPoint firmware for M5Stack Paper S3, overwrite the backup
              partition with the new firmware, and swap over to using this
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
            onClick={actions.flashCrossPointFirmware}
            disabled={isRunning || !crossPointFirmwareVersions}
            loading={!crossPointFirmwareVersions}
          >
            Flash CrossPoint firmware (
            {crossPointFirmwareVersions?.crossPoint.version ?? '...'}) -{' '}
            {crossPointFirmwareVersions?.crossPoint.releaseDate ?? '...'}
          </Button>
          <Stack direction="row">
            <Flex grow={1}>
              <FileUpload ref={appPartitionFileInput} />
            </Flex>
            <Button
              variant="subtle"
              flexGrow={1}
              onClick={() =>
                actions.flashCustomFirmware(() =>
                  appPartitionFileInput.current?.getFile(),
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
            Once you complete a write operation, you may need to restart your
            M5Stack Paper S3 device by pressing the reset button.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Flex>
  );
}
