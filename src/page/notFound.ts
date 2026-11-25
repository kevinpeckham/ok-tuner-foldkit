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
// On the live site this is also the 404 page. The site is prerendered, and
// the build draws this view once and writes it to `404.html`
// (src/entry.server.ts, `NOT_FOUND_PATH`). An address with no file gets
// status 404, and Vercel sends that file with it. The browser then takes
// the page over like any other, so the link below changes page without a
// page load.
//
// NOTE: the page does not say which address was asked for, although the
// route carries it. The one file is served for every unknown address, and
// the build drew it for the address `/404`. A page that printed the path
// would show every visitor "/404" until the script had run and corrected
// it, and the browser would find a page that does not match its own
// drawing. A page that is the same for every address matches exactly.
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from '../main'
import { tunerRouter } from '../route'
import { pageHeadingAttributes, textLink } from './link'

// VIEW

// The page takes only the builder, like the how-to page: it shows nothing
// that depends on the address (see the NOTE above).
/** The page shown for an address no route matches. */
export const view = (h: HtmlBuilder<Message>): Html =>
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
      h.p(
        [h.Class('mt-3 text-slate-200')],
        ['There is no page at this address.'],
      ),
      h.p([h.Class('mt-6')], [textLink(tunerRouter(), 'Back to the tuner', h)]),
    ],
  )
