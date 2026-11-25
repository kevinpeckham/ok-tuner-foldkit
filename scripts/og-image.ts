// og-image.ts: takes the picture that a shared link to the site shows.
//
// What this file is. A script run by hand, not part of the app or of the
// build: `bun run og:image`. It asks Browserless, a hosted browser, for a
// screenshot of the live home page at 1200 by 630 pixels, the size link
// previews expect, and saves it as public/og-image.png. The file is
// committed, and every page's head points to it (`OG_IMAGE_URL` in
// src/site.ts).
//
// Run it again, and commit the result, when the look of the home page
// changes. The screenshot is of the live site, so deploy the new look
// first.
//
// The key. Browserless needs an API key, `BROWSERLESS_API_KEY`. It is
// declared in .env.schema and its value is in the project's 1Password
// environment. `bun run og:image` starts this script through `varlock run`,
// which resolves the environment and passes it in, so the key is never
// written to a file here. The key goes in the request's address, as
// Browserless's API asks, so the address is never printed.
//
// This file is outside src, so it is not type-checked or linted, like
// vite.config.ts. Bun runs TypeScript as it is.
import { writeFile } from 'node:fs/promises'

// What to photograph, and how large. `deviceScaleFactor: 1` keeps the file
// at exactly 1200 by 630.
const PAGE_URL = 'https://www.oktuner.com/'
const WIDTH = 1200
const HEIGHT = 630
const OUTPUT = new URL('../public/og-image.png', import.meta.url)

// Browserless has one address per region. This is its United States one.
// Set BROWSERLESS_URL to use another.
const endpoint =
  process.env['BROWSERLESS_URL'] ?? 'https://production-sfo.browserless.io'
const apiKey = process.env['BROWSERLESS_API_KEY']

if (apiKey === undefined || apiKey === '') {
  console.error(
    'BROWSERLESS_API_KEY is not set. Run this with `bun run og:image`, which loads it from 1Password.',
  )
  process.exit(1)
}

// The request, as Browserless's screenshot API takes it: the page, the size
// of the window, and when to consider the page loaded. `networkidle2`
// waits until the network has gone quiet, by which time the script has run
// and the page looks as a visitor sees it.
const response = await fetch(
  `${endpoint}/screenshot?token=${encodeURIComponent(apiKey)}`,
  {
    method: 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: PAGE_URL,
      options: { type: 'png' },
      viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
      gotoOptions: { waitUntil: 'networkidle2' },
      // The page is taller than the window, so the browser draws a
      // scrollbar down the right edge. This style, added for the photograph
      // only, hides it.
      addStyleTag: [{ content: '::-webkit-scrollbar { display: none; }' }],
    }),
  },
)

if (!response.ok) {
  // The status and Browserless's own message, and never the request's
  // address, which holds the key.
  console.error(
    `Browserless answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
  )
  process.exit(1)
}

const image = new Uint8Array(await response.arrayBuffer())
await writeFile(OUTPUT, image)
console.log(`Saved ${image.byteLength} bytes to public/og-image.png`)
