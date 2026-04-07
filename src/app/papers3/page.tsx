'use client';

import React from 'react';
import FlashPage, { DeviceConfig } from '@/components/FlashPage';
import { getCrossPointFirmwareRemoteData } from '@/remote/firmwareFetcher';

const paperS3Config: DeviceConfig = {
  deviceName: 'M5Stack Paper S3',
  chipName: 'ESP32-S3',
  firmwareLabel: 'CrossPoint PaperS3',
  factoryNote:
    'The M5Stack Paper S3 does not ship with downloadable factory firmware. If you want to preserve your stock firmware, use Save full flash to create a backup before flashing CrossPoint PaperS3. There is no other way to restore the original M5Stack firmware.',
  bootModeHint:
    'hold the BOOT button (G0) while pressing the RST button, then release both',
  restartHint:
    'Once you complete a write operation, you may need to restart your M5Stack Paper S3 by pressing the RST button on the side of the device.',
  fetchVersions: () =>
    getCrossPointFirmwareRemoteData().then((d) => d.crossPoint),
  flashFirmwareAction: 'flashCrossPointFirmware',
};

export default function PaperS3Page() {
  return <FlashPage config={paperS3Config} />;
}
