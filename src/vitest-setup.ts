// vitest-setup.ts: runs before every test file.
//
// `vitest.config.ts` names this file in `setupFiles`, so Vitest runs it
// ahead of each test file.
//
// Foldkit's Scene tests (`src/scene.test.ts`) render the view and make
// assertions about elements in it, such as
// `expect(role('alert')).toHaveText(REFUSED)` or
// `expect(needleMarker).toBeAbsent()`. Matchers like `toHaveText`,
// `toHaveAttr`, `toExist` and `toBeAbsent` are not part of Vitest. They are
// Foldkit's, and they work on Foldkit's virtual DOM, not on real DOM
// elements.
//
// Importing `foldkit/test/vitest` does two things:
//   - `setup()` registers those matchers with Vitest's `expect` (it calls
//     `expect.extend` with Foldkit's Scene matchers);
//   - the import alone adds their types to Vitest's `Assertion` interface,
//     so the test files type-check with no declaration of their own.
// Source: `repos/foldkit/packages/foldkit/src/test/vitest.ts`.
import { setup } from 'foldkit/test/vitest'

setup()
