// /dl/<asset> - the release proxy the Kobo Libra 2 installer fetches through,
// and the reason it has to exist.
//
// The installer at /kobo-libra2 has to fetch release assets from GitHub.
// GitHub sends no Access-Control-Allow-Origin on a release download, at either
// hop: the github.com URL answers 302 with no CORS header, and the presigned
// release-assets.githubusercontent.com URL it points at answers 206 with no
// CORS header either. A preflight against the download URL answers 404. So a
// browser on einkhub.com cannot fetch those bytes cross-origin, whatever the
// page does.
//
// A plain rewrite to the external URL does not fix it on its own, because the
// evidence is that the edge hands the upstream 302 back to the browser rather
// than following it, at which point the browser is making a cross-origin
// request to a host with no CORS headers and is stopped again. That behaviour
// is not documented either way, and the libra2-linux repository's
// docs/web-installer.md names the five minute preview test that settles it.
//
// Until that test is run, this is the route that must work: the redirect is
// followed on the server, where CORS does not exist, and the body is streamed
// back on the page's own origin. It buffers nothing. Range requests pass
// through in both directions, because the asset host honours them and a
// resumable download of a 256 MiB image is worth having.
//
// It is not a general proxy. The owner and repository are fixed here, the asset
// name is a flat filename with no path separators, and anything else is
// refused.
//
// The standalone copy of this proxy in the libra2-linux repository reads the
// asset out of the query string, and had to learn that on Vercel's Node runtime
// request.url is a path and a query with no origin, which new URL() refuses
// without a base. This copy takes the asset from the route segment and never
// parses request.url at all, so the same request answers the same way and the
// hazard is not reachable here.

const OWNER = 'juicecultus';
const REPO = 'libra2-linuxos';
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CARRIED = [
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

// A GET of an asset can take minutes on a slow line, and a 70 MB image can
// outlive the 300 s a serverless function is given. The edge runtime streams for
// as long as the download takes, so that ceiling is not there to be hit, and the
// page reports a stall rather than this file inventing a shorter limit. It is
// also where the standalone copy of this proxy runs.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function refuse(status: number, message: string) {
  return new Response(`${message}\n`, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function serve(request: Request, asset: string) {
  if (!asset) {
    return refuse(400, 'No asset named.');
  }
  if (!ASSET_RE.test(asset)) {
    return refuse(400, 'That is not an asset name.');
  }

  const upstream = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${asset}`;

  const forwarded = new Headers();
  const range = request.headers.get('range');
  if (range) {
    forwarded.set('range', range);
  }
  forwarded.set('accept', 'application/octet-stream');
  forwarded.set('user-agent', 'einkhub-installer');

  let response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers: forwarded,
      redirect: 'follow',
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return refuse(502, `The release could not be reached: ${detail}`);
  }

  if (response.status === 404) {
    return refuse(404, `No published release carries ${asset}.`);
  }
  if (!response.ok && response.status !== 206) {
    return refuse(502, `The release server answered ${response.status}.`);
  }

  const headers = new Headers();
  CARRIED.forEach((name) => {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  });
  headers.set('content-type', 'application/octet-stream');
  // The page checks every artefact against a sha256 from the manifest before it
  // sends a byte, and a manifest is small and changes with every release.
  // Nothing here is worth a stale copy.
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('x-content-type-options', 'nosniff');

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  return serve(request, asset);
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  return serve(request, asset);
}
