# Paper S3 Flasher

Web based tool to help flash the M5Stack Paper S3 device with CrossPoint firmware.

## Credits

This project is based on [xteink-flasher](https://github.com/crosspoint-reader/xteink-flasher) by [Dave Allie](https://github.com/daveallie), originally created for flashing the Xteink X4 e-reader. Adapted for the M5Stack Paper S3 under the [MIT License](LICENSE).

## Devices

`/x3` and `/papers3` flash CrossPoint firmware over the Web Serial API, and they
are React pages built from the components in `src/`.

`/kobo-libra2` installs InkHub on a Kobo Libra 2 over WebUSB fastboot, and it is
not a React page. It is the static installer from the
[libra2-linux](https://github.com/juicecultus/libra2-linuxos) project, vendored
into `public/kobo-libra2` and served at `/kobo-libra2` by a rewrite in
`next.config.ts`. It fetches release assets from `/dl/<asset>`, which is
`src/app/dl/[asset]/route.ts`: GitHub sends no CORS headers on a release
download, so the redirect is followed on the server and the bytes are streamed
back on this origin.

Its own tests need nothing installed:

```
node public/kobo-libra2/tests/run.js
```

The vendored copy differs from its source in four places, and the tests fail if
any of them is lost:

1. `index.html` loads `/kobo-libra2/styles.css` and `/kobo-libra2/app.js` by
   absolute path, because the page is served from a path on this site rather
   than from the root of one of its own.
2. `index.html` carries a small bar linking back to the device list.
3. `app.js` resolves `devices/` against `import.meta.url` rather than against
   the page's URL.
4. The source's `api/dl.js` and `vercel.json` are the route handler and
   `next.config.ts` here, and `tests/run.js` checks those two files instead.

## Development

1. Run `yarn install`
2. Run `yarn dev`
