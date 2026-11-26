# OK Tuner

A chromatic instrument tuner that runs in the browser, built with [Foldkit](https://foldkit.dev). It listens to the microphone, shows the nearest note and how many cents sharp or flat it is, and lights the nearest string of the chosen tuning. Nothing is recorded.

It is a port of the tuner in Stem Shovel, written to learn Foldkit. Live at <https://www.oktuner.com/>.

## How it is built

- `src/pitch.ts`: pitch detection (McLeod's method) and note naming. Pure.
- `src/tuning.ts`, `src/preferences.ts`: the tunings, and the tuning and A4 saved in `localStorage`.
- `src/microphone.ts`: opening and closing the microphone, and reading one measurement.
- `src/main.ts`: the Model, Messages, `update`, the microphone as a managed resource, and the 50 ms readings as a subscription.
- `src/entry.server.ts`: how the build writes each page as an HTML file. `src/entry.ts` is the browser's half, which takes that HTML over.
- `src/route.ts`: the pages as routes: the tuner at `/`, "How to use the tuner" at `/how-to`, "Built with" at `/built-with`, "Privacy" at `/privacy`, and a not-found page.
- `src/sentry.ts`: everything that touches the Sentry SDK. `src/instrument.ts` starts it before the rest of the app loads.
- `src/view.ts`: what every page shares, and the tuner's face. `src/page/` holds the other pages, `src/header.ts` the brand at the top and `src/footer.ts` the footer.
- `src/analytics.ts`: counting page views on the live site. Everything that touches `@vercel/analytics`.
- `src/site.ts`: the version and the addresses the footer and the Built With page link to.

The design and the implementation plan are in `docs/superpowers/`. Gotchas, and the reasons behind the less obvious choices, are in [`FINDINGS.md`](./FINDINGS.md). Planned work is in [`docs/backlog.md`](./docs/backlog.md).

## Reading the code

The source is commented for someone learning Foldkit: each file opens with what it is and where it sits, and each declaration says what it does. A good order:

1. `src/entry.ts`: how the app is handed to the Foldkit runtime in the browser. Then `src/entry.server.ts`: how the same app is drawn into HTML files by the build.
2. `src/main.ts`: the Model, the Messages, `update`, Commands, the managed resource and the subscription. Most of Foldkit is here.
3. `src/route.ts`: routing, in one short file. Read it with the ROUTING part of the header of `main.ts`.
4. `src/view.ts`, then `src/page/`: how the Model becomes the page, and how the page sends Messages.
5. `src/story.test.ts` and `src/scene.test.ts`: how `update` and the view are tested.
6. `src/microphone.ts`, `src/pitch.ts`, `src/tuning.ts`, `src/preferences.ts`, `src/sentry.ts`: the parts Foldkit calls into.
7. `vite.config.ts`, `.env.schema`: the build.

[`FOLDKIT.md`](./FOLDKIT.md) is Foldkit's own guide to the architecture and its conventions.

## Commands

```bash
bun install
bun run dev        # http://localhost:5173
bun run test
bun run typecheck
bun run lint
bun run format
bun run build      # writes dist/client (the site) and dist/server
bun run preview    # serves dist/client; open /how-to/ with the trailing slash
bun run og:image   # retakes public/og-image.png (needs 1Password access)
```

The microphone needs a secure origin: `localhost` or HTTPS.

## Environment

`.env.schema` declares the environment, loaded with [Varlock](https://varlock.dev). The tuner itself reads no environment variable. There are two secrets: `SENTRY_AUTH_TOKEN`, used only when a Vercel build uploads source maps, and `BROWSERLESS_API_KEY`, used only by `bun run og:image`. They live in a 1Password environment; `.env.local` (git-ignored) holds the two values that reach it, `OP_TOKEN` and `OP_ENV_ID`.

Without 1Password access, leave Varlock out:

```bash
SKIP_VARLOCK=1 bun run dev
SKIP_VARLOCK=1 bun run build
```

Tests, lint and typecheck need neither.

## Privacy

Two things leave the browser, and the site's Privacy page (`src/page/privacy.ts`, at `/privacy`) tells visitors about both: error reports, and page-view counts. The microphone's sound never does.

## Visitor counts

The live site counts page views with [Vercel Web Analytics](https://vercel.com/docs/analytics) (`src/analytics.ts`). The script is served from the site's own address, sets no cookie, and is loaded on the production hostnames only: not on previews, the dev server or `localhost`. Web Analytics also has to be switched on for the project in Vercel.

## Error reporting

Errors go to [Sentry](https://sentry.io), and nothing else goes there:

- A crash (through Foldkit's `crash.report` hook) and any uncaught error.
- A microphone that fails to open for a reason the app does not know. `update` returns a `ReportProblem` Command for it. A refused permission, an unsupported browser, no microphone, a microphone in use elsewhere, and a microphone unplugged mid-session are not reported: each gets a plain sentence on the page.

A visit where nothing goes wrong sends Sentry nothing. There is no session tracking, tracing or replay, no cookies or user identifiers, and the SDK is told not to record the IP address. Refusing the microphone and blocking site storage are choices, not errors, and are not reported.

An error report does carry the page URL, the browser's locale and timezone, and the clicks and console lines just before it. Sentry also adds an approximate location (country, sometimes a city) on its side, although it stores no IP address.

Reports are sent only from the project's own hosts, listed in `src/sentry.ts`, and tagged `production` or `development` by hostname: the live site and the project's dev server. A fork, a Vercel preview, or `bun run dev` on `localhost`, reports nothing. The Sentry project's Allowed Domains setting holds the same hosts, so Sentry drops a report from anywhere else.

## License

[Apache License 2.0](./LICENSE), the same as Stem Shovel, which the tuner is ported from. © 2026 Lightning Jar.

## Search engines and link previews

The live site is public. Each page has a canonical address, a description and Open Graph tags, written into its HTML by `src/entry.server.ts`; `public/sitemap.xml` and `public/robots.txt` are served as they are. The preview picture, `public/og-image.png`, is a screenshot of the home page taken through [Browserless](https://www.browserless.io) by `bun run og:image`. Only `www.oktuner.com` is indexed: `vercel.json` marks every other host `noindex`, and sets the Content Security Policy and the other security headers.

## Deployment

The site is prerendered: a build writes each page as an HTML file, and Vercel serves the files in `dist/client` with the settings in `vercel.json`. There is no server at run time. Pull requests get a preview, `main` is production. An address with no file is a 404, answered with `404.html`: the app's own not-found page, drawn by the build like the others. The Vercel project holds only `OP_TOKEN` and `OP_ENV_ID`. Each build uploads the browser bundle's source maps to Sentry and removes them from the output; a build without the token fails. Responses from any host other than `www.oktuner.com` carry `X-Robots-Tag: noindex`.
