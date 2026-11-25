// page/notFound.ts: the page for an address the app does not have.
//
// Every address has to become some page, because the view must always
// return something. `urlToAppRoute` in src/route.ts turns an address that no
// router matches into the `NotFound` route, which carries the path that was
// asked for, and `view` in src/view.ts calls this function for it.
//
// Like the how-to page, this one is static: a view function and nothing
// more.
//
// NOTE: on the live site, opening an unknown address does not reach this
// page. The site is prerendered, an address with no file is a 404, and
// Vercel answers with public/404.html, a page written by hand that says the
// same thing. This view is what shows when the app itself arrives at an
// address it does not have, without a page load, and in development, where
// the dev server renders every address through the app.
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from '../main'
import { tunerRouter } from '../route'
import { pageHeadingAttributes, textLink } from './link'

// VIEW

// `path` is the `path` field of the NotFound route. A string child becomes a
// text node, so the path is shown as text and is never read as markup,
// whatever characters the address held.
/** The page shown for an address no route matches. */
export const view = (path: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      // The heading that names this page: focus moves here when the page
      // appears (src/page/link.ts, `pageHeadingAttributes`).
      h.h2(
        [
          ...pageHeadingAttributes(h),
          h.Class('mt-8 font-semibold text-slate-50 outline-none'),
        ],
        ['Page not found'],
      ),
      h.p([h.Class('mt-3 text-slate-200')], [`There is no page at ${path}.`]),
      h.p([h.Class('mt-6')], [textLink(tunerRouter(), 'Back to the tuner', h)]),
    ],
  )
