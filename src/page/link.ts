// page/link.ts: what the pages share: the one kind of link the app has, and
// the mark on each page's heading.
//
// A link between pages is an ordinary `<a href>`. Nothing on it says
// "routing": there is no click handler and no special component. The runtime
// listens for clicks on links across the whole document, and when the app
// has routing it stops the browser from loading the address and sends the
// ClickedLink Message instead (src/main.ts, ROUTING in the header). Because
// the element is a real link, the things people expect of one still work:
// the address shows on hover, and it can be opened in a new tab or copied.
// The runtime leaves those clicks to the browser.
//
// The address comes from a router in src/route.ts (`howToRouter()` is
// `'/how-to'`), so a path is never typed out in a view.
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from '../main'
import { PAGE_HEADING_ID } from '../route'

// The look of a link in running text: underlined, and brighter under the
// pointer. The `focus-visible:` classes draw a ring when the link is
// reached with the keyboard, and not when it is clicked.
const LINK_CLASS =
  'rounded-sm text-slate-100 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white'

// The heading that names a page takes these two attributes, on every page.
// The id is the one the FocusPageHeading Command looks for (src/main.ts):
// when the page changes, focus moves to this heading and a screen reader
// reads it out. `tabindex="-1"` is what lets a heading take focus from
// code. It does not add the heading to the Tab order.
//
// The attributes are a function of the builder, like a view, because an
// attribute is made with `h`. The result is spread into the heading's own
// attribute list: `h.h2([...pageHeadingAttributes(h), h.Class('...')], ...)`.
// Each heading also carries the class `outline-none`: focus arrives here
// from code, not from the Tab key, and a ring round a line of text would
// suggest it can be pressed.
/** Marks the heading that focus moves to when its page appears. */
export const pageHeadingAttributes = (h: HtmlBuilder<Message>) => [
  h.Id(PAGE_HEADING_ID),
  h.Tabindex(-1),
]

// `h.Href` sets the `href` attribute. The label is the link's only child, a
// string, which becomes its text and so its accessible name: the Scene tests
// find the link by it (`role('link', { name: ... })`).
/** A text link to `href`, one of the paths built by a router in route.ts. */
export const textLink = (
  href: string,
  label: string,
  h: HtmlBuilder<Message>,
): Html => h.a([h.Href(href), h.Class(LINK_CLASS)], [label])
