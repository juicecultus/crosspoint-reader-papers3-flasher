import type { NextConfig } from 'next';

// /dl/:asset is the release proxy the Kobo Libra 2 page fetches through, and it
// is the one route on this site that streams somebody else's bytes back on our
// origin. These are the headers the installer's own deployment carried, kept to
// that route so nothing else on the site changes.
const releaseProxyHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    optimizePackageImports: ['@chakra-ui/react'],
  },
  async headers() {
    return [{ source: '/dl/:asset', headers: releaseProxyHeaders }];
  },
};

export default nextConfig;
