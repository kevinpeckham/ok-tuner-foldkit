import { afterEach, describe, expect, test, vi } from 'vitest'

// analytics.test.ts: the tests for src/analytics.ts, which counts visits.
//
// The module does one thing with a side effect: it asks Vercel's package to
// add the counting script to the page. A test must not do that for real, so
// `vi.mock` swaps the package for a stand-in whose `inject` only records
// that it was called. Vitest hoists `vi.mock` above the imports, so the
// module under test gets the stand-in.
import { inject } from '@vercel/analytics'

import { countsVisitsFrom, startAnalytics } from './analytics'

vi.mock('@vercel/analytics', () => ({ inject: vi.fn() }))

afterEach(() => {
  vi.mocked(inject).mockReset()
})

// Visits are counted on the live site only. The script is served by Vercel
// at a path of the site's own, so it does not exist on the dev server, and
// a preview or a copy of the app somewhere else is not the site.
describe('countsVisitsFrom', () => {
  test.each([
    ['www.oktuner.com', true],
    ['oktuner.com', true],
    ['ok-tuner.vercel.app', true],
    ['ok-tuner-git-feat-x-lightning-jar.vercel.app', false],
    ['ok-tuner.bench.lj.dev', false],
    ['localhost', false],
    ['www.oktuner.com.example.org', false],
    ['', false],
  ])('%s counts visits: %s', (hostname, counts) => {
    expect(countsVisitsFrom(hostname)).toBe(counts)
  })
})

describe('startAnalytics', () => {
  test('adds the counting script on the live site', () => {
    startAnalytics('www.oktuner.com')

    expect(inject).toHaveBeenCalledTimes(1)
  })

  test('does nothing anywhere else', () => {
    startAnalytics('localhost')
    startAnalytics('ok-tuner.bench.lj.dev')

    expect(inject).not.toHaveBeenCalled()
  })

  // Counting visits is a convenience. If the package throws, the tuner must
  // still start.
  test('a failure to start never stops the app', () => {
    vi.mocked(inject).mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => startAnalytics('www.oktuner.com')).not.toThrow()
  })
})
