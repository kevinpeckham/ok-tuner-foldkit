// header.ts: the brand at the top of every page.
//
// What this file is. A view function with no state, like the footer. `view`
// in src/view.ts draws it above whichever page is showing.
//
// The brand is the site's name as a link to the home page. It is not a
// heading: each page has one `<h1>` of its own, which names that page, so a
// screen reader's list of headings starts with where you are and not with
// the same two words on every page. The element is a `<header>` placed
// beside the `<main>`, not inside it, which makes it the page's "banner"
// landmark, as the `<footer>` is its "contentinfo" (src/footer.ts).
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from './main'
import { tunerRouter } from './route'

// VIEW

// The link's text is its accessible name. `tunerRouter()` builds the path
// of the home page, `/`. On the home page itself the link leads where you
// already are, which is how a brand link usually behaves.
/** The header shown above every page. */
export const view = (h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class('px-6 pt-12')],
    [
      h.div(
        [h.Class('mx-auto w-full max-w-[600px]')],
        [
          h.a(
            [
              h.Href(tunerRouter()),
              h.Class(
                'rounded-sm font-serif text-3xl text-slate-100 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white',
              ),
            ],
            ['OK Tuner'],
          ),
        ],
      ),
    ],
  )
