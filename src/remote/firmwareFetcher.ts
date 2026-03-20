'use server';

import { getCache } from '@vercel/functions';

interface CrossPointFirmwareVersions {
  crossPoint: {
    version: string;
    releaseDate: string;
    downloadUrl: string;
  };
}

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
    ttl: 60 * 60, // 1 hour
  });

  return data;
}

export async function getCrossPointFirmware() {
  const releaseData = await getCrossPointFirmwareRemoteData().then(
    (data) => data.crossPoint,
  );

  const response = await fetch(releaseData.downloadUrl);
  return new Uint8Array(await response.arrayBuffer());
}
