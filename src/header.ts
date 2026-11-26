// header.ts: the brand at the top of every page.
//
// What this file is. A view function with no state, like the footer. `view`
// in src/view.ts draws it above whichever page is showing, and the crash
// screen (src/crash.ts) draws it too.
//
// The brand is the site's name as a link to the home page. It is not a
// heading: each page has one `<h1>` of its own, which names that page, so a
// screen reader's list of headings starts with where you are and not with
// the same two words on every page. The element is a `<header>` placed
// beside the `<main>`, not inside it, which makes it the page's "banner"
// landmark, as the `<footer>` is its "contentinfo" (src/footer.ts).
import { type Attribute, type Html, type HtmlBuilder } from 'foldkit/html'

import { COLUMN_CLASS } from './layout'
import { tunerRouter } from './route'

// VIEW

// The link's text is its accessible name. `tunerRouter()` builds the path
// of the home page, `/`. On the home page itself the link leads where you
// already are, which is how a brand link usually behaves.
//
// Two things about this function are there for the crash screen.
//
// It is generic in `Message`. Every other view in the app takes an
// `HtmlBuilder<Message>` with the app's own Message type. The header sends
// no Message, so it can take a builder of any Message type, and the crash
// screen has a different one: Foldkit hands a crash view an
// `HtmlBuilder<never>`, a builder that cannot make an event handler at all.
// A function written for `HtmlBuilder<Message>` does not accept it.
//
// `brandLinkAttributes` is spread into the link's attributes. The pages
// pass an empty list. The crash screen passes `target="_top"`, without
// which the link would do nothing once the app has stopped (src/crash.ts,
// "WHY EVERY LINK HERE HAS A TARGET"). The builder stays the last
// parameter, as in every view function (FOLDKIT.md, "View").
/** The header shown above every page, and above the crash screen. */
export const view = <Message>(
  brandLinkAttributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.header(
    [h.Class('px-6 pt-12')],
    [
      h.div(
        [h.Class(COLUMN_CLASS)],
        [
          h.a(
            [
              h.Href(tunerRouter()),
              h.Class(
                'rounded-sm font-serif text-3xl text-slate-100 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white',
              ),
              ...brandLinkAttributes,
            ],
            ['OK Tuner'],
          ),
        ],
      ),
    ],
  )
