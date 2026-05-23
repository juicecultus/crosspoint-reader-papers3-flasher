'use client';

import React from 'react';
import FlashPage, { DeviceConfig } from '@/components/FlashPage';
import {
  getCrossPointFirmwareRemoteData,
  getPaperS3StockFirmwareRemoteData,
} from '@/remote/firmwareFetcher';

const paperS3Config: DeviceConfig = {
  deviceName: 'M5Stack Paper S3',
  chipName: 'ESP32-S3',
  firmwareLabel: 'CrossPoint PaperS3',
  factoryNote:
    'Use Save full flash to back up your device before flashing CrossPoint PaperS3. The Stock firmware section below can also restore the official M5Stack factory image via OTA fast flash if the original partition layout is still intact.',
  bootModeHint:
    'hold the BOOT button (G0) while pressing the RST button, then release both',
  restartHint:
    'Once you complete a write operation, you may need to restart your M5Stack Paper S3 by pressing the RST button on the side of the device.',
  fetchVersions: () =>
    getCrossPointFirmwareRemoteData().then((d) => d.crossPoint),
  flashFirmwareAction: 'flashCrossPointFirmware',
  stockOtaFirmware: {
    buttonLabel: 'Flash stock M5Stack PaperS3 firmware',
    sourceNote:
      'Mirrored from the official M5Burner catalog (PaperS3 Factory Test).',
    fetchVersion: () =>
      getPaperS3StockFirmwareRemoteData().then((d) => ({
        version: d.version,
        releaseDate: d.releaseDate,
      })),
    flashAction: 'flashStockPaperS3Firmware',
  },
};

export default function PaperS3Page() {
  return <FlashPage config={paperS3Config} />;
}
