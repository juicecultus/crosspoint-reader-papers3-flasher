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
    "Use Save full flash to back up your device before flashing CrossPoint PaperS3. If you ever need to return to factory, the Stock firmware recovery section below will fully restore the original M5Stack image — even if you've previously installed a custom partition layout (e.g. bmorcelli's Launcher).",
  bootModeHint:
    'with the device connected via USB, long-press the side power button until the status light on the back flashes red — that signals download mode',
  restartHint:
    'Once you complete a write operation, you may need to restart your M5Stack Paper S3 by pressing the RST button on the side of the device.',
  fetchVersions: () =>
    getCrossPointFirmwareRemoteData().then((d) => d.crossPoint),
  flashFirmwareAction: 'flashCrossPointFirmware',
  crossPointFullFlash: {
    buttonLabel: 'Install CrossPoint PaperS3',
    fetchVersion: () =>
      getCrossPointFirmwareRemoteData().then((d) => d.crossPoint),
    flashAction: 'flashCrossPointPaperS3FullFlash',
  },
  dynamicStockFullFlash: {
    buttonLabel: 'Flash stock M5Stack PaperS3 firmware',
    sourceNote:
      'Mirrored from the official M5Burner catalog (PaperS3 Factory Test).',
    fetchVersion: () =>
      getPaperS3StockFirmwareRemoteData().then((d) => ({
        version: d.version,
        releaseDate: d.releaseDate,
      })),
    flashAction: 'flashStockPaperS3FullFlash',
  },
};

export default function PaperS3Page() {
  return <FlashPage config={paperS3Config} />;
}
