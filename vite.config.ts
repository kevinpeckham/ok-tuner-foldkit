// vite.config.ts: how the app is served in development and built for
// production.
//
// What this file is. Vite is the build tool. It runs this file in Node, never
// in the browser, when `bun run dev` or `bun run build` starts, and the
// object exported at the bottom configures both.
//
// There is no `index.html`. The site is prerendered: a build writes each
// page as an HTML file by running the app once for it, through
// `src/entry.server.ts`, and the browser's script, `src/entry.ts`, then
// takes that HTML over. The Foldkit plugin's options below set this up.
//
// It sets up four plugins:
//   1. Varlock loads the environment: `.env.schema`, with values from
//      1Password.
//   2. Tailwind turns the utility classes written in `src/view.ts` into CSS.
//   3. Foldkit supplies what a Foldkit app needs from the build. Its comment
//      below says what that is.
//   4. Sentry uploads source maps, on Vercel builds only.
//
// Two things to know before changing it.
//   - It is not type-checked or linted: `tsc` and the lint cover `src` only.
//     A mistake here shows as a failed or wrong build (FINDINGS.md,
//     "`vite.config.ts` is not type-checked or linted").
//   - The dev server may need a restart afterwards (AGENTS.md, "Environment
//     and secrets").
//
// The tests do not use this file. Vitest reads `vitest.config.ts`, which is
// why tests need no 1Password access.
//
// Background: the Sentry design
// (docs/superpowers/specs/2026-11-24-sentry-design.md, "Source maps" and
// "Varlock and 1Password") and FINDINGS.md, "Varlock and the build".

// `defineConfig` returns the object it is given. It is there for the types:
// the editor can complete and check the options.
import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

// Varlock resolves .env.schema, with its values from 1Password, the moment its
// plugin is imported, and puts the result in process.env. So it is imported
// only when it is going to be used: SKIP_VARLOCK=1 leaves it out, for anyone
// without 1Password access. Never set SKIP_VARLOCK on Vercel.
//
// How that is written:
//   - An `import` statement at the top of a file always runs, so it cannot
//     be made conditional. `await import(...)` is the dynamic form, used
//     here at the top level of the module, inside one branch of a
//     conditional.
//   - The result is a list of no plugins or one, which is spread into
//     `plugins` below.
//   - `process.env` is read directly because this file runs in Node at build
//     time. Nothing under `src` reads the environment.
// When the environment is invalid or cannot be resolved, the plugin ends a
// build with an error and, in development, serves an error page in place of
// the app (the Sentry design, "Varlock and 1Password").
const varlockPlugins = process.env['SKIP_VARLOCK']
  ? []
  : [(await import('@varlock/vite-integration')).varlockVitePlugin()]

// Source maps go to Sentry from Vercel builds only, with the token Varlock
// just resolved. .env.schema makes the token required there, so a Vercel build
// without it fails. A local build never uploads and makes no maps.
//
// A source map is the file that maps the minified bundle back to the source.
// With it, a stack trace in Sentry names files under `src/` and their lines.
//
// These lines have to come after the Varlock import above, because that
// import is what puts SENTRY_AUTH_TOKEN into `process.env`. `VERCEL` is a
// variable Vercel sets on its own builds. Both are required: a local build
// with a token does not upload, and neither does a Vercel build without one
// (which `.env.schema` stops before it gets this far).
const sentryAuthToken = process.env['SENTRY_AUTH_TOKEN']
const uploadsSourceMaps =
  Boolean(process.env['VERCEL']) && Boolean(sentryAuthToken)

export default defineConfig({
  plugins: [
    // Varlock, when it is in use: the list built above holds no plugins or
    // one. What it does in development and on Vercel is in FINDINGS.md,
    // "Varlock and the build".
    ...varlockPlugins,
    // The Vite plugin of Tailwind CSS v4. `src/styles.css` begins with
    // `@import 'tailwindcss'`, and this plugin generates the CSS for the
    // utility classes the source files use. It needs nothing special for
    // Foldkit: the view gives class names as plain strings
    // (`h.Class('...')`).
    tailwindcss(),
    // Foldkit's Vite plugin, `@foldkit/vite-plugin`. `foldkit()` returns
    // several plugins as an array, which Vite flattens. What they do for
    // this app:
    //
    //   - View identity, in development and in production builds. The app's
    //     modules are rewritten so that the Html a view function returns is
    //     stamped with that function's identity (its module path and name).
    //     The runtime uses the stamp when it compares the old and new view:
    //     if the function that produced a position has changed, it replaces
    //     the DOM node instead of patching it, so DOM state cannot carry
    //     over from one view to another. This is why FOLDKIT.md ("View")
    //     says never to key branches. Without the plugin, every branch
    //     point would need a key written by hand.
    //
    //   - Model preservation, in development only. When a file is saved the
    //     page reloads in full, and the plugin gives the Model from before
    //     the reload back to the runtime, so the app keeps its state. `init`
    //     does not run on that path, which is behind FINDINGS.md, "In
    //     development the page can boot already 'listening'".
    //
    //   - The devtools overlay, in development. It is mounted automatically
    //     because `@foldkit/devtools` is installed as a dev dependency, and
    //     it is left out of production builds.
    //
    //   - The devtools MCP relay, in development. A local WebSocket through
    //     which the `foldkit_*` tools of `@foldkit/devtools-mcp` inspect the
    //     running app (FOLDKIT.md, "Debugging").
    //
    //   - Dependency settings. It makes sure the app loads a single copy of
    //     `foldkit`, and has Vite pre-bundle the Effect modules that Foldkit
    //     imports, so that Foldkit and the app share one copy of Effect.
    //
    // The `ssr` option turns on server rendering, which here means
    // prerendering: there is no server once the site is built.
    //   - `serverEntry`: the file that renders a page for a request. In
    //     development the dev server calls it for every page the browser
    //     asks for, so pages are drawn the same way as in a build.
    //   - `clientEntry`: the browser's script. With `build` set, the build
    //     starts from this script and not from an `index.html`, and the
    //     server entry produces the whole document.
    //   - `build.prerender`: after bundling, the plugin calls the server
    //     entry once for each path in its `prerenderPaths` and writes the
    //     result to a file. `origin` is the site's address, used to make
    //     the request for each path.
    // A build therefore runs twice over: once for the browser, into
    // `dist/client`, which is what Vercel serves (`vercel.json`), and once
    // for Node, into `dist/server`, which exists only to do the rendering.
    //
    // NOTE: Foldkit marks server rendering experimental. Source for all of
    // this: `repos/foldkit/packages/vite-plugin-foldkit/README.md`.
    foldkit({
      ssr: {
        serverEntry: '/src/entry.server.ts',
        clientEntry: '/src/entry.ts',
        build: { prerender: { origin: 'https://www.oktuner.com' } },
      },
    }),
    // Sentry's Vite plugin. On a build where it is enabled it uploads the
    // source maps to Sentry and writes a release name into the bundle, which
    // the SDK in `src/sentry.ts` picks up.
    //   - `org`, `project`: the Sentry project the maps belong to.
    //   - `authToken`: the token that permits the upload. It is the one
    //     secret in this project, and it is used at build time only.
    //   - `telemetry: false`: the plugin does not send Sentry data about its
    //     own errors and performance during the build.
    //   - `disable`: true switches the whole plugin off. So it does nothing
    //     in development, in a local build, or without a token.
    // The plugin's version matters: it must stay at 11.16.0 or later
    // (AGENTS.md, "Error reporting"; FINDINGS.md, "Source maps resolved one
    // line off").
    //
    // The build now makes two bundles, and Vite calls each one's set of
    // settings an "environment": `client` for the browser and `ssr` for
    // Node. Only the browser's bundle ever runs where Sentry is listening,
    // so only its maps are worth uploading. `applyToEnvironment` is Vite's
    // way of limiting a plugin to some environments: it is called with each
    // one, and the plugin's build hooks run only where it answers true.
    // `sentryVitePlugin` may return one plugin or several, hence `flat` and
    // `map`.
    ...[
      sentryVitePlugin({
        org: 'lightning-jar',
        project: 'ok-tuner',
        authToken: sentryAuthToken,
        telemetry: false,
        disable: !uploadsSourceMaps,
        // The maps are for Sentry, not for the site: removed once uploaded.
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      }),
    ]
      .flat()
      .map(plugin => ({
        ...plugin,
        applyToEnvironment: environment => environment.name === 'client',
      })),
  ],
  build: {
    // `'hidden'` makes Vite write the source map files but leave out of each
    // bundle the comment that points to its map. The maps exist for the
    // upload, and nothing served to a browser refers to them. `false`, for
    // every other build, writes no maps at all.
    sourcemap: uploadsSourceMaps ? 'hidden' : false,
  },
  optimizeDeps: {
    // In development Vite pre-bundles the app's dependencies, and it finds
    // them by crawling from the entry points. By default it crawls an
    // `index.html`, and this project has none. `entries` names the entry
    // points to crawl in its place.
    // This setting comes unchanged from Foldkit's starter template
    // (`create-foldkit-app`).
    entries: ['src/entry.ts'],
  },
})
