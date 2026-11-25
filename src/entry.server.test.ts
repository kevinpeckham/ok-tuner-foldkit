// entry.server.test.ts: the tests for src/entry.server.ts, the file the
// build uses to write each page as HTML.
//
// What can be tested here is small. Rendering a page that the browser can
// take over needs a build id, which Foldkit's Vite plugin compiles in during
// a real build and a test run does not have, so `renderPage` is not called
// here: the build is its test, and the browser check after it (FINDINGS.md,
// "What a test run cannot show about the server entry").
import { describe, expect, test } from 'vitest'

import { DOCUMENT_HEAD, prerenderPaths } from './entry.server'

describe('prerenderPaths', () => {
  // The build writes one HTML file for each of these. The not-found page is
  // not among them: it has no address of its own.
  test('lists the tuner and the how-to page', () => {
    expect(prerenderPaths).toEqual(['/', '/how-to'])
  })
})

describe('DOCUMENT_HEAD', () => {
  // The site is not public yet. vercel.json says so in a header, and every
  // page says so in its own head, which this pins.
  test('asks search engines not to index the page', () => {
    expect(DOCUMENT_HEAD).toContain('<meta name="robots" content="noindex" />')
  })

  test('links the three site icons', () => {
    expect(DOCUMENT_HEAD).toContain('href="/favicon.svg"')
    expect(DOCUMENT_HEAD).toContain('href="/favicon-48.png"')
    expect(DOCUMENT_HEAD).toContain('href="/apple-touch-icon.png"')
  })
})
