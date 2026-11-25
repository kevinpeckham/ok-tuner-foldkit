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

OK Tuner is a port of the Stem Shovel guitar tuner (`~/projects/stem-shovel`, `src/lib/components/Tuner.svelte`), written to learn Foldkit. The design is `docs/superpowers/specs/2026-11-24-tuner-design.md`. It is live at <https://www.oktuner.com/>.

### Pages

The app has routing: the routes are in `src/route.ts`, and the route is a field of the Model. To add a page, add its route and router there, a view under `src/page/`, and its case in `pageTitle` and `view` in `src/view.ts` (the compiler asks for both, and for the case in `enterRoute` in `src/main.ts`). Nothing asks for the router to be listed in `Route.oneOf` in `urlToAppRoute`: leave it out and the page shows "Page not found", so add a row to `src/route.test.ts`. Nothing asks for its path in `prerenderPaths` in `src/entry.server.ts` either: leave it out and opening the address directly is a 404. Give one heading on the page `pageHeadingAttributes`, which is where focus moves when the page appears. Links are plain `<a>` elements built with `textLink` and a router, never a typed-out path. A link to another site is the same element with a full address: the runtime tells the two apart. Addresses used in more than one place are constants in `src/site.ts`. The footer (`src/footer.ts`) is drawn under every page by `view`, outside the `<main>`. Only `ChangedUrl` sets the route. A Scene test cannot follow a link: see `FINDINGS.md` for how navigation is tested.

### Version

The footer shows the version in `package.json` (`VERSION` in `src/site.ts`). Raise it in the same pull request as each change that alters what a visitor gets: the minor number for a feature, the patch number for a fix. A docs-only change leaves it alone.

### Prerendering

The build writes each page as an HTML file (`src/entry.server.ts`), and the browser takes the HTML over with `Runtime.hydrate`. There is no `index.html` and no server at run time.

- `init` and `view` run in Node during the build. Keep them free of `window`, `document` and `localStorage`, and keep the first Model the same for every visitor: anything read from the browser arrives by a Command, as the saved preferences do.
- Foldkit marks server rendering experimental. After a Foldkit upgrade, run `SKIP_VARLOCK=1 bun run build`, check that both pages are generated and that `dist/client/how-to/index.html` holds the how-to text, then `bun run preview` and click through before anything else. Open `/how-to/` with the trailing slash: Vite's preview answers `/how-to` with the tuner's file, and the browser quietly rebuilds a page that does not match.
- Head tags go in `DOCUMENT_HEAD` in `src/entry.server.ts`.
- The 404 page is the app's not-found page, drawn at `NOT_FOUND_PATH` and moved to `dist/client/404.html` by the `build` script in `package.json`. Keep that page the same for every address: it is one file served for all of them.
- `renderPage` needs a build id that only a real build has. Tests call `renderApplication` with an id of their own (`src/entry.server.test.ts`).

### Findings

[`FINDINGS.md`](./FINDINGS.md) is the log of gotchas and of why things are the way they are. Read the section for the area you are about to change. Add an entry whenever a tool, a pattern or our own process does something that was not obvious, in the same change that met it. A rule to follow goes in this file, not there.

### Environment and secrets

- `.env.schema` (committed) declares the environment; Varlock loads it, with values from one 1Password environment. Read the `varlock-docs-mcp` server before changing the schema.
- `.env.local` holds only `OP_TOKEN` and `OP_ENV_ID`. Never open or print it, and never run `varlock load --format …`, `varlock printenv` or `varlock reveal` in a session. `bunx varlock load --agent` is the safe look.
- A new secret goes in `.env.schema`, marked sensitive, and its value into 1Password, which Kevin does. Never into `.env.local` or the Vercel project, which holds only `OP_TOKEN` and `OP_ENV_ID`.
- Nothing under `src` imports `varlock/env`. Doing so changes what tests and `SKIP_VARLOCK` builds need: decide that first.
- The dev server needs `.env.local`. After changing `vite.config.ts` or `.env.schema`, restart it and check it still serves the page.

### Error reporting

- Sentry project `ok-tuner` in the `lightning-jar` organisation. Only `src/sentry.ts` and its test import `@sentry/browser`.
- Errors only: a visit where nothing goes wrong sends nothing. Do not add tracing, replay, the session integration, or anything that identifies a visitor.
- `@sentry/vite-plugin` must stay at 11.16.0 or later. Earlier versions bundle an upload tool (`sentry` 0.49.0) that, on Vite 8, adds a line to the uploaded copy of the bundle, so every stack frame in Sentry resolves one line off ([sentry-javascript #26658](https://github.com/getsentry/sentry-javascript/issues/26658)). After changing its version, send a test report from production and check that its frames name files under `src/`.
- A caught failure worth reporting is reported by a Command returned from `update` (`ReportProblem`), not from inside the code that caught it. A person's own choice (refusing the microphone, blocking storage) is not reported.
- Reports are sent only from our own hosts (`reportsFrom` in `src/sentry.ts`): production (`www.oktuner.com`, the bare domain and the two Vercel addresses) and the dev server at `ok-tuner.bench.lj.dev`, tagged `development`. `localhost` and Vercel previews report nothing. Resolve test issues you create.
- The Sentry project's Allowed Domains setting (Kevin set it on 2026-11-25) holds the same hosts, and Sentry drops a report from any other origin while still answering 200. A new domain reports nothing until it is in both: `PRODUCTION_HOSTNAMES` in `src/sentry.ts`, and Allowed Domains, which Kevin changes. Then send a test report from the new address and check that it appears in Sentry.

### Conventions that differ from Foldkit's defaults

- `src/pitch.ts` uses `for` and `while` loops and mutable locals on purpose. Each reading compares millions of samples, so this one module is exempt from the "no loops" rule. Keep the exemption to that file.
- Commit messages carry no `Co-Authored-By` or other attribution lines.
- **The code is commented for teaching.** `FOLDKIT.md` says not to add comments that explain code. This project is an example for learning Foldkit, so it does the opposite on purpose (Kevin, 2026-11-24): each file opens with what it is and where it sits, and each declaration says what it does, with the most words spent on what is particular to Foldkit. When you change code, change the comments beside it in the same commit: a comment that no longer matches the code teaches the wrong thing. Check any statement about Foldkit against `FOLDKIT.md` or the source in `repos/foldkit/` before writing it. `// NOTE:` keeps its meaning: behaviour that would mislead a careful reader.

### Deliberately later

The full list is [`docs/backlog.md`](./docs/backlog.md). Everything there is planned, not forgotten. Do not add an item as a side effect of other work. The ones most likely to be added by accident:

- Starting to listen when the pointer enters the page.
- Search-engine work, if the tuner goes public. Until then `vercel.json` and `src/entry.server.ts` both say `noindex`.
