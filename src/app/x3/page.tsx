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
    'hold the BOOT button (G0) while pressing the RST button, then release both',
  restartHint:
    'Once you complete a write operation, you may need to restart your Xteink X3 by pressing the RST button on the device.',
  fetchVersions: () => getX3FirmwareRemoteData().then((d) => d.x3),
  flashFirmwareAction: 'flashX3Firmware',
};

export default function X3Page() {
  return <FlashPage config={x3Config} />;
}
