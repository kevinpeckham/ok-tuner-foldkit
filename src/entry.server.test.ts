// entry.server.test.ts: the tests for src/entry.server.ts, the file the
// build uses to write each page as HTML.
//
// These tests do what the build does, for each page: render the app at an
// address, wrap the result in a document, and look at the HTML. Nothing
// here needs a browser, which is the point of a prerendered page.
//
// One thing differs from a real build. A page that a browser can take over
// carries a build id, which says which build drew it, and Foldkit's Vite
// plugin compiles that id in during a build. A test run has none, and
// `renderPage` itself refuses to render without one. So the tests call
// `renderApplication`, the function `renderPage` is built on, and pass an
// id of their own (FINDINGS.md, "The server entry is tested by rendering
// with a build id of its own").
import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  DOCUMENT_HEAD,
  NOT_FOUND_PATH,
  pagePaths,
  prerenderPaths,
  renderApplication,
  renderDocument,
} from './entry.server'

// What the plugin hands `renderDocument` in a build: the addresses of the
// built script and stylesheet. These stand in for them.
const assets = {
  entryScript: '/assets/app-test.js',
  stylesheets: ['/assets/app-test.css'],
  modulePreloads: [],
}

// The whole document for one path, as the build would write it to a file.
// `Effect.runPromise` runs the render, as `renderPage` does.
const documentAt = async (path: string): Promise<string> =>
  renderDocument(
    await Effect.runPromise(
      renderApplication(`https://www.oktuner.com${path}`, 'test-build'),
    ),
    assets,
  )

describe('prerenderPaths', () => {
  // The build writes one HTML file for each of these: the two pages, and
  // the page for an address the site does not have, which the build command
  // then moves to where Vercel looks for it (FINDINGS.md, "The 404 page is
  // prerendered, then moved").
  test('lists the two pages and the not-found page', () => {
    expect(pagePaths).toEqual(['/', '/how-to', '/built-with', '/privacy'])
    expect(NOT_FOUND_PATH).toBe('/404')
    expect(prerenderPaths).toEqual([
      '/',
      '/how-to',
      '/built-with',
      '/privacy',
      '/404',
    ])
  })

  // The guard against a page path that matches no route: the build would
  // write the app's not-found page to that page's file and serve it with
  // status 200.
  test.each(pagePaths)('%s renders a page of its own', async path => {
    expect(await documentAt(path)).not.toContain('Page not found')
  })
})

// The page Vercel sends, with status 404, for any address that has no file.
// It is drawn by the app like the others, so it has the same head, the same
// stylesheet and the same script, and a browser takes it over.
describe('the not-found page, as the build writes it', () => {
  test('has its title, says so, and links to the tuner', async () => {
    const html = await documentAt(NOT_FOUND_PATH)

    expect(html).toContain('<title>Page not found | OK Tuner</title>')
    expect(html).toContain('Page not found')
    expect(html).toContain('There is no page at this address.')
    expect(html).toContain('Back to the tuner')
    expect(html).toContain('href="/"')
    expect(html).not.toContain('On / Off')
  })

  // The file is drawn once, at the path above, and served for every unknown
  // address. If the page printed the path, each visitor would be shown
  // "/404" until the script ran and corrected it. So it prints none, and
  // the page is the same whatever address it is drawn for: the browser's
  // drawing matches the file's exactly.
  test('is the same for any address', async () => {
    const built = await documentAt(NOT_FOUND_PATH)
    const elsewhere = await documentAt('/somewhere/else')

    expect(built).not.toContain('/404')
    expect(elsewhere).toBe(built)
  })

  test('carries the same head as every page', async () => {
    const html = await documentAt(NOT_FOUND_PATH)

    expect(html).toContain(DOCUMENT_HEAD)
    expect(html).toContain('href="/assets/app-test.css"')
    expect(html).toContain('src="/assets/app-test.js"')
  })
})

describe('the tuner page, as the build writes it', () => {
  test('has its title, the tuner, and no how-to text', async () => {
    const html = await documentAt('/')

    expect(html).toContain(
      '<title>OK Tuner | Chromatic Instrument Tuner</title>',
    )
    expect(html).toContain('On / Off')
    expect(html).toContain('href="/how-to"')
    expect(html).not.toContain('Quick tips')
  })

  // A browser shows this file before the script has run, when a press on
  // the On / Off button could do nothing. So the button is written disabled,
  // and the app enables it once it is running (FINDINGS.md, "A prerendered
  // page looks ready before it is"). The pattern finds the opening tag of
  // the button whose text is "On / Off".
  test('has the power button disabled', async () => {
    const html = await documentAt('/')
    const powerButton = /<button[^>]*>(?:(?!<\/button>)[^])*On \/ Off/.exec(
      html,
    )

    expect(powerButton?.[0]).toContain('aria-disabled="true"')
  })

  // The first Model is the same for every visitor, so the page in the file
  // shows the default tuning. A saved one replaces it in the browser.
  test('shows the default tuning', async () => {
    expect(await documentAt('/')).toContain('Guitar - Standard')
  })
})

describe('the how-to page, as the build writes it', () => {
  test('has its title and its text, and no tuner', async () => {
    const html = await documentAt('/how-to')

    expect(html).toContain('<title>How to use the tuner | OK Tuner</title>')
    expect(html).toContain('Quick tips')
    expect(html).toContain('Nothing is recorded.')
    expect(html).not.toContain('On / Off')
  })
})

describe('the built-with page, as the build writes it', () => {
  test('has its title and its list, and no tuner', async () => {
    const html = await documentAt('/built-with')

    expect(html).toContain('<title>Built with | OK Tuner</title>')
    expect(html).toContain('href="https://foldkit.dev"')
    expect(html).toContain('Web Audio API')
    expect(html).not.toContain('On / Off')
  })
})

describe('the privacy page, as the build writes it', () => {
  test('has its title and names the two services', async () => {
    const html = await documentAt('/privacy')

    expect(html).toContain('<title>Privacy | OK Tuner</title>')
    expect(html).toContain('Sentry')
    expect(html).toContain('Vercel Web Analytics')
    expect(html).not.toContain('On / Off')
  })
})

describe('every document', () => {
  // The header, with the brand, is shared too, and each page has one
  // first-level heading of its own.
  test.each(prerenderPaths)('%s has a header and one h1', async path => {
    const html = await documentAt(path)

    expect(html).toContain('<header')
    expect(html.split('<h1').length - 1).toBe(1)
  })

  // The footer is part of what every page shares, so it is in every file
  // the build writes, the 404 page included.
  test.each(prerenderPaths)('%s carries the footer', async path => {
    const html = await documentAt(path)

    expect(html).toContain('<footer')
    expect(html).toContain('Built with Foldkit')
    expect(html).toContain('Ported from')
  })

  // The site is not public yet. vercel.json says so in a header, and every
  // page says so in its own head. `DOCUMENT_HEAD` is checked for the tag,
  // and the document is checked for `DOCUMENT_HEAD`, so a `renderDocument`
  // that dropped it would fail here.
  test('asks search engines not to index it, and links the icons', async () => {
    const html = await documentAt('/')

    expect(DOCUMENT_HEAD).toContain('<meta name="robots" content="noindex" />')
    expect(DOCUMENT_HEAD).toContain('href="/favicon.svg"')
    expect(DOCUMENT_HEAD).toContain('href="/favicon-48.png"')
    expect(DOCUMENT_HEAD).toContain('href="/apple-touch-icon.png"')
    expect(html).toContain(DOCUMENT_HEAD)
  })

  // `lang` comes from `renderDocument`. The script and the stylesheet come
  // from the assets it is given. There is no empty container waiting to be
  // filled: the page is in the file.
  test('is in English, loads the built files, and holds the page itself', async () => {
    const html = await documentAt('/how-to')

    expect(html).toContain('<html lang="en">')
    expect(html).toContain('src="/assets/app-test.js"')
    expect(html).toContain('href="/assets/app-test.css"')
    expect(html).not.toContain('id="root"')
  })

  // The mark the browser's runtime looks for when it takes the page over,
  // carrying the build id the render was given.
  test('is marked with the build that drew it', async () => {
    expect(await documentAt('/')).toContain('data-foldkit-build="test-build"')
  })
})
