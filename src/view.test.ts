// view.test.ts: the one part of the view a scene cannot see.
//
// The view returns a `Document`: the page's body, its title and, for most
// pages, its canonical address (src/view.ts). A scene renders the body and
// has no assertion for the other two. So the title is a small pure
// function, `pageTitle`, tested here with Vitest's own `expect`, and a
// second group checks that the view really puts it, and the canonical
// address, in the Document it returns.
import { Effect, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { renderApplication } from './entry.server'
import { AppRoute } from './route'
import { canonicalOf, pageTitle } from './view'

// One row for each route: the route, the address that leads to it, its
// title and its canonical address. The not-found page has no canonical
// address, which `undefined` says here as a missing field says it in the
// Document.
const pages: ReadonlyArray<
  readonly [AppRoute, string, string, string | undefined]
> = [
  [
    AppRoute.Tuner(),
    '/',
    'OK Tuner | Chromatic Instrument Tuner',
    'https://www.oktuner.com/',
  ],
  [
    AppRoute.HowTo(),
    '/how-to',
    'How to use the tuner | OK Tuner',
    'https://www.oktuner.com/how-to',
  ],
  [
    AppRoute.BuiltWith(),
    '/built-with',
    'Built with | OK Tuner',
    'https://www.oktuner.com/built-with',
  ],
  [
    AppRoute.Privacy(),
    '/privacy',
    'Privacy | OK Tuner',
    'https://www.oktuner.com/privacy',
  ],
  [
    AppRoute.NotFound({ path: '/nope' }),
    '/nope',
    'Page not found | OK Tuner',
    undefined,
  ],
]

describe('pageTitle', () => {
  // The tuner's page carries the site's full name. The other pages put
  // their own name first, so two tabs can be told apart.
  test.each(pages)('%o is titled as its page', (route, _path, title) => {
    expect(pageTitle(route)).toBe(title)
  })
})

describe('canonicalOf', () => {
  test.each(pages)(
    '%o has its address on the live site, or none',
    (route, _path, _title, canonical) => {
      expect(Option.getOrUndefined(canonicalOf(route))).toBe(canonical)
    },
  )
})

// The two groups above test the functions the view is meant to call. This
// one tests that it calls them: a `view` that returned a fixed title, or
// left the canonical address out, would pass everything above.
//
// A test cannot call `view` itself. Its second argument is the Html builder
// for this app's Messages, which only Foldkit makes: the builder Foldkit
// exports for other code, `inertHtml`, is for markup with no event
// handlers, and the tuner has some. So the view is called by Foldkit, the
// way the build calls it. `renderApplication` (src/entry.server.ts) runs
// `init` and the real `view` at an address, and what it returns carries the
// `title` and the `canonical` of the Document the view gave back, as they
// were. `Effect.runPromise` runs the render.
//
// The address is on `localhost` on purpose. The canonical address names the
// live site whatever host the page was drawn for, so a copy of the site
// elsewhere points back to the original.
//
// `src/entry.server.test.ts` reads the same two values out of the finished
// HTML of every page, so they were covered before this group was added.
// It is here because this is where a reader looks for it.
describe('the Document the view returns', () => {
  test.each(pages)(
    '%o: the page at %s carries its title and its canonical address',
    async (_route, path, title, canonical) => {
      const rendered = await Effect.runPromise(
        renderApplication(`http://localhost:5273${path}`, 'test-build'),
      )

      expect(rendered.title).toBe(title)
      expect(rendered.canonical).toBe(canonical)
    },
  )
})
