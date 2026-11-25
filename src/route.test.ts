// route.test.ts: the tests for src/route.ts.
//
// Routing has two directions, and both are pinned here. A router turns a
// route into a path, for links: `howToRouter()` gives `'/how-to'`. And
// `urlToAppRoute` turns an address into a route, at start-up and whenever
// the address changes. Nothing here needs a browser: a `Url` is plain data,
// built from a string with `fromString`.
import { Option } from 'effect'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import {
  AppRoute,
  builtWithRouter,
  howToRouter,
  privacyRouter,
  tunerRouter,
  urlToAppRoute,
} from './route'

// `fromString` returns an Option, because a string may not be an address at
// all. Every string in this file is one, so the helper unwraps it and throws
// with a message that names the string if it ever is not.
const urlOf = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Not an address: ${raw}`),
  )

describe('the routers', () => {
  // A router called with no arguments builds its path. Links are written
  // with these, so a path is spelled in one place only.
  test('build the path of each page', () => {
    expect(tunerRouter()).toBe('/')
    expect(howToRouter()).toBe('/how-to')
    expect(builtWithRouter()).toBe('/built-with')
    expect(privacyRouter()).toBe('/privacy')
  })
})

describe('urlToAppRoute', () => {
  // The second row has no path at all: the bare domain is the tuner too.
  test.each(['http://localhost/', 'https://www.oktuner.com'])(
    '%s is the tuner',
    raw => {
      expect(urlToAppRoute(urlOf(raw))).toStrictEqual(AppRoute.Tuner())
    },
  )

  // A trailing slash, a query string and a fragment do not change the page.
  test.each([
    'http://localhost/how-to',
    'http://localhost/how-to/',
    'http://localhost/how-to?x=1#y',
  ])('%s is the how-to page', raw => {
    expect(urlToAppRoute(urlOf(raw))).toStrictEqual(AppRoute.HowTo())
  })

  test.each(['http://localhost/built-with', 'http://localhost/built-with/'])(
    '%s is the built-with page',
    raw => {
      expect(urlToAppRoute(urlOf(raw))).toStrictEqual(AppRoute.BuiltWith())
    },
  )

  test('http://localhost/privacy is the privacy page', () => {
    expect(urlToAppRoute(urlOf('http://localhost/privacy'))).toStrictEqual(
      AppRoute.Privacy(),
    )
  })

  // Anything else is NotFound, which carries the path so the page can say
  // what was asked for. A longer path is not the how-to page, and neither is
  // the same word in capitals.
  test.each([
    ['http://localhost/nope', '/nope'],
    ['http://localhost/how-to/extra', '/how-to/extra'],
    ['http://localhost/How-To', '/How-To'],
  ])('%s is not found', (raw, path) => {
    expect(urlToAppRoute(urlOf(raw))).toStrictEqual(AppRoute.NotFound({ path }))
  })
})
