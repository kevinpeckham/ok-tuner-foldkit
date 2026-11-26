// site.test.ts: the files and settings that sit outside the app but have to
// agree with it: robots.txt, sitemap.xml and vercel.json.
//
// None of the three is TypeScript, so nothing checks them against the code
// unless a test does. Vite can import a file as text (`?raw`) and a JSON
// file as data, and Vitest does the same, so each is read here and held to
// what the app says: the pages it has and the address it lives at.
import { describe, expect, test } from 'vitest'

import robots from '../public/robots.txt?raw'
import sitemap from '../public/sitemap.xml?raw'
import vercelConfig from '../vercel.json'
import { pagePaths } from './entry.server'
import { SENTRY_DSN } from './sentry'
import { SITE_ORIGIN } from './site'

describe('sitemap.xml', () => {
  // The guard against a page being added to the app and not to the
  // sitemap, or taken out of one and not the other.
  test('lists every page of the site, and nothing else', () => {
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      match => match[1],
    )

    expect(listed).toEqual(pagePaths.map(path => `${SITE_ORIGIN}${path}`))
  })
})

describe('robots.txt', () => {
  test('lets every crawler in and says where the sitemap is', () => {
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Allow: /')
    expect(robots).not.toMatch(/^Disallow: \/$/m)
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)
  })
})

// The headers Vercel adds to every response. A rule is a pattern for the
// address (`source`), optional conditions (`has`, `missing`), and the
// headers to add.
describe('vercel.json headers', () => {
  const rules = vercelConfig.headers
  const headersOf = (rule: (typeof rules)[number]) =>
    Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]))

  // The live site is public. The same build also answers at Vercel's own
  // addresses, and those copies should stay out of search results. So the
  // "do not index" header is added whenever the host is NOT the live one:
  // `missing` is Vercel's word for "this condition does not hold".
  test('only hosts other than the live one are marked noindex', () => {
    const noindex = rules.filter(
      rule => headersOf(rule)['X-Robots-Tag'] === 'noindex',
    )

    expect(noindex).toHaveLength(1)
    expect(noindex[0]?.missing).toEqual([
      { type: 'host', value: new URL(SITE_ORIGIN).host },
    ])
  })

  // The Content Security Policy tells the browser what the page may load
  // and where it may send things. This pins the parts that matter: scripts
  // from the site only and never from text, and network requests to the
  // site and to Sentry's address for this project, taken from the DSN.
  test('the content security policy allows the site, Sentry, and nothing else to run', () => {
    const everywhere = rules.find(rule => rule.missing === undefined)
    const policy =
      everywhere === undefined
        ? ''
        : (headersOf(everywhere)['Content-Security-Policy'] ?? '')
    const directive = (name: string) =>
      policy
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${name} `)) ?? ''

    expect(directive('default-src')).toBe("default-src 'self'")
    expect(directive('script-src')).toBe("script-src 'self'")
    expect(directive('connect-src')).toBe(
      `connect-src 'self' ${new URL(SENTRY_DSN).origin}`,
    )
    // Stylesheets from the site only. The one allowance is for `style`
    // attributes on elements, which the tuner's needle and Foldkit's
    // components set: without it the page broke in a browser.
    expect(directive('style-src')).toBe("style-src 'self'")
    expect(directive('style-src-attr')).toBe("style-src-attr 'unsafe-inline'")
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(policy).not.toContain('unsafe-eval')
  })

  test('the other security headers are set everywhere', () => {
    const everywhere = rules.find(rule => rule.missing === undefined)
    const headers = everywhere === undefined ? {} : headersOf(everywhere)

    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toContain('microphone=(self)')
  })
})

// Each page is written as a folder holding an `index.html`, and Vercel also
// answers at that file's own address. The app has no route for a path that
// ends in `index.html`, so it showed the page and then replaced it with
// "Page not found". The redirects send those addresses to the real ones
// before any file is served.
describe('vercel.json redirects', () => {
  test('an address ending in index.html goes to the page itself, for good', () => {
    expect(vercelConfig.redirects).toEqual([
      { source: '/index.html', destination: '/', permanent: true },
      {
        source: '/:path+/index.html',
        destination: '/:path+',
        permanent: true,
      },
    ])
  })
})
