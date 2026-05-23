'use client';

import { useState } from 'react';
import {
  getCrossPointFirmware,
  getX3Firmware,
  getOfficialFirmware,
  getPaperS3StockFirmware,
  getCrossPointPaperS3FullFlashParts,
} from '@/remote/firmwareFetcher';
import { downloadData } from '@/utils/download';
import { wrapWithWakeLock } from '@/utils/wakelock';
import {
  identifyFirmware,
  isIdentificationSuccessful,
  type FirmwareInfo,
} from '@/utils/firmwareIdentifier';
import OtaPartition, { OtaPartitionDetails } from './OtaPartition';
import useStepRunner from './useStepRunner';
import EspController from './EspController';

const expectedPartitionTables = [
  // CrossPoint default partition layout
  [
    { type: 'data-nvs', offset: 36864, size: 20480 },
    { type: 'data-ota', offset: 57344, size: 8192 },
    { type: 'app-ota_0', offset: 65536, size: 6553600 },
    { type: 'app-ota_1', offset: 6619136, size: 6553600 },
    { type: 'data-spiffs', offset: 13172736, size: 3538944 },
    { type: 'data-coredump', offset: 16711680, size: 65536 },
  ],
  // Official Xteink X3 partition layout
  [
    { type: 'data-nvs', offset: 36864, size: 20480 },
    { type: 'data-ota', offset: 57344, size: 8192 },
    { type: 'app-ota_0', offset: 65536, size: 7798784 },
    { type: 'app-ota_1', offset: 7864320, size: 7798784 },
    { type: 'data-spiffs', offset: 15663104, size: 1048576 },
    { type: 'data-coredump', offset: 16711680, size: 65536 },
  ],
];

interface AppPartitionInfo {
  app0Offset: number;
  app0Size: number;
  app1Offset: number;
  app1Size: number;
}

function looksLikeSingleAppFactoryLayout(
  partitionTable: { type: string; offset: number; size: number }[],
): boolean {
  // Single-app `factory` (or `test`) layout with a phy_init partition and no
  // OTA pair. This matches the stock M5Stack PaperS3 factory firmware, the
  // bmorcelli/Launcher partition table, and any other firmware that ships
  // without OTA slots — we can't reliably distinguish them by partition table
  // alone (the table has the same shape regardless of which app is installed).
  const hasPhyInit = partitionTable.some((p) => p.type === 'data-phy');
  const hasSingleAppSlot = partitionTable.some(
    (p) => p.type === 'app-factory' || p.type === 'app-test',
  );
  const hasOtaPair =
    partitionTable.some((p) => p.type === 'app-ota_0') &&
    partitionTable.some((p) => p.type === 'app-ota_1');
  return hasPhyInit && hasSingleAppSlot && !hasOtaPair;
}

function validatePartitionTable(
  partitionTable: { type: string; offset: number; size: number }[],
  deviceName?: string,
): AppPartitionInfo {
  for (const expected of expectedPartitionTables) {
    if (
      partitionTable.length === expected.length &&
      expected.every(
        (e, i) =>
          partitionTable[i]!.type === e.type &&
          partitionTable[i]!.offset === e.offset &&
          partitionTable[i]!.size === e.size,
      )
    ) {
      const app0 = partitionTable.find((p) => p.type === 'app-ota_0')!;
      const app1 = partitionTable.find((p) => p.type === 'app-ota_1')!;
      return {
        app0Offset: app0.offset,
        app0Size: app0.size,
        app1Offset: app1.offset,
        app1Size: app1.size,
      };
    }
  }

  if (deviceName === 'PaperS3' && looksLikeSingleAppFactoryLayout(partitionTable)) {
    throw new Error(
      'This device is on a single-app factory partition layout (stock M5Stack PaperS3 firmware, bmorcelli\'s Launcher, or similar). ' +
        'The CrossPoint OTA fast-flash flow needs the dual-app OTA layout, which CrossPoint installs but stock images do not provide. ' +
        'To switch to CrossPoint from a stock/Launcher install, you need a full-flash CrossPoint image — please follow the install instructions linked from the EinkHub Paper S3 page or open an issue if you\'re stuck.',
    );
  }

  throw new Error(
    `Unexpected partition configuration. You can only use OTA fast flash controls on devices running CrossPoint or official Xteink firmware with a supported partition table.\nGot ${JSON.stringify(
      partitionTable,
      null,
      2,
    )}`,
  );
}

interface UseEspOperationsOptions {
  /**
   * Optional pre-authorized SerialPort. When provided, every action reuses
   * this port instead of prompting the user via navigator.serial.requestPort().
   * The port is opened fresh for each operation and closed after — Web Serial
   * permission persists, so subsequent operations skip the chooser dialog.
   */
  serialPort?: SerialPort | null;
}

export function useEspOperations(
  { serialPort }: UseEspOperationsOptions = {},
) {
  const { stepData, initializeSteps, updateStepData, runStep } =
    useStepRunner();
  const [isRunning, setIsRunning] = useState(false);

  const wrapWithRunning =
    <Args extends unknown[], T>(fn: (...a: Args) => Promise<T>) =>
    async (...a: Args) => {
      setIsRunning(true);
      return fn(...a).finally(() => setIsRunning(false));
    };

  const acquireController = async (): Promise<EspController> => {
    const port = serialPort ?? (await EspController.requestDevice());
    const c = new EspController(port);
    await c.connect();
    return c;
  };

  const flashRemoteFirmware = async (
    getFirmware: () => Promise<Uint8Array>,
    deviceName: string,
  ) => {
    initializeSteps([
      'Connect to device',
      'Validate partition table',
      'Download firmware',
      'Read otadata partition',
      'Flash app partition',
      'Flash otadata partition',
      'Reset device',
    ]);

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const partitionInfo = await runStep('Validate partition table', async () => {
      const partitionTable = await espController.readPartitionTable();
      return validatePartitionTable(partitionTable, deviceName);
    });

    const firmwareFile = await runStep('Download firmware', getFirmware);

    const [otaPartition, backupPartitionLabel] = await runStep(
      'Read otadata partition',
      async (): Promise<
        [OtaPartition, OtaPartitionDetails['partitionLabel']]
      > => {
        const partition = await espController.readOtadataPartition((_, p, t) =>
          updateStepData('Read otadata partition', {
            progress: { current: p, total: t },
          }),
        );

        return [partition, partition.getCurrentBackupPartitionLabel()];
      },
    );

    const backupOffset = backupPartitionLabel === 'app0' ? partitionInfo.app0Offset : partitionInfo.app1Offset;
    const backupSize = backupPartitionLabel === 'app0' ? partitionInfo.app0Size : partitionInfo.app1Size;

    const flashAppPartitionStepName = `Flash app partition (${backupPartitionLabel})`;
    updateStepData('Flash app partition', { name: flashAppPartitionStepName });
    await runStep(flashAppPartitionStepName, () =>
      espController.writeAppPartition(
        backupPartitionLabel,
        firmwareFile,
        (_, p, t) =>
          updateStepData(flashAppPartitionStepName, {
            progress: { current: p, total: t },
          }),
        backupOffset,
        backupSize,
      ),
    );

    await runStep('Flash otadata partition', async () => {
      otaPartition.setBootPartition(backupPartitionLabel);

      await espController.writeOtadataPartition(otaPartition, (_, p, t) =>
        updateStepData('Flash otadata partition', {
          progress: { current: p, total: t },
        }),
      );
    });

    await runStep('Reset device', () => espController.disconnect());
  };

  const flashCrossPointFirmware = async () =>
    flashRemoteFirmware(() => getCrossPointFirmware(), 'PaperS3');

  const flashX3Firmware = async () =>
    flashRemoteFirmware(() => getX3Firmware(), 'Xteink X3');

  const flashStockEnglishFirmware = async () =>
    flashRemoteFirmware(() => getOfficialFirmware('en'), 'Xteink X3');

  const flashStockChineseFirmware = async () =>
    flashRemoteFirmware(() => getOfficialFirmware('ch'), 'Xteink X3');

  const flashCrossPointPaperS3FullFlash = async () => {
    initializeSteps([
      'Download firmware',
      'Connect to device',
      'Write flash',
      'Reset device',
    ]);

    const firmwareFile = await runStep('Download firmware', async () => {
      const { bootloader, partitions, firmware } =
        await getCrossPointPaperS3FullFlashParts();

      // ESP-IDF layout for CrossPoint Paper S3 (matches partitions.bin):
      //   0x0000   bootloader
      //   0x8000   partition table
      //   0xe000   otadata  (left as 0xff so bootloader picks app0 on first boot)
      //   0x10000  app0 (firmware.bin)
      //   rest     0xff fill
      const FLASH_SIZE = 0x1000000;
      const PARTITION_OFFSET = 0x8000;
      const APP0_OFFSET = 0x10000;

      if (bootloader.length > PARTITION_OFFSET) {
        throw new Error('bootloader.bin overflows the partition-table offset');
      }
      if (partitions.length > 0x1000) {
        throw new Error('partitions.bin is unexpectedly large');
      }
      if (APP0_OFFSET + firmware.length > FLASH_SIZE) {
        throw new Error(
          `firmware.bin (${firmware.length} bytes) overflows 16 MB flash`,
        );
      }

      const image = new Uint8Array(FLASH_SIZE).fill(0xff);
      image.set(bootloader, 0);
      image.set(partitions, PARTITION_OFFSET);
      image.set(firmware, APP0_OFFSET);
      return image;
    });

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    await runStep(
      'Write flash',
      wrapWithWakeLock(() =>
        espController.writeFullFlash(firmwareFile, (_, p, t) =>
          updateStepData('Write flash', {
            progress: { current: p, total: t },
          }),
        ),
      ),
    );

    await runStep('Reset device', () => espController.disconnect());
  };

  const flashStockPaperS3FullFlash = async () => {
    initializeSteps([
      'Download firmware',
      'Connect to device',
      'Write flash',
      'Reset device',
    ]);

    const firmwareFile = await runStep('Download firmware', async () => {
      const raw = await getPaperS3StockFirmware();
      // M5Burner ships a ~1.4 MB flash-from-0 bundle. Pad to 16 MB with 0xff
      // so writeFullFlash's exact-size contract is satisfied; trailing 0xff
      // matches erased flash and compresses to almost nothing on the wire to
      // the device.
      const FLASH_SIZE = 0x1000000;
      if (raw.length > FLASH_SIZE) {
        throw new Error(
          `Stock firmware (${raw.length} bytes) is larger than the 16 MB flash size`,
        );
      }
      const padded = new Uint8Array(FLASH_SIZE).fill(0xff);
      padded.set(raw, 0);
      return padded;
    });

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    await runStep(
      'Write flash',
      wrapWithWakeLock(() =>
        espController.writeFullFlash(firmwareFile, (_, p, t) =>
          updateStepData('Write flash', {
            progress: { current: p, total: t },
          }),
        ),
      ),
    );

    await runStep('Reset device', () => espController.disconnect());
  };

  const flashCustomFirmware = async (getFile: () => File | undefined, deviceName: string = 'PaperS3') => {
    initializeSteps([
      'Read file',
      'Connect to device',
      'Validate partition table',
      'Read otadata partition',
      'Flash app partition',
      'Flash otadata partition',
      'Reset device',
    ]);

    const fileData = await runStep('Read file', async () => {
      const file = getFile();
      if (!file) {
        throw new Error('File not found');
      }
      return new Uint8Array(await file.arrayBuffer());
    });

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const partitionInfo = await runStep('Validate partition table', async () => {
      const partitionTable = await espController.readPartitionTable();
      return validatePartitionTable(partitionTable, deviceName);
    });

    const [otaPartition, backupPartitionLabel] = await runStep(
      'Read otadata partition',
      async (): Promise<
        [OtaPartition, OtaPartitionDetails['partitionLabel']]
      > => {
        const partition = await espController.readOtadataPartition((_, p, t) =>
          updateStepData('Read otadata partition', {
            progress: { current: p, total: t },
          }),
        );

        return [partition, partition.getCurrentBackupPartitionLabel()];
      },
    );

    const backupOffset = backupPartitionLabel === 'app0' ? partitionInfo.app0Offset : partitionInfo.app1Offset;
    const backupSize = backupPartitionLabel === 'app0' ? partitionInfo.app0Size : partitionInfo.app1Size;

    const flashAppPartitionStepName = `Flash app partition (${backupPartitionLabel})`;
    updateStepData('Flash app partition', { name: flashAppPartitionStepName });
    await runStep(flashAppPartitionStepName, () =>
      espController.writeAppPartition(
        backupPartitionLabel,
        fileData,
        (_, p, t) =>
          updateStepData(flashAppPartitionStepName, {
            progress: { current: p, total: t },
          }),
        backupOffset,
        backupSize,
      ),
    );

    await runStep('Flash otadata partition', async () => {
      otaPartition.setBootPartition(backupPartitionLabel);

      await espController.writeOtadataPartition(otaPartition, (_, p, t) =>
        updateStepData('Flash otadata partition', {
          progress: { current: p, total: t },
        }),
      );
    });

    await runStep('Reset device', () => espController.disconnect());
  };

  const saveFullFlash = async () => {
    initializeSteps([
      'Connect to device',
      'Read flash',
      'Disconnect from device',
    ]);

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const firmwareFile = await runStep(
      'Read flash',
      wrapWithWakeLock(() =>
        espController.readFullFlash((_, p, t) =>
          updateStepData('Read flash', { progress: { current: p, total: t } }),
        ),
      ),
    );

    await runStep('Disconnect from device', () =>
      espController.disconnect({ skipReset: true }),
    );

    downloadData(firmwareFile, 'flash.bin', 'application/octet-stream');
  };

  const writeFullFlash = async (getFile: () => File | undefined) => {
    initializeSteps([
      'Read file',
      'Connect to device',
      'Write flash',
      'Reset device',
    ]);

    const fileData = await runStep('Read file', async () => {
      const file = getFile();
      if (!file) {
        throw new Error('File not found');
      }
      return new Uint8Array(await file.arrayBuffer());
    });

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    await runStep(
      'Write flash',
      wrapWithWakeLock(() =>
        espController.writeFullFlash(fileData, (_, p, t) =>
          updateStepData('Write flash', {
            progress: { current: p, total: t },
          }),
        ),
      ),
    );

    await runStep('Reset device', () => espController.disconnect());
  };

  const readDebugOtadata = async () => {
    initializeSteps([
      'Connect to device',
      'Read otadata partition',
      'Disconnect from device',
    ]);

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const otaPartition = await runStep('Read otadata partition', () =>
      espController.readOtadataPartition((_, p, t) =>
        updateStepData('Read otadata partition', {
          progress: { current: p, total: t },
        }),
      ),
    );

    await runStep('Disconnect from device', () =>
      espController.disconnect({ skipReset: true }),
    );

    return otaPartition;
  };

  const readAppPartition = async (partitionLabel: 'app0' | 'app1') => {
    initializeSteps([
      'Connect to device',
      `Read app partition (${partitionLabel})`,
      'Disconnect from device',
    ]);

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const data = await runStep(`Read app partition (${partitionLabel})`, () =>
      espController.readAppPartition(partitionLabel, (_, p, t) =>
        updateStepData(`Read app partition (${partitionLabel})`, {
          progress: { current: p, total: t },
        }),
      ),
    );

    await runStep('Disconnect from device', () =>
      espController.disconnect({ skipReset: true }),
    );

    return data;
  };

  const swapBootPartition = async () => {
    initializeSteps([
      'Connect to device',
      'Read otadata partition',
      'Flash otadata partition',
      'Reset device',
    ]);

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const [otaPartition, backupPartitionLabel] = await runStep(
      'Read otadata partition',
      async (): Promise<
        [OtaPartition, OtaPartitionDetails['partitionLabel']]
      > => {
        const partition = await espController.readOtadataPartition((_, p, t) =>
          updateStepData('Read otadata partition', {
            progress: { current: p, total: t },
          }),
        );

        return [partition, partition.getCurrentBackupPartitionLabel()];
      },
    );

    otaPartition.setBootPartition(backupPartitionLabel);
    await runStep('Flash otadata partition', () =>
      espController.writeOtadataPartition(otaPartition, (_, p, t) =>
        updateStepData('Flash otadata partition', {
          progress: { current: p, total: t },
        }),
      ),
    );

    await runStep('Reset device', () => espController.disconnect());

    return otaPartition;
  };

  const flashStockFullFlash = async (firmwareUrl: string) => {
    initializeSteps([
      'Download firmware',
      'Connect to device',
      'Write flash',
      'Reset device',
    ]);

    const firmwareFile = await runStep('Download firmware', async () => {
      const response = await fetch(firmwareUrl);
      if (!response.ok) {
        throw new Error(`Failed to download firmware: ${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    });

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    await runStep(
      'Write flash',
      wrapWithWakeLock(() =>
        espController.writeFullFlash(firmwareFile, (_, p, t) =>
          updateStepData('Write flash', {
            progress: { current: p, total: t },
          }),
        ),
      ),
    );

    await runStep('Reset device', () => espController.disconnect());
  };

  const fakeWriteFullFlash = async () => {
    initializeSteps([
      'Read file',
      'Connect to device',
      'Write flash',
      'Reset device',
    ]);

    await runStep(
      'Read file',
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 100);
        }),
    );

    await runStep(
      'Connect to device',
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 500);
        }),
    );

    await runStep(
      'Write flash',
      () =>
        new Promise((resolve, reject) => {
          let value = 0;
          const interval = setInterval(() => {
            if (value > 1) {
              clearInterval(interval);
              resolve(undefined);
              return;
            }

            if (value > 0.2) {
              clearInterval(interval);
              reject(new Error('Whoops, failed!'));
              return;
            }

            value += 0.001;
            updateStepData('Write flash', {
              progress: { current: value * 1000000, total: 1000000 },
            });
          }, 20);
        }),
    );

    await runStep(
      'Reset device',
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 500);
        }),
    );
  };

  const readAndIdentifyAllFirmware = async (): Promise<{
    app0: FirmwareInfo;
    app1: FirmwareInfo;
    currentBoot: 'app0' | 'app1';
  }> => {
    initializeSteps([
      'Connect to device',
      'Read otadata partition',
      'Read app0 partition',
      'Read app1 partition',
      'Identify firmware types',
      'Disconnect from device',
    ]);

    const espController = await runStep('Connect to device', async () => {
      return acquireController();
    });

    const otaPartition = await runStep('Read otadata partition', () =>
      espController.readOtadataPartition((_, p, t) =>
        updateStepData('Read otadata partition', {
          progress: { current: p, total: t },
        }),
      ),
    );

    const currentBoot = otaPartition.getCurrentBootPartitionLabel();

    const readAndIdentifyInChunks = async (partitionLabel: 'app0' | 'app1') => {
      const chunkSize = 0x6400; // 25KB
      const maxReadSize = 0x20000; // 128KB
      let readData = new Uint8Array();
      let info: FirmwareInfo | undefined;

      for (let offset = 0; offset < maxReadSize; offset += chunkSize) {
        // eslint-disable-next-line no-await-in-loop
        const chunk = await espController.readAppPartitionForIdentification(
          partitionLabel,
          {
            readSize: chunkSize,
            offset,
            onPacketReceived: (_, p, t) =>
              updateStepData(`Read ${partitionLabel} partition`, {
                // Show cumulative progress: offset + current chunk progress
                // Total shows the end of current chunk range
                progress: { current: offset + p, total: offset + t },
              }),
          },
        );

        const newData = new Uint8Array(readData.length + chunk.length);
        newData.set(readData);
        newData.set(chunk, readData.length);
        readData = newData;

        info = identifyFirmware(readData);
        if (isIdentificationSuccessful(info)) {
          return info;
        }
      }

      return (
        info ?? {
          type: 'unknown',
          version: 'unknown',
          displayName: 'Custom/Unknown Firmware',
        }
      ); // Return the last identification result if not found
    };

    const app0Info = await runStep('Read app0 partition', () =>
      readAndIdentifyInChunks('app0'),
    );

    const app1Info = await runStep('Read app1 partition', () =>
      readAndIdentifyInChunks('app1'),
    );

    await runStep('Identify firmware types', async () => {
      // This step is now just for display - identification already happened during read
    });

    await runStep('Disconnect from device', () =>
      espController.disconnect({ skipReset: true }),
    );

    return {
      app0: app0Info,
      app1: app1Info,
      currentBoot,
    };
  };

  return {
    stepData,
    isRunning,
    actions: {
      flashCrossPointFirmware: wrapWithRunning(flashCrossPointFirmware),
      flashX3Firmware: wrapWithRunning(flashX3Firmware),
      flashStockEnglishFirmware: wrapWithRunning(flashStockEnglishFirmware),
      flashStockChineseFirmware: wrapWithRunning(flashStockChineseFirmware),
      flashStockPaperS3FullFlash: wrapWithRunning(flashStockPaperS3FullFlash),
      flashCrossPointPaperS3FullFlash: wrapWithRunning(
        flashCrossPointPaperS3FullFlash,
      ),
      flashStockFullFlash: wrapWithRunning(flashStockFullFlash),
      flashCustomFirmware: wrapWithRunning(flashCustomFirmware),
      saveFullFlash: wrapWithRunning(saveFullFlash),
      writeFullFlash: wrapWithRunning(writeFullFlash),
      fakeWriteFullFlash: wrapWithRunning(fakeWriteFullFlash),
    },
    debugActions: {
      readDebugOtadata: wrapWithRunning(readDebugOtadata),
      readAppPartition: wrapWithRunning(readAppPartition),
      swapBootPartition: wrapWithRunning(swapBootPartition),
      readAndIdentifyAllFirmware: wrapWithRunning(readAndIdentifyAllFirmware),
    },
  };
}
