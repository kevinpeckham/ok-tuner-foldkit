// vitest.config.ts: how the tests run (`bun run test`, which is `vitest run`).
//
// What this file is. Vitest is the test runner. It is built on Vite, and
// when this file exists Vitest reads it and not `vite.config.ts`. That
// separation is deliberate: none of the build's plugins load here, so the
// tests never contact 1Password and need no `.env.local` (the Sentry design,
// "Varlock and 1Password").
//
// The code is Foldkit's starter template, unchanged: the file of the same
// name in `repos/foldkit/packages/create-foldkit-app/templates/base/`.
//
// What the tests are. Foldkit's `update` and view are pure functions, so its
// two test styles need no browser and no running app (FOLDKIT.md,
// "Testing"):
//   - `src/story.test.ts` sends Messages to `update` and checks the Model
//     and the Commands that come back.
//   - `src/scene.test.ts` renders the view and finds elements by role and
//     label.
// The other test files check the plain modules (`pitch`, `tuning`,
// `preferences`, `microphone`, `sentry`, `route` and storage), and
// `src/view.test.ts` checks the page titles, which a scene cannot see.

// The same `defineConfig` idea as in `vite.config.ts`, from Vitest's own
// entry point so that the `test` field is typed.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Which files are tests: anything under `src` ending in `.test.ts` or
    // `.spec.ts`. Tests sit beside the code they cover. The pattern also
    // keeps Vitest out of `repos/foldkit/`, the vendored Foldkit source,
    // which has test files of its own.
    include: ['src/**/*.{test,spec}.ts'],
    // Tests do not run in a browser, so there is no real `window` or
    // `document`. happy-dom is a simulated browser environment that supplies
    // them. Some tests need one: `sentry.test.ts` calls `initSentry`, which
    // reads `window.location.hostname` (it is `localhost` here), and
    // `storage.test.ts` uses `localStorage`.
    environment: 'happy-dom',
    // Files run before each test file. This one registers Foldkit's Scene
    // matchers: see `src/vitest-setup.ts`.
    setupFiles: ['./src/vitest-setup.ts'],
    server: {
      deps: {
        // By default Vitest leaves packages in `node_modules` to Node to
        // load as they are. A package named here is run through Vite's own
        // pipeline instead, like the app's source. The starter template
        // lists the three Foldkit packages.
        inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
      },
    },
  },
})
