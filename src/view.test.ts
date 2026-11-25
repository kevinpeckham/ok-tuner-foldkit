// view.test.ts: the one part of the view a scene cannot see.
//
// The view returns a `Document`: the page's body and its title
// (src/view.ts). A scene renders the body and has no assertion for the
// title, so the title is a small pure function, `pageTitle`, tested here
// with Vitest's own `expect`.
import { describe, expect, test } from 'vitest'

import { AppRoute } from './route'
import { pageTitle } from './view'

describe('pageTitle', () => {
  // The tuner's page carries the site's full name. The other pages put
  // their own name first, so two tabs can be told apart.
  test.each([
    [AppRoute.Tuner(), 'OK Tuner | Chromatic Instrument Tuner'],
    [AppRoute.HowTo(), 'How to use the tuner | OK Tuner'],
    [AppRoute.BuiltWith(), 'Built with | OK Tuner'],
    [AppRoute.Privacy(), 'Privacy | OK Tuner'],
    [AppRoute.NotFound({ path: '/nope' }), 'Page not found | OK Tuner'],
  ])('%o is titled %s', (route, title) => {
    expect(pageTitle(route)).toBe(title)
  })
})
