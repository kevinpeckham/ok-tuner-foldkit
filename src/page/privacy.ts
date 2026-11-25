// page/privacy.ts: the Privacy page, at `/privacy`.
//
// What this file is. One page of the app: what the site does with data, in
// plain words. The first row of the footer links to it (src/footer.ts).
// Like the other text pages it is static: content as data, then a view
// that lays it out.
//
// NOTE: this page makes promises, so it has to stay true. It describes
// three things the code does: the microphone (src/microphone.ts), error
// reports (src/sentry.ts) and visitor counts (src/analytics.ts). A change
// to any of them that alters what leaves the browser must change this page
// in the same commit (AGENTS.md, "Privacy"). What it says of Vercel's
// counting comes from Vercel's documentation, linked below.
import { Array } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { type Message } from '../main'
import { tunerRouter } from '../route'
import { GITHUB_URL } from '../site'
import { pageHeadingAttributes, textLink } from './link'

// A part of a paragraph: plain text, or a link. A paragraph is a list of
// these, which is how a link sits inside a sentence while the content
// stays data.
type Part = string | Readonly<{ label: string; url: string }>

// A titled section of one or more paragraphs.
type Section = Readonly<{
  title: string
  paragraphs: ReadonlyArray<ReadonlyArray<Part>>
}>

const SECTIONS: ReadonlyArray<Section> = [
  {
    title: 'Your microphone',
    paragraphs: [
      [
        'The tuner listens only while it is switched on. The sound is analysed in your browser, on your device. It is never recorded and never sent anywhere.',
      ],
    ],
  },
  {
    title: 'What is saved on your device',
    paragraphs: [
      [
        'Your chosen tuning and reference pitch are saved in your browser, so they are there next time. They stay on your device. The site sets no cookies.',
      ],
    ],
  },
  {
    title: 'Error reports',
    paragraphs: [
      [
        'If something goes wrong, the site sends an error report to ',
        { label: 'Sentry', url: 'https://sentry.io' },
        ' so that it can be fixed. A report holds the error, the address of the page, the type of browser, its language and time zone, and the clicks and console messages just before the error.',
      ],
      [
        'Sentry works out an approximate location, a country and sometimes a city, from the connection, and does not store your IP address. A visit where nothing goes wrong sends no report.',
      ],
    ],
  },
  {
    title: 'Visitor counts',
    paragraphs: [
      [
        'The site counts visits with ',
        {
          label: 'Vercel Web Analytics',
          url: 'https://vercel.com/docs/analytics/privacy-policy',
        },
        ', which is run by the company that hosts it and served from this site’s own address. Each page view records the page, the site you came from, the time, an approximate location, and the kind of device, operating system and browser.',
      ],
      [
        'It uses no cookies. Visitors are told apart by a short-lived code made from the request, which is discarded after 24 hours, so a visit cannot be tied to you or followed from day to day or site to site. The figures are only ever used as totals.',
      ],
    ],
  },
  {
    title: 'What there is not',
    paragraphs: [
      [
        'No adverts and no advertising trackers. No accounts, and nothing asked of you, whatever your age. Nothing is sold, and nothing is shared beyond the two services above.',
      ],
    ],
  },
  {
    title: 'Check it yourself',
    paragraphs: [
      [
        'The site is open source. Everything on this page can be checked against the code on ',
        { label: 'GitHub', url: GITHUB_URL },
        '.',
      ],
    ],
  },
]

// VIEW

// One part of a paragraph. A string is returned as it is and becomes a text
// node. A link becomes an `<a>`. The return type says a child may be
// either.
const partView = (part: Part, h: HtmlBuilder<Message>): Html | string =>
  typeof part === 'string' ? part : textLink(part.url, part.label, h)

const sectionView = (section: Section, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('mt-8')],
    [
      h.h2([h.Class('font-semibold text-slate-50')], [section.title]),
      ...Array.map(section.paragraphs, parts =>
        h.p(
          [h.Class('mt-3 leading-relaxed text-slate-200')],
          Array.map(parts, part => partView(part, h)),
        ),
      ),
    ],
  )

/** The Privacy page. */
export const view = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      // The heading that names this page: focus moves here when the page
      // appears (src/page/link.ts, `pageHeadingAttributes`).
      h.h1(
        [
          ...pageHeadingAttributes(h),
          h.Class('mt-8 font-semibold text-slate-50 outline-none'),
        ],
        ['Privacy'],
      ),
      h.p(
        [h.Class('mt-3 leading-relaxed text-slate-200')],
        [
          'OK Tuner is ad-free and open source, and it is built to know as little about you as it can. This page says what it does with data.',
        ],
      ),
      ...Array.map(SECTIONS, section => sectionView(section, h)),
      h.p([h.Class('mt-8')], [textLink(tunerRouter(), 'Back to the tuner', h)]),
    ],
  )
