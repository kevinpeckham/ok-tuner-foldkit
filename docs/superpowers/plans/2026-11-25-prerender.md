# Prerender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The build writes `/` and `/how-to` as HTML files, and the browser takes them over.

**Architecture:** Foldkit's Vite plugin renders each listed path through `src/entry.server.ts` at build time. The client entry hydrates instead of drawing from nothing. The first Model no longer depends on the browser, so saved preferences are read by a Command after start-up.

**Tech Stack:** Foldkit 0.170.0 (`foldkit/experimental` Server, `Runtime.hydrate`), `@foldkit/vite-plugin` 0.29.0 (`ssr` option), Vercel static output.

**Spec:** `docs/superpowers/specs/2026-11-25-prerender-design.md`

## Global Constraints

- Prerendered paths: `/` and `/how-to`, built from the routers in `src/route.ts`, never typed out.
- No Flags: `init` takes the address alone.
- `noindex` stays, in the document head and in `vercel.json`.
- `import './instrument'` stays the first import of `src/entry.ts`.
- New and changed code is commented for teaching; every statement about Foldkit is checked against `FOLDKIT.md` or `repos/foldkit/`.
- No commit attribution lines. Tests, typecheck and lint pass before each commit.

## Review Focus

1. **A returning visitor's saved tuning and A4.** Story test: the result of `LoadPreferences` sets `tuningId`, `a4` and `a4Input`. Browser check with a saved "Bass" (Task 4).
2. **Blocked site storage.** `LoadPreferences` must end in the defaults, not a crash. Test in `src/storage.test.ts` (Task 1).
3. **An unknown address on Vercel.** Status 404 and the hand-written page. Checked on the preview (Task 4).
4. **The server bundle imports `main.ts`, and through it `sentry.ts`.** Nothing may touch `window` or start Sentry when imported. The build itself is the check: it fails if a module does (Task 2).
5. **Stack frames in Sentry after the change.** Cannot be shown before merging. One test report from production afterwards.

---

### Task 1: Preferences by Command

**Files:**

- Modify: `src/main.ts`, `src/entry.ts`, `src/story.test.ts`, `src/scene.test.ts`, `src/sentry.test.ts`, `src/storage.test.ts`

**Interfaces:**

- Produces:
  - `init: Runtime.RoutingApplicationInit<Model, Message>`, called as `init(url)`. The Model starts on `DEFAULT_PREFERENCES`, and `commands` is exactly `[LoadPreferences()]`.
  - `LoadPreferences`: a Command with no arguments. It reads `STORAGE_KEY` from `localStorage` and ends in `Message.CompletedLoadPreferences({ preferences })`, with `DEFAULT_PREFERENCES` when storage is blocked or holds nothing usable.
  - `CompletedLoadPreferences: { preferences: Preferences }` sets `tuningId`, `a4` and `a4Input`.
  - `Flags` and `flags` are removed from `main.ts` and from `entry.ts`.

- [ ] **Step 1: Write the tests.**
  - `story.test.ts`: `init(url)` starts on the defaults and returns exactly `LoadPreferences()`; `CompletedLoadPreferences` with `{ tuningId: 'bass', a4: 442 }` gives `tuningId` `'bass'`, `a4` `442`, `a4Input` `'442'` and no Commands; with the defaults it leaves the Model equal.
  - `storage.test.ts`: `LoadPreferences().effect` gives the saved values; with storage blocked it gives the defaults.
  - Update every `init(...)` call to the new signature.
- [ ] **Step 2: Run** `bun run test`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test && bun run typecheck && bun run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: read saved preferences with a Command after start-up`.

### Task 2: The server entry and the build

**Files:**

- Create: `src/entry.server.ts`, `src/entry.server.test.ts`, `src/vite-env.d.ts`
- Modify: `src/entry.ts`, `vite.config.ts`, `vercel.json`
- Delete: `index.html`

**Interfaces:**

- Produces: `prerenderPaths: ReadonlyArray<string>` (`[tunerRouter(), howToRouter()]`); `renderPage(request: Request): Promise<Server.EntryResult>`; `renderDocument: Server.DocumentRenderer`, whose head carries the three icon links and `<meta name="robots" content="noindex" />`.

- [ ] **Step 1: Write `src/entry.server.test.ts`:** `prerenderPaths` equals `['/', '/how-to']`. If `renderPage` can run under Vitest (it needs a build id), also: `/how-to` renders the heading "How to use the tuner" and the title `How to use the tuner | OK Tuner`. If it cannot, say so in the test file and rely on Step 4.
- [ ] **Step 2: Run** it. Expected: FAIL, no such module.
- [ ] **Step 3: Implement.** `entry.ts` imports `./styles.css` and calls `Runtime.hydrate(application)`. `vite.config.ts` passes `ssr: { serverEntry, clientEntry, build: { prerender: { origin: 'https://www.oktuner.com' } } }`. `vercel.json`: `outputDirectory` `dist/client`, no `rewrites`.
- [ ] **Step 4: Run** `SKIP_VARLOCK=1 bun run build`. Expected: `generated /`, `generated /how-to`, and `dist/client/index.html` and `dist/client/how-to/index.html` each holding its page's text and title.
- [ ] **Step 5: Run** `bun run test && bun run typecheck && bun run lint`, then commit `feat: prerender the pages at build time`.

### Task 3: The 404 page

**Files:**

- Create: `public/404.html`

- [ ] **Step 1: Write the page:** no script; the heading "OK Tuner", "Page not found", a link to `/` named "Back to the tuner", `noindex`, the site's colours inline.
- [ ] **Step 2: Run** `SKIP_VARLOCK=1 bun run build`. Expected: `dist/client/404.html` exists and the build does not refuse it.
- [ ] **Step 3: Commit** `feat: a 404 page for unknown addresses`.

### Task 4: Proof and docs

**Files:**

- Modify: `README.md`, `AGENTS.md`, `FINDINGS.md`, `docs/backlog.md`

- [ ] **Step 1: Restart the dev server** (`systemctl --user restart ok-tuner-dev`) and check it serves `/` and `/how-to` as rendered HTML.
- [ ] **Step 2: Browser proof** against a local preview of `dist/client` and against the dev server: the click-through, a saved "Bass" surviving a reload, no console errors.
- [ ] **Step 3: Write the docs:** what changed, what the spike measured, what prerendering needs of the code, and the backlog items it settles or changes.
- [ ] **Step 4: Run** every check and a build, then commit `docs: record what prerendering taught`.
- [ ] **Step 5: On the pull request's preview:** `/how-to` is the prerendered HTML, an unknown address is status 404 with the hand-written page, no map file is served, and the build log shows the source-map upload.
