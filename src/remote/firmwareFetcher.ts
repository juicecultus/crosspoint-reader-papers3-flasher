'use server';

import { getCache } from '@vercel/functions';

interface FirmwareRelease {
  version: string;
  releaseDate: string;
  downloadUrl: string;
}

interface CrossPointFirmwareVersions {
  crossPoint: FirmwareRelease;
}

interface X3FirmwareVersions {
  x3: FirmwareRelease;
}

interface OfficialFirmwareData {
  change_log: string;
  download_url: string;
  version: string;
}

interface OfficialFirmwareVersions {
  en: OfficialFirmwareData;
  ch: OfficialFirmwareData;
}

const officialFirmwareVersionFallback: OfficialFirmwareVersions = {
  en: {
    change_log:
      '1. Optimize EPUB/TXT  \r\n2. Optimize JPG speed  \r\n3. Optimize Wi-Fi connection  \r\n4. Optimize EPUB covers',
    download_url:
      'http://gotaserver.xteink.com/api/download/ESP32C3/V3.1.1/V3.1.1-EN.bin',
    version: 'V3.1.1',
  },
  ch: {
    change_log:
      '1.优化蓝牙卡死\r\n2.优化epub,阻止打开加密书籍\r\n3.优化文件时间写入逻辑\r\n4.调整XTC/XTCH用的灰度波形\r\n5.需重建索引',
    download_url:
      'http://47.122.74.33:5000/api/download/ESP32C3/V3.1.9/V3.1.9_CH_X4_0117.bin',
    version: 'V3.1.9',
  },
};

const chineseFirmwareCheckUrl =
  'http://47.122.74.33:5000/api/check-update?current_version=V3.0.1&device_type=ESP32C3';
const englishFirmwareCheckUrl =
  'http://gotaserver.xteink.com/api/check-update?current_version=V3.0.1&device_type=ESP32C3&device_id=1234';

export async function getCrossPointFirmwareRemoteData(): Promise<CrossPointFirmwareVersions> {
  const cache = getCache();
  const cacheKey = 'firmware-versions.crosspoint-papers3.v2';

  const value = (await cache.get(cacheKey)) as CrossPointFirmwareVersions | null;
  if (value) {
    return value;
  }

  const releaseData = await fetch(
    'https://api.github.com/repos/juicecultus/crosspoint-reader-papers3/releases/latest',
  ).then((resp) => resp.json());

  const firmwareAsset = releaseData.assets.find((asset: any) =>
    asset.name.endsWith('firmware.bin'),
  );
  if (!firmwareAsset) {
    throw new Error('CrossPoint Paper S3 firmware asset not found');
  }

  const data = {
    crossPoint: {
      version: releaseData.tag_name,
      releaseDate: new Date(releaseData.published_at)
        .toISOString()
        .slice(0, 10),
      downloadUrl: firmwareAsset.browser_download_url,
    },
  };

  await cache.set(cacheKey, data, {
    ttl: 60 * 5, // 5 minutes
  });

  return data;
}

interface CrossPointPaperS3FullFlashParts {
  bootloader: Uint8Array;
  partitions: Uint8Array;
  firmware: Uint8Array;
}

// Fetches all three assets of the latest crosspoint-reader-papers3 release
// (bootloader / partitions / firmware) so the client can stitch them into a
// flash-from-0 image. This is what users on a single-app factory layout (stock
// M5Stack or Launcher) need to migrate to CrossPoint — the OTA fast-flash path
// can't work from that starting state because there's no second app slot.
// Server-side concatenation would balloon the response with 14 MB of 0xff
// padding, so the client does the padding instead.
export async function getCrossPointPaperS3FullFlashParts(): Promise<CrossPointPaperS3FullFlashParts> {
  const release = await fetch(
    'https://api.github.com/repos/juicecultus/crosspoint-reader-papers3/releases/latest',
  ).then((r) => r.json());

  const findAsset = (suffix: string) => {
    const asset = release.assets.find((a: { name: string }) =>
      a.name.endsWith(suffix),
    );
    if (!asset) {
      throw new Error(
        `CrossPoint Paper S3 release is missing required asset: ${suffix}`,
      );
    }
    return asset.browser_download_url as string;
  };

  const [bootloader, partitions, firmware] = await Promise.all([
    fetch(findAsset('bootloader.bin')).then((r) => r.arrayBuffer()),
    fetch(findAsset('partitions.bin')).then((r) => r.arrayBuffer()),
    fetch(findAsset('firmware.bin')).then((r) => r.arrayBuffer()),
  ]);

  return {
    bootloader: new Uint8Array(bootloader),
    partitions: new Uint8Array(partitions),
    firmware: new Uint8Array(firmware),
  };
}

export async function getCrossPointFirmware() {
  const releaseData = await getCrossPointFirmwareRemoteData().then(
    (data) => data.crossPoint,
  );

  const response = await fetch(releaseData.downloadUrl);
  return new Uint8Array(await response.arrayBuffer());
}

export async function getX3FirmwareRemoteData(): Promise<X3FirmwareVersions> {
  const cache = getCache();
  const cacheKey = 'firmware-versions.crosspoint-x3.v4';

  const value = (await cache.get(cacheKey)) as X3FirmwareVersions | null;
  if (value) {
    return value;
  }

  const releaseData = await fetch(
    'https://api.github.com/repos/juicecultus/crosspoint-reader/releases/latest',
  ).then((resp) => resp.json());

  const firmwareAsset = releaseData.assets.find((asset: any) =>
    asset.name.endsWith('firmware.bin'),
  );
  if (!firmwareAsset) {
    throw new Error('CrossPoint X3 firmware asset not found');
  }

  const data = {
    x3: {
      version: releaseData.tag_name,
      releaseDate: new Date(releaseData.published_at)
        .toISOString()
        .slice(0, 10),
      downloadUrl: firmwareAsset.browser_download_url,
    },
  };

  await cache.set(cacheKey, data, {
    ttl: 60 * 5, // 5 minutes
  });

  return data;
}

export async function getX3Firmware() {
  const releaseData = await getX3FirmwareRemoteData().then(
    (data) => data.x3,
  );

  const response = await fetch(releaseData.downloadUrl);
  return new Uint8Array(await response.arrayBuffer());
}

// M5Stack publishes the Paper S3 stock/factory firmware exclusively via
// M5Burner (only x64 Mac/Windows builds available), making it unreachable for
// many users. The M5Burner desktop app fetches its catalog from this public
// API, which we reuse here to mirror the "PaperS3 Factory Test" image.
const M5BURNER_API = 'http://m5burner-api.m5stack.com/api/firmware';
const M5BURNER_CDN = 'https://m5burner-cdn.m5stack.com/firmware';
const PAPERS3_FACTORY_FID = 'bbb47b2c310a17a21815fded729482e1';

interface M5BurnerFirmwareVersion {
  version: string;
  published_at: string;
  file: string;
  published: boolean;
  change_log?: string;
}

interface PaperS3StockFirmwareData {
  version: string;
  releaseDate: string;
  downloadUrl: string;
}

export async function getPaperS3StockFirmwareRemoteData(): Promise<PaperS3StockFirmwareData> {
  const cache = getCache();
  const cacheKey = 'firmware-versions.papers3-stock.v1';

  const value = (await cache.get(cacheKey)) as PaperS3StockFirmwareData | null;
  if (value) {
    return value;
  }

  const catalog = (await fetch(M5BURNER_API).then((r) => r.json())) as Array<{
    fid: string;
    name: string;
    versions: M5BurnerFirmwareVersion[];
  }>;

  const entry = catalog.find((fw) => fw.fid === PAPERS3_FACTORY_FID);
  if (!entry) {
    throw new Error(
      'Paper S3 Factory Test firmware entry not found in M5Burner catalog',
    );
  }

  const publishedVersions = entry.versions.filter((v) => v.published);
  if (publishedVersions.length === 0) {
    throw new Error('No published Paper S3 Factory Test firmware versions available');
  }

  // Catalog lists versions in chronological order; last published entry is latest.
  const latest = publishedVersions[publishedVersions.length - 1]!;

  const data: PaperS3StockFirmwareData = {
    version: latest.version.trim(),
    releaseDate: latest.published_at,
    downloadUrl: `${M5BURNER_CDN}/${latest.file}`,
  };

  await cache.set(cacheKey, data, {
    ttl: 60 * 60, // 1 hour
  });

  return data;
}

export async function getPaperS3StockFirmware() {
  // Returns the raw M5Burner flash-from-0 bundle (~1.4 MB, bootloader +
  // partition table + factory app). The client pads this to the 16 MB
  // writeFullFlash contract — avoids shipping 14 MB of 0xff over the wire.
  const { downloadUrl } = await getPaperS3StockFirmwareRemoteData();
  const response = await fetch(downloadUrl);
  return new Uint8Array(await response.arrayBuffer());
}

export async function getOfficialFirmwareRemoteData(): Promise<OfficialFirmwareVersions> {
  const cache = getCache();
  const cacheKey = 'firmware-versions.official.v1';

  const value = (await cache.get(cacheKey)) as OfficialFirmwareVersions | null;
  if (value) {
    return value;
  }

  return Promise.all([
    fetch(chineseFirmwareCheckUrl),
    fetch(englishFirmwareCheckUrl),
  ])
    .then(([chRes, enRes]) => Promise.all([chRes.json(), enRes.json()]))
    .then(async ([chData, enData]) => {
      const data: OfficialFirmwareVersions = {
        en: enData.data,
        ch: chData.data,
      };

      await cache.set(cacheKey, data, {
        ttl: 60 * 60 * 24, // 24 hours
      });

      return data;
    })
    .catch(() => officialFirmwareVersionFallback);
}

export async function getOfficialFirmwareVersions() {
  const data = await getOfficialFirmwareRemoteData();

  return {
    en: data.en.version,
    ch: data.ch.version,
  };
}

export async function getOfficialFirmware(region: 'en' | 'ch') {
  const url = await getOfficialFirmwareRemoteData().then(
    (data) => data[region].download_url,
  );
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}
