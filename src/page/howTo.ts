// page/howTo.ts: the "How to use the tuner" page, at `/how-to`.
//
// What this file is. One page of the app: a view function, and nothing
// else. The page is static text, so it has no state of its own, no Messages
// and no `update`, and its view takes only the builder. A page that did have
// state would be a Submodel, with its own Model, Message and update folded
// into the app's, as the Listbox and the Popover are in src/main.ts
// (FOLDKIT.md, "Update").
//
// Where it sits. `view` in src/view.ts looks at the route in the Model and
// calls this function when it is `HowTo`. The heading and the page ground
// around it are drawn there, and are the same on every page.
//
// The file lives under src/page because the view is split by page, which is
// how Foldkit's larger examples are laid out (FOLDKIT.md, "File
// Organization"). The text was on the tuner's page until 2026-11-25, and
// moved here unchanged.

// Effect's `Array` module, which shadows JavaScript's global `Array` in this
// file: `Array.map(items, f)` takes the array as its first argument.
import { Array } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'

// A type-only import. This file needs the Message type for the builder, and
// nothing from main.ts at run time.
import { type Message } from '../main'
import { tunerRouter } from '../route'
import { pageHeadingAttributes, textLink } from './link'

// The tips, kept as data. `view` maps them to list items.
// `ReadonlyArray<string>` is the house spelling of `readonly string[]`
// (FOLDKIT.md, "Code Style").
const HOW_TO_TIPS: ReadonlyArray<string> = [
  'Pick your tuning from the menu: guitar standard, drop D, a half step down, DADGAD, open G, bass, five-string bass or ukulele.',
  'Choose Chromatic for any other instrument or tuning: it just names whatever it hears.',
  'The menu beside the tuning sets A4 if your band tunes to 442 Hz; the tuning and the reference pitch are remembered on this device.',
  'Play one string at a time and let it ring: the needle settles rather than jitters.',
]

// VIEW

// The page: the boxed text, then a link back to the tuner. `h.div` with no
// attributes is only a wrapper, there so that the function returns one Html.
//
// The tips are mapped from `HOW_TO_TIPS` with Effect's `Array.map`. They are
// not keyed: the list never changes, so there is nothing for a key to keep
// track of.
//
// `tunerRouter()` builds the path of the tuner's page, `/`.
/** The "How to use the tuner" page. */
export const view = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.section(
        [
          h.Class(
            'mt-8 rounded-md border border-white/70 p-5 leading-relaxed text-slate-200',
          ),
        ],
        [
          // The heading that names this page: focus moves here when the
          // page appears (src/page/link.ts, `pageHeadingAttributes`).
          h.h2(
            [
              ...pageHeadingAttributes(h),
              h.Class('font-semibold text-slate-50 outline-none'),
            ],
            ['How to use the tuner'],
          ),
          h.p(
            [h.Class('mt-3')],
            [
              'Turn the tuner on (the browser asks for the microphone once) and play a single string or note. The nearest note shows large, the needle reads how many cents sharp or flat it is (green within five), and the string of your tuning it is closest to lights up. Nothing is recorded.',
            ],
          ),
          h.h3([h.Class('mt-5 font-semibold text-slate-50')], ['Quick tips']),
          h.ul(
            [h.Class('mt-3 list-disc space-y-2 pl-5')],
            Array.map(HOW_TO_TIPS, tip => h.li([], [tip])),
          ),
        ],
      ),
      h.p([h.Class('mt-6')], [textLink(tunerRouter(), 'Back to the tuner', h)]),
    ],
  )
