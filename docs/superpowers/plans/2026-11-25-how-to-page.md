# How-to page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move "How to use the tuner" to its own page at `/how-to`, using Foldkit's routing.

**Architecture:** The route is a field of the Model. The runtime turns link clicks and address changes into two Messages; `update` answers a click with a navigation Command and an address change by setting the route. `view` picks the page from the route. The tuner's own state and code stay where they are.

**Tech Stack:** Foldkit 0.170.0 (`foldkit/route`, `foldkit/navigation`, `foldkit/url`), Effect 4.1.0, Vitest, Vercel rewrites.

**Spec:** `docs/superpowers/specs/2026-11-25-how-to-page-design.md`

## Global Constraints

- Paths: the tuner at `/`, the how-to page at `/how-to`. Anything else is `NotFound`.
- The how-to text does not change.
- Leaving the tuner page sets the tuner to `Off`.
- New code is commented for teaching (`AGENTS.md`), and every statement about Foldkit is checked against `FOLDKIT.md` or `repos/foldkit/`.
- No commit attribution lines. Tests, typecheck and lint pass before each commit.
- No new backlog work: only what the design names.

## Review Focus

1. **Opening `/how-to` directly on Vercel.** Only `index.html` exists, so without the rewrite it is a 404. Checked on the preview deployment (Task 4).
2. **Back and forward buttons.** They arrive as `ChangedUrl`, never as `ClickedLink`. Story test in Task 2: `ChangedUrl` alone changes the route.
3. **Leaving while the tuner is starting, listening or failed.** Each must end `Off`. Story tests in Task 2, one per state.
4. **A trailing slash, a query string, or different case.** `/how-to/` and `/how-to?x=1` are the how-to page; `/How-To` is not found. Tests in Task 1.
5. **A Model saved by the dev server before this change has no `route`.** The dev restore must not crash the page. Checked by hand on the dev server (Task 4).

---

### Task 1: The routes

**Files:**
- Create: `src/route.ts`, `src/route.test.ts`

**Interfaces:**
- Produces: `AppRoute` (`defineRouteUnion` with `Tuner: {}`, `HowTo: {}`, `NotFound: { path: Schema.String }`) and its type; `tunerRouter(): string` (`'/'`); `howToRouter(): string` (`'/how-to'`); `urlToAppRoute(url: Url): AppRoute`.

- [ ] **Step 1: Write `src/route.test.ts`.** A helper `urlOf(raw)` built on `fromString` from `foldkit/url`. Assertions:
  - `tunerRouter()` is `'/'`, `howToRouter()` is `'/how-to'`.
  - `http://localhost/` and `https://www.oktuner.com` parse to `AppRoute.Tuner()`.
  - `http://localhost/how-to`, `/how-to/` and `/how-to?x=1#y` parse to `AppRoute.HowTo()`.
  - `/nope`, `/how-to/extra` and `/How-To` parse to `AppRoute.NotFound({ path })` with the path as written.
- [ ] **Step 2: Run** `bun run test src/route.test.ts`. Expected: FAIL, cannot resolve `./route`.
- [ ] **Step 3: Write `src/route.ts`** with `Route.root`, `literal('how-to')`, `Route.mapTo`, `Route.oneOf` and `Route.parseUrlWithFallback`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the routes`.

### Task 2: The route in the Model

**Files:**
- Modify: `src/main.ts`, `src/entry.ts`, `src/story.test.ts`, `src/scene.test.ts` (its `offModel` helper only)

**Interfaces:**
- Consumes: Task 1's exports.
- Produces:
  - `Model.route: AppRoute`.
  - Messages `ClickedLink: { request: UrlRequest }`, `ChangedUrl: { url: Url }`, `CompletedNavigateInternal: {}`, `CompletedLoadExternal: {}`.
  - `init: Runtime.RoutingApplicationInit<Model, Message, Flags>`, called as `init(flags, url)`.
  - Commands `NavigateInternal({ url: string })` and `LoadExternal({ href: string })`, both exported.
  - `entry.ts` passes `routing: { onUrlRequest, onUrlChange }`.

- [ ] **Step 1: Write the Story tests** in `src/story.test.ts`:
  - `init` with `/how-to` gives `route` `HowTo`; with `/` gives `Tuner`.
  - `ClickedLink` with `UrlRequest.Internal({ url })` returns exactly `NavigateInternal({ url: urlToString(url) })` and leaves the Model alone.
  - `ClickedLink` with `UrlRequest.External({ href })` returns exactly `LoadExternal({ href })`.
  - `ChangedUrl` to `/how-to` from each of `Starting`, `Listening` and `Failed` gives `route` `HowTo` and `tuner` `Off`, with no Commands.
  - `ChangedUrl` to `/` while `Listening` on `Tuner` keeps the tuner listening.
  - `ChangedUrl` to `/how-to` then to `/` gives `route` `Tuner` and `tuner` `Off`.
  - `CompletedNavigateInternal` and `CompletedLoadExternal` change nothing.
  Use `Command.resolveAllExact` wherever a Command is expected (`FINDINGS.md`, on `resolveAll`).
- [ ] **Step 2: Run** `bun run test src/story.test.ts`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** in `src/main.ts` and `src/entry.ts`. `ChangedUrl` sets the route, and sets the tuner `Off` when the next route is not `Tuner`.
- [ ] **Step 4: Run** `bun run test && bun run typecheck && bun run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: hold the route in the Model`.

### Task 3: The pages

**Files:**
- Create: `src/page/howTo.ts`, `src/page/notFound.ts`
- Modify: `src/view.ts`, `src/scene.test.ts`

**Interfaces:**
- Consumes: `Model.route`, `tunerRouter`, `howToRouter`.
- Produces: `view(h): Html` in each page file; `view(model, h): Document` in `src/view.ts` chooses the page and the title by route.

- [ ] **Step 1: Write the Scene tests** in `src/scene.test.ts`:
  - Tuner route: a link named "How to use the tuner" with `href` `/how-to`; no heading "How to use the tuner"; the "On / Off" button exists.
  - HowTo route: heading "How to use the tuner"; the text "Quick tips"; a link named "Back to the tuner" with `href` `/`; no "On / Off" button.
  - NotFound route: heading "Page not found"; a link named "Back to the tuner" with `href` `/`; no "On / Off" button.
  - Titles, asserted on `view(model, h).title` if Scene has no title assertion: `OK Tuner | Chromatic Instrument Tuner`, `How to use the tuner | OK Tuner`, `Page not found | OK Tuner`.
- [ ] **Step 2: Run** `bun run test src/scene.test.ts`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** Move `HOW_TO_TIPS` and `howToView` to `src/page/howTo.ts` unchanged in wording. The shared shell (the `<main>`, the column and the "OK Tuner" heading) stays in `src/view.ts`.
- [ ] **Step 4: Run** `bun run test && bun run typecheck && bun run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: move the how-to text to its own page`.

### Task 4: Serving, proof and docs

**Files:**
- Modify: `vercel.json`, `README.md`, `AGENTS.md`, `FINDINGS.md`, `docs/backlog.md`

- [ ] **Step 1: Add the rewrite** to `vercel.json`: `{ "source": "/(.*)", "destination": "/index.html" }`.
- [ ] **Step 2: Prove it in a browser** against `https://ok-tuner.bench.lj.dev/`: open `/`, switch the tuner on, click the link, see the how-to page at `/how-to`, go back, and see the tuner `Off`. Open `/how-to` directly. Open `/nope`. No console errors, and nothing sent to Sentry.
- [ ] **Step 3: Write the docs.** README file list and reading order; AGENTS "What this app is"; FINDINGS entries for what routing taught; remove the backlog item.
- [ ] **Step 4: Run** `bun run test && bun run typecheck && bun run lint && SKIP_VARLOCK=1 bun run build`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: serve the how-to page on Vercel, and record what routing taught`.
- [ ] **Step 6: After the pull request's preview builds,** fetch `/how-to` from the preview and expect the app's HTML with status 200.
