// footer.ts: the two rows of small print under every page.
//
// What this file is. A view function with no state, like the pages under
// src/page. It is not a page: `view` in src/view.ts draws it under whichever
// page is showing, so it is in every file the build writes, the 404 page
// included.
//
//   row 1   what kind of site this is, with a link to the Privacy page
//   row 2   the copyright and license line, a link to the Built With page,
//           and a link to the code
//   row 3   who built it, the version, and where the tuner came from
//
// The last two rows are patterned on the last two of Stem Shovel's footer.
//
// The element is a `<footer>` placed beside the `<main>`, not inside it.
// That placement is what makes it the page's "contentinfo" landmark, which a
// screen reader lists and can jump to. Inside `<main>` it would be an
// ordinary block (src/scene.test.ts, 'footer').
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { COLUMN_CLASS } from './layout'
import { type Message } from './main'
import { LINK_CLASS, textLink } from './page/link'
import { builtWithRouter, privacyRouter } from './route'
import {
  COPYRIGHT_HOLDER,
  COPYRIGHT_YEAR,
  GITHUB_URL,
  LICENSE_URL,
  LIGHTNING_JAR_URL,
  STEM_SHOVEL_URL,
  VERSION,
} from './site'

// The bar between the items of the second row. It is decoration, so
// `aria-hidden` keeps a screen reader from reading out "vertical line".
const separatorView = (h: HtmlBuilder<Message>): Html =>
  h.span([h.AriaHidden(true), h.Class('opacity-50')], ['|'])

// VIEW

// Each link's text is its accessible name, so the names in the tests are
// the words on the page. One link stays inside the app: `builtWithRouter()`
// builds the path `/built-with`, and the runtime changes page without a
// page load. The others go to other sites, which the runtime reports as
// external links, and `update` answers those with a full page load
// (`LoadExternal` in src/main.ts). Nothing on the links themselves says
// which kind they are.
//
// The lightning bolt is decoration too, and hidden the same way as the bar.
// `VERSION` comes from package.json (src/site.ts).
/** The footer shown under every page. */
export const view = (h: HtmlBuilder<Message>): Html =>
  h.footer(
    [
      h.Class(
        'border-t border-white/10 px-6 pt-8 pb-12 text-xs text-slate-300',
      ),
    ],
    [
      h.div(
        [h.Class(COLUMN_CLASS)],
        [
          // The first row is a sentence that ends in a link. On screen the
          // link reads "Learn More". Heard on its own, in a screen reader's
          // list of links, those two words would say nothing, so the link
          // carries a few more that are in the page and not on screen
          // (`sr-only`). The visible words come first in the name, so a
          // person who says "click Learn More" to voice control is
          // understood. The link is built by hand, and not with
          // `textLink`, because its content is more than one string.
          h.p(
            [],
            [
              'This application is ad-free, open-source and privacy-respecting. Safe for all ages. ',
              h.a(
                [h.Href(privacyRouter()), h.Class(LINK_CLASS)],
                [
                  'Learn More',
                  h.span([h.Class('sr-only')], [' about privacy']),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('mt-3 flex flex-wrap items-center gap-x-4 gap-y-2')],
            [
              h.span(
                [],
                [
                  `© ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER}. Open source under the `,
                  textLink(LICENSE_URL, 'Apache 2.0 license', h),
                  '.',
                ],
              ),
              textLink(builtWithRouter(), 'Built with Foldkit', h),
              textLink(GITHUB_URL, 'GitHub', h),
            ],
          ),
          h.div(
            [h.Class('mt-3 flex flex-wrap items-center gap-x-2 gap-y-2')],
            [
              h.span(
                [],
                [
                  'Built by ',
                  h.span([h.AriaHidden(true)], ['⚡️ ']),
                  textLink(LIGHTNING_JAR_URL, 'Lightning Jar', h),
                ],
              ),
              separatorView(h),
              h.span([h.Class('font-mono')], [`v${VERSION}`]),
              separatorView(h),
              h.span(
                [],
                ['Ported from ', textLink(STEM_SHOVEL_URL, 'Stem Shovel', h)],
              ),
            ],
          ),
        ],
      ),
    ],
  )
