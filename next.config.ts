import type { NextConfig } from 'next';

// The Kobo Libra 2 installer is the one page on this site that is not React. It
// is plain HTML, CSS and modules, it lives in public/kobo-libra2, and it is
// vendored from the libra2-linux repository with its own tests. These headers
// are the ones its own deployment carries, kept to that route so nothing else
// on the site changes.
const installerHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    optimizePackageImports: ['@chakra-ui/react'],
  },
  async rewrites() {
    return [
      // /kobo-libra2 is the address in the device list, and the file behind it
      // is the installer's own index.html.
      { source: '/kobo-libra2', destination: '/kobo-libra2/index.html' },
    ];
  },
  async headers() {
    return [
      { source: '/kobo-libra2', headers: installerHeaders },
      { source: '/kobo-libra2/:path*', headers: installerHeaders },
      { source: '/dl/:asset', headers: installerHeaders },
      {
        // The file the rewrite serves is reachable under its own name as well.
        // One address for the page is enough for a search engine.
        source: '/kobo-libra2/index.html',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ];
  },
};

export default nextConfig;
