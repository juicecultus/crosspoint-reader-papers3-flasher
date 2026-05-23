'use client';

import React from 'react';
import FlashPage, { DeviceConfig } from '@/components/FlashPage';
import { getX3FirmwareRemoteData } from '@/remote/firmwareFetcher';

const x3Config: DeviceConfig = {
  deviceName: 'Xteink X3',
  chipName: 'ESP32-C3',
  firmwareLabel: 'CrossPoint X3',
  factoryNote:
    'If you want to preserve your stock firmware, use Save full flash to create a backup before flashing CrossPoint.',
  bootModeHint:
    'unplug the USB-C cable and plug it back in — the X3 will re-enumerate and be detectable again',
  restartHint:
    'Once you complete a write operation, your Xteink X3 will restart automatically. If it stays unresponsive, unplug and replug the USB-C cable.',
  fetchVersions: () => getX3FirmwareRemoteData().then((d) => d.x3),
  flashFirmwareAction: 'flashX3Firmware',
  stockFullFlash: {
    version: 'V5.1.6 EN',
    firmwareUrl: '/firmware/XT_X3_flash_V5.1.6_EN.bin',
  },
};

export default function X3Page() {
  return <FlashPage config={x3Config} />;
}
