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

### Conventions that differ from Foldkit's defaults

- `src/pitch.ts` uses `for` and `while` loops and mutable locals on purpose. Each reading compares millions of samples, so this one module is exempt from the "no loops" rule. Keep the exemption to that file.
- Commit messages carry no `Co-Authored-By` or other attribution lines.

### Deliberately later

The full list is [`docs/backlog.md`](./docs/backlog.md). Everything there is planned, not forgotten. Do not add an item as a side effect of other work. The ones most likely to be added by accident:

- Sentry.
- Varlock and 1Password, when the first secret is needed (most likely with Sentry).
- Starting to listen when the pointer enters the page.
- Prerendering and search-engine work, if the tuner goes public. Until then `vercel.json` and `index.html` both say `noindex`.
