# OK Tuner

A chromatic instrument tuner that runs in the browser, built with [Foldkit](https://foldkit.dev). It listens to the microphone, shows the nearest note and how many cents sharp or flat it is, and lights the nearest string of the chosen tuning. Nothing is recorded.

It is a port of the tuner in Stem Shovel, written to learn Foldkit.

## How it is built

- `src/pitch.ts`: pitch detection (McLeod's method) and note naming. Pure.
- `src/tuning.ts`, `src/preferences.ts`: the tunings, and the tuning and A4 saved in `localStorage`.
- `src/microphone.ts`: opening and closing the microphone, and reading one measurement.
- `src/main.ts`: the Model, Messages, `update`, the microphone as a managed resource, and the 50 ms readings as a subscription.
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

## Deployment

Vercel builds `dist/` with the settings in `vercel.json`. Every response carries `X-Robots-Tag: noindex` until the tuner is made public.
