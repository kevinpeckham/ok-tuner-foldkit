# Prerendering the pages at build time: design

Approved by Kevin on 2026-11-25, after a throwaway spike. A small change in lines, a larger one in shape, so a short design with the spike's evidence.

## Intent

Until now the server sent an empty page and a 497 kB script drew everything. The pages should arrive as real HTML, so they show before the script has run, an unknown address is a real 404, and the site is ready to be crawled when `noindex` comes off. It is also the server-rendering half of the comparison with SvelteKit.

## Goals

- `/` and `/how-to` are written as HTML files by the build, each with its own title and content.
- The browser takes the HTML over without redrawing it, and everything works as before.
- A returning visitor still gets their saved tuning and A4.
- An unknown address is answered with status 404 and a page that links to the tuner.
- Each Vercel build still uploads source maps for the browser bundle.

## Not goals

- No server that renders per request: the app has no per-visitor server data.
- No change to what the pages say or how the tuner behaves.
- `noindex` stays.

## Anti-goal

A page that shows and then cannot be used: if the browser cannot take the HTML over, that is worse than the empty page it replaces.

## Approaches

1. **Prerender at build time (chosen).** Foldkit's Vite plugin renders each listed path through a server entry and writes a file. The host stays static.
2. **Render per request.** Needs a function on Vercel for every visit, and buys nothing without per-visitor data.
3. **Stay client-rendered.** No experimental API, but an empty first paint and soft 404s.

For saved preferences, two ways were weighed:

1. **Show the defaults, then the saved values (chosen).** The first Model is the same in the build and in the browser, and a Command reads `localStorage` after start-up.
2. **Draw the tuning picker and the strings blank until the preferences are read.** Nobody sees a wrong tuning, but every visitor sees an empty tuner first.

## What the spike showed

- The prerender built with no change to the views: 8 kB of HTML for `/`, 2.5 kB for `/how-to`.
- Hydration passed the same browser click-through as the live site, with no console errors.
- With Flags, a saved "Bass" came back as "Guitar - Standard": the start-up data is written into the HTML at build time and the browser computes none of its own.
- With a start-up Command, the saved tuning replaced the default before first paint on a fast connection, and about 0.3 s after it on a simulated 4G connection (a rough figure, probably optimistic).
- A Vercel build resolved Varlock, uploaded source maps (twice: browser and server bundles) and served no map file.
- An unknown address got Vercel's plain-text 404. The plugin writes a path such as `/404.html` as a folder, so it cannot produce Vercel's `404.html`.

## Design

- **Server entry** (`src/entry.server.ts`): lists the paths to prerender, renders a request's page, and wraps Foldkit's document with the icons and `noindex`. `index.html` is deleted, and its teaching comments move here.
- **Client entry:** `Runtime.hydrate` in place of `Runtime.run`, and the stylesheet imported from the script.
- **Preferences:** Flags leave the app. `init` starts on the defaults and returns a `LoadPreferences` Command; its result sets the tuning and A4.
- **404:** a hand-written `public/404.html`, with no script, which Vercel serves with status 404.
- **Vercel:** the output folder becomes `dist/client`, and the rewrite added for routing goes.
- **Source maps:** uploaded for the browser bundle only, if the Sentry plugin can be limited to it. If not, both, as in the spike.
- **After merging:** one Sentry test report from production, to check that stack frames still resolve. A preview cannot show this, because previews do not report.

## Costs accepted

- The API is marked experimental, so a Foldkit upgrade may break it.
- The app no longer demonstrates Flags. It gains a start-up Command and a server entry.
- A returning visitor with a saved tuning may see the default tuner for a moment.

## Left to the builder

Names, the wording and look of `404.html`, and how the Sentry plugin is limited to one bundle.

## Changes during the build

Recorded on 2026-11-25, after the build and its review. Where this section and the text above disagree, this section is what was built.

- **Source maps are uploaded for the browser bundle only,** and the Node bundle gets none. The Sentry plugin is limited with Vite's `applyToEnvironment`.
- **The server entry is tested by rendering.** The first version said it could not be; the review found that the render takes a build id as an option.
- **`bun run preview` serves `dist/client`.**
- **What the review found and was left** is in `docs/backlog.md` under "Pages and routing": a press before the script has run is lost, the script is downloaded again after every deploy, and two file addresses show their page and then "Page not found".
