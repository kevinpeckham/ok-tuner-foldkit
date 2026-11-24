# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

Domain vocabulary, deployment steps, local conventions that differ from Foldkit's defaults: write them here.

### Dev server on the lj-bench VM

A persistent dev server runs as the systemd user service `ok-tuner-dev` (launcher `~/bin/ok-tuner-dev`) on `localhost:5273`. Caddy serves it at <https://ok-tuner.bench.lj.dev/>, reachable only from the tailnet. Do not start a second `bun run dev`: edit the source and the running server hot-reloads.

- Restart: `systemctl --user restart ok-tuner-dev`
- Logs: `journalctl --user -u ok-tuner-dev -f`

The port and the allowed host are passed by the launcher, so `vite.config.ts` carries nothing specific to the VM.

### What this app is

OK Tuner is a port of the Stem Shovel guitar tuner (`~/projects/stem-shovel`, `src/lib/components/Tuner.svelte`), written to learn Foldkit. The design is `docs/superpowers/specs/2026-11-24-tuner-design.md`.

### Environment and secrets

- `.env.schema` (committed) declares the environment; Varlock loads it, with values from one 1Password environment. Read the `varlock-docs-mcp` server before changing the schema.
- `.env.local` holds only `OP_TOKEN` and `OP_ENV_ID`. Never open or print it, and never run `varlock load --format …`, `varlock printenv` or `varlock reveal` in a session. `bunx varlock load --agent` is the safe look.
- A new secret goes in `.env.schema`, marked sensitive, and its value into 1Password, which Kevin does. Never into `.env.local` or the Vercel project, which holds only `OP_TOKEN` and `OP_ENV_ID`.
- Nothing under `src` imports `varlock/env`. Doing so changes what tests and `SKIP_VARLOCK` builds need: decide that first.
- The dev server needs `.env.local`. After changing `vite.config.ts` or `.env.schema`, restart it and check it still serves the page.

### Error reporting

- Sentry project `ok-tuner` in the `lightning-jar` organisation. Only `src/sentry.ts` and its test import `@sentry/browser`.
- Errors only: a visit where nothing goes wrong sends nothing. Do not add tracing, replay, the session integration, or anything that identifies a visitor.
- A caught failure worth reporting is reported by a Command returned from `update` (`ReportProblem`), not from inside the code that caught it. A person's own choice (refusing the microphone, blocking storage) is not reported.
- The dev server reports too, tagged `development`. Resolve test issues you create.

### Conventions that differ from Foldkit's defaults

- `src/pitch.ts` uses `for` and `while` loops and mutable locals on purpose. Each reading compares millions of samples, so this one module is exempt from the "no loops" rule. Keep the exemption to that file.
- Commit messages carry no `Co-Authored-By` or other attribution lines.

### Deliberately later

The full list is [`docs/backlog.md`](./docs/backlog.md). Everything there is planned, not forgotten. Do not add an item as a side effect of other work. The ones most likely to be added by accident:

- Starting to listen when the pointer enters the page.
- Prerendering and search-engine work, if the tuner goes public. Until then `vercel.json` and `index.html` both say `noindex`.
