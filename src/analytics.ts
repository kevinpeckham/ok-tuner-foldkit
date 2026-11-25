// analytics.ts: counting visits, with Vercel Web Analytics.
//
// What this file is. The one place that touches `@vercel/analytics`, as
// src/sentry.ts is for Sentry. It is plain code, not Foldkit: counting is
// not part of what the app does, and nothing in the Model depends on it.
// src/entry.ts calls `startAnalytics` once, before the app starts.
//
// What it does. `inject` adds one script tag to the page. The script is
// served by Vercel from an address on the site itself
// (`/_vercel/insights/script.js`), which is what "first-party" means here:
// the browser talks to no other site. From then on the script reports each
// page view by itself, a fresh page load and a change of page inside the
// app alike (it listens for the address changing), so there is no Message
// and no Command for it.
//
// What a page view carries, by Vercel's documentation: the page's address,
// the referring site, the time, an approximate location, and the kind of
// device, operating system and browser. No cookie is set. Visitors are told
// apart by a hash made from the request, which is thrown away after 24
// hours. The Privacy page (src/page/privacy.ts) tells visitors the same:
// if this file changes what is collected, change that page too.
//
// NOTE: Web Analytics has to be switched on for the project in Vercel as
// well. Until it is, the script's address answers 404 and nothing is
// counted (FINDINGS.md, "Vercel Web Analytics is two switches").
import { inject } from '@vercel/analytics'

import { environmentOf } from './sentry'

// Visits are counted on the live site and nowhere else: `environmentOf` is
// the same hostname check that tags an error report `production`
// (src/sentry.ts). The dev server and `localhost` have no such script to
// load, and a preview is not the site.
/** Whether visits to this hostname are counted. */
export const countsVisitsFrom = (hostname: string): boolean =>
  environmentOf(hostname) === 'production'

// `mode: 'production'` says to load the real script. Left to itself the
// package guesses the mode from the build, and in its development mode it
// loads a debugging script from another site, which this app never wants.
//
// The `try` is there because counting is a convenience. Whatever goes wrong
// in someone else's package, the tuner must still start.
/** Starts counting page views, on the live site only. Never throws. */
export const startAnalytics = (hostname: string): void => {
  if (!countsVisitsFrom(hostname)) {
    return
  }

  try {
    inject({ mode: 'production' })
  } catch {
    // Nothing to do: the site works the same uncounted.
  }
}
