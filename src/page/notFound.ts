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
// NOTE: on the live site this page is served with status 200, not 404.
// Vercel sends every path that is not a file to index.html, and only then
// does the app discover that it has no such page (FINDINGS.md, "An unknown
// address is answered 200").
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from '../main'
import { tunerRouter } from '../route'
import { textLink } from './link'

// VIEW

// `path` is the `path` field of the NotFound route. A string child becomes a
// text node, so the path is shown as text and is never read as markup,
// whatever characters the address held.
/** The page shown for an address no route matches. */
export const view = (path: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.h2([h.Class('mt-8 font-semibold text-slate-50')], ['Page not found']),
      h.p([h.Class('mt-3 text-slate-200')], [`There is no page at ${path}.`]),
      h.p([h.Class('mt-6')], [textLink(tunerRouter(), 'Back to the tuner', h)]),
    ],
  )
