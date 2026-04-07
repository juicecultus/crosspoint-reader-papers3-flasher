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
import { getCrossPointFirmwareRemoteData, getX3FirmwareRemoteData } from '@/remote/firmwareFetcher';

export default function Home() {
  const { actions, stepData, isRunning } = useEspOperations();
  const [crossPointFirmwareVersions, setCrossPointFirmwareVersions] = useState<{
    crossPoint: { version: string; releaseDate: string };
  } | null>(null);
  const [x3FirmwareVersions, setX3FirmwareVersions] = useState<{
    x3: { version: string; releaseDate: string };
  } | null>(null);
  const fullFlashFileInput = useRef<FileUploadHandle>(null);
  const appPartitionFileInput = useRef<FileUploadHandle>(null);

  useEffect(() => {
    getCrossPointFirmwareRemoteData().then(setCrossPointFirmwareVersions);
    getX3FirmwareRemoteData().then(setX3FirmwareVersions);
  }, []);

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
                <b>Flash CrossPoint PaperS3 firmware</b>, you should avoid disconnecting
                your device or closing the tab until the operation is complete.
              </p>
              <p>
                If your device is not detected, you may need to enter download
                mode manually: <b>hold the BOOT button (G0) while pressing
                the RST button</b>, then release both.
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
              of your M5Stack Paper S3.
            </p>
            <p>
              <b>Save full flash</b> will read your device's flash and save it
              as <Em>flash.bin</Em>. This will take around 25 minutes.
              You can use that file with <b>Write full flash from file</b> to
              restore your device later.
            </p>
            <p>
              <b>Note:</b> The M5Stack Paper S3 does not ship with downloadable
              factory firmware. If you want to preserve your stock firmware, use{' '}
              <b>Save full flash</b> to create a backup <Em>before</Em> flashing
              CrossPoint PaperS3. There is no other way to restore the original M5Stack
              firmware.
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
          <Heading size="xl">Xteink X3 firmware</Heading>
          <Stack gap={1} color="grey" textStyle="sm">
            <p>
              Flash the latest CrossPoint firmware for the <b>Xteink X3</b> e-reader.
              This is a preview release with improved text antialiasing (grayscale
              rendering, reduced white lines, reduced ghosting).
            </p>
            <p>
              Before using this, I'd strongly recommend taking a backup of your
              device using <b>Save full flash</b> above.
            </p>
          </Stack>
        </div>
        <Stack as="section">
          <Button
            variant="subtle"
            onClick={actions.flashX3Firmware}
            disabled={isRunning || !x3FirmwareVersions}
            loading={!x3FirmwareVersions}
          >
            Flash CrossPoint X3 firmware (
            {x3FirmwareVersions?.x3.version ?? '...'}) -{' '}
            {x3FirmwareVersions?.x3.releaseDate ?? '...'}
          </Button>
        </Stack>
      </Stack>
      <Separator />
      <Stack gap={3} as="section">
        <div>
          <Heading size="xl">M5Stack Paper S3 firmware</Heading>
          <Stack gap={1} color="grey" textStyle="sm">
            <p>
              Before using this, I'd strongly recommend taking a backup of your
              device using <b>Save full flash</b> above.
            </p>
            <p>
              <b>Flash CrossPoint PaperS3 firmware</b> will download the latest
              CrossPoint PaperS3 firmware for M5Stack Paper S3, overwrite the backup
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
            Flash CrossPoint PaperS3 firmware (
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
            M5Stack Paper S3 by pressing the <b>RST</b> button on the side of
            the device.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Flex>
  );
}
