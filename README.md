# OK Tuner

A chromatic instrument tuner that runs in the browser, built with [Foldkit](https://foldkit.dev). It listens to the microphone, shows the nearest note and how many cents sharp or flat it is, and lights the nearest string of the chosen tuning. Nothing is recorded.

It is a port of the tuner in Stem Shovel, written to learn Foldkit.

## How it is built

- `src/pitch.ts`: pitch detection (McLeod's method) and note naming. Pure.
- `src/tuning.ts`, `src/preferences.ts`: the tunings, and the tuning and A4 saved in `localStorage`.
- `src/microphone.ts`: opening and closing the microphone, and reading one measurement.
- `src/main.ts`: the Model, Messages, `update`, the microphone as a managed resource, and the 50 ms readings as a subscription.
- `src/sentry.ts`: everything that touches the Sentry SDK. `src/instrument.ts` starts it before the rest of the app loads.
- `src/view.ts`: the page and the tuner's face.

The design and the implementation plan are in `docs/superpowers/`.

## Commands

```bash
bun install
bun run dev        # http://localhost:5173
bun run test
bun run typecheck
bun run lint
bun run format
bun run build      # writes dist/
```

The microphone needs a secure origin: `localhost` or HTTPS.

## Environment

`.env.schema` declares the environment, loaded with [Varlock](https://varlock.dev). The tuner itself reads no environment variable. There is one secret, `SENTRY_AUTH_TOKEN`, used only when a Vercel build uploads source maps. It lives in a 1Password environment; `.env.local` (git-ignored) holds the two values that reach it, `OP_TOKEN` and `OP_ENV_ID`.

Without 1Password access, leave Varlock out:

```bash
SKIP_VARLOCK=1 bun run dev
SKIP_VARLOCK=1 bun run build
```

Tests, lint and typecheck need neither.

## Error reporting

Errors go to [Sentry](https://sentry.io), and nothing else does:

- A crash (through Foldkit's `crash.report` hook) and any uncaught error.
- A microphone that fails to open for a reason other than a refused permission or an unsupported browser. `update` returns a `ReportProblem` Command for it.

A visit where nothing goes wrong sends nothing. There is no session tracking, tracing or replay, no cookies or user identifiers, and the SDK is told not to record the IP address. Refusing the microphone and blocking site storage are choices, not errors, and are not reported.

An error report does carry the page URL, the browser's locale and timezone, and the clicks and console lines just before it. Sentry also adds an approximate location (country, region, city) on its side.

Reports are sent only from the project's own hosts, listed in `src/sentry.ts`, and tagged `production`, `preview` or `development` by hostname. A fork, or `bun run dev` on `localhost`, reports nothing.

## Deployment

Vercel builds `dist/` with the settings in `vercel.json`: pull requests get a preview, `main` is production. The Vercel project holds only `OP_TOKEN` and `OP_ENV_ID`. Each build uploads its source maps to Sentry and removes them from `dist/`; a build without the token fails. Every response carries `X-Robots-Tag: noindex` until the tuner is made public.
