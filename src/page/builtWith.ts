// page/builtWith.ts: the Built With page, at `/built-with`.
//
// What this file is. One page of the app: what OK Tuner is made of, for the
// curious and for anyone who wants to run their own copy. It is patterned
// on the page of the same name in Stem Shovel: a few words of introduction,
// then groups of cards, each card a link and a line about what the thing
// does here.
//
// Like the how-to page it is static: a view function and nothing more, with
// its content kept as data above it. `view` in src/view.ts calls it when
// the route is `BuiltWith`, and the footer on every page links to it
// (src/footer.ts).
//
// Keep the list to what the app really depends on (package.json,
// vite.config.ts, vercel.json), and change it when that changes.
import { Array } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from '../main'
import { tunerRouter } from '../route'
import { GITHUB_URL, LIGHTNING_JAR_URL, STEM_SHOVEL_URL } from '../site'
import { pageHeadingAttributes, textLink } from './link'

// One card: the name of a thing, where to read about it, and what it does
// in this app. `Readonly<{...}>` is the house way to write a record type
// that is not a Schema (FOLDKIT.md, "Code Style"): nothing here is part of
// the Model, so plain types will do.
type Item = Readonly<{ name: string; url: string; what: string }>

// A titled group of cards, with a line under the title.
type Group = Readonly<{
  title: string
  blurb: string
  items: ReadonlyArray<Item>
}>

// The content of the page, as data. The view below only lays it out.
const GROUPS: ReadonlyArray<Group> = [
  {
    title: 'The app',
    blurb: 'A web page, so it runs in the browser you already have.',
    items: [
      {
        name: 'Foldkit',
        url: 'https://foldkit.dev',
        what: 'The framework: one Model, Messages and a pure update function, after the Elm architecture. Its components draw the tuning list, the settings menu and the level meter.',
      },
      {
        name: 'Effect',
        url: 'https://effect.website',
        what: 'The library Foldkit is built on: typed effects, schemas and streams.',
      },
      {
        name: 'TypeScript',
        url: 'https://www.typescriptlang.org',
        what: 'Every line is typed.',
      },
      {
        name: 'Vite',
        url: 'https://vite.dev',
        what: 'Builds the site and serves it in development.',
      },
      {
        name: 'Tailwind CSS',
        url: 'https://tailwindcss.com',
        what: 'Utility styling, written beside the markup.',
      },
    ],
  },
  {
    title: 'Sound',
    blurb:
      'Everything happens in your browser. The sound never leaves your device, and nothing is recorded.',
    items: [
      {
        name: 'getUserMedia',
        url: 'https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia',
        what: 'Opens the microphone, with your permission.',
      },
      {
        name: 'Web Audio API',
        url: 'https://developer.mozilla.org/docs/Web/API/Web_Audio_API',
        what: 'Reads the sound as samples, twenty times a second.',
      },
      {
        name: 'McLeod pitch method',
        url: `${GITHUB_URL}/blob/main/src/pitch.ts`,
        what: 'Finds the pitch in each reading. The link is to this app’s own implementation.',
      },
    ],
  },
  {
    title: 'Running it',
    blurb: 'A static site, with no accounts and no database.',
    items: [
      {
        name: 'Vercel',
        url: 'https://vercel.com',
        what: 'Builds and hosts the site. The pages are built ahead of time, so there is no server.',
      },
      {
        name: 'Sentry',
        url: 'https://sentry.io',
        what: 'Receives error reports, and nothing else: no visits are counted and nothing identifies you.',
      },
      {
        name: 'Varlock and 1Password',
        url: 'https://varlock.dev',
        what: 'Load the one secret the build needs.',
      },
      {
        name: 'Bun',
        url: 'https://bun.sh',
        what: 'Installs the packages and runs the scripts.',
      },
    ],
  },
  {
    title: 'Checking it',
    blurb: 'What is run before a change goes live.',
    items: [
      {
        name: 'Vitest',
        url: 'https://vitest.dev',
        what: 'The tests, which run without a browser.',
      },
      {
        name: 'Oxlint and Oxfmt',
        url: 'https://oxc.rs',
        what: 'Linting and formatting.',
      },
    ],
  },
]

// VIEW

// One card. The name is the link, and its text is the link's accessible
// name: there is no `aria-label` to drift from what is shown. The link goes
// to another site, which the runtime reports as an external link, and
// `update` answers with a full page load (`LoadExternal` in src/main.ts).
const itemView = (item: Item, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('rounded-md border border-white/20 p-3')],
    [
      h.a(
        [
          h.Href(item.url),
          h.Class(
            'rounded-sm font-semibold text-slate-50 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white',
          ),
        ],
        [item.name],
      ),
      h.p([h.Class('mt-1 text-sm text-slate-300')], [item.what]),
    ],
  )

// One group: its title, its line, and its cards in a grid of one column on
// a phone and two from Tailwind's `sm` width up. The lists are not keyed:
// they never change, so there is nothing for a key to keep track of.
const groupView = (group: Group, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('mt-8')],
    [
      h.h3([h.Class('font-semibold text-slate-50')], [group.title]),
      h.p([h.Class('mt-1 text-sm text-slate-300')], [group.blurb]),
      h.ul(
        [h.Class('mt-3 grid gap-2 sm:grid-cols-2')],
        Array.map(group.items, item => itemView(item, h)),
      ),
    ],
  )

// The page. A child array can hold text and elements side by side, which is
// how a link sits inside a sentence: the strings become text nodes around
// the `<a>`. `...Array.map(...)` spreads the groups in among the fixed
// children.
/** The Built With page. */
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
        ['Built with'],
      ),
      h.p(
        [h.Class('mt-3 leading-relaxed text-slate-200')],
        [
          'OK Tuner is open source and made mostly of other open-source work. This is the list, for the curious and for anyone who wants to run their own copy. The code is on ',
          textLink(GITHUB_URL, 'GitHub', h),
          '.',
        ],
      ),
      ...Array.map(GROUPS, group => groupView(group, h)),
      h.p(
        [h.Class('mt-8 text-sm text-slate-300')],
        [
          'Built by ',
          textLink(LIGHTNING_JAR_URL, 'Lightning Jar', h),
          ', a small web studio. Ported from the tuner in ',
          textLink(STEM_SHOVEL_URL, 'Stem Shovel', h),
          '.',
        ],
      ),
      h.p([h.Class('mt-6')], [textLink(tunerRouter(), 'Back to the tuner', h)]),
    ],
  )
