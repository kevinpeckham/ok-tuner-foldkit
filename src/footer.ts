// footer.ts: the two rows of small print under every page.
//
// What this file is. A view function with no state, like the pages under
// src/page. It is not a page: `view` in src/view.ts draws it under whichever
// page is showing, so it is in every file the build writes, the 404 page
// included. It is patterned on the last two rows of Stem Shovel's footer.
//
//   row 1   the copyright and license line, a link to the Built With page,
//           and a link to the code
//   row 2   who built it, the version, and where the tuner came from
//
// The element is a `<footer>` placed beside the `<main>`, not inside it.
// That placement is what makes it the page's "contentinfo" landmark, which a
// screen reader lists and can jump to. Inside `<main>` it would be an
// ordinary block (src/scene.test.ts, 'footer').
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from './main'
import { textLink } from './page/link'
import { builtWithRouter } from './route'
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
        [h.Class('mx-auto w-full max-w-[600px]')],
        [
          h.div(
            [h.Class('flex flex-wrap items-center gap-x-4 gap-y-2')],
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
