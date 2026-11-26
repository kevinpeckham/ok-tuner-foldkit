// view.ts: every page, as a function of the Model.
//
// Where this file sits. A Foldkit app follows the Elm architecture: a Model
// holds all the state, `update` is the only place the state changes, and
// `view` turns the current Model into a description of the page. The Model,
// the Messages and `update` are in `src/main.ts`. This file is the view.
// Nothing in it changes state, opens the microphone or touches the DOM: every
// function takes data in and returns a description of HTML.
//
// What the runtime does with it. `src/entry.ts` hands `view` to
// `Runtime.makeApplication`. When `update` returns a new Model (a different
// object from the one it was given), the runtime calls `view` again, compares
// the result with the previous one (a virtual DOM) and patches only the
// differences into the page. The very first render is different: the page
// is already there, drawn by the build into the HTML file (the same `view`,
// run by src/entry.server.ts), and the runtime takes those elements over
// where another app would create them. A
// Message that leaves the Model as it was draws nothing. Renders are batched:
// however many Messages arrive between two animation frames, the view runs
// once, with the latest Model. That matters here, because the tuner sends
// about twenty readings a second.
//
// How an event gets back to `update`. The view never handles an event itself.
// It attaches a Message to an element (`onClick: Message.ClickedPower()`), or
// a function that builds a Message from the event's value
// (`onInput: value => Message.UpdatedA4Input({ value })`). When the event
// fires, the runtime dispatches that Message to `update`, `update` returns the
// next Model, and the page is drawn from it. Data flows one way:
// Model -> view -> Message -> update -> Model.
// The attributes that do this are `h.OnClick(message)` and
// `h.OnInput(value => message)`. This file never writes them out, because its
// interactive parts all go through `@foldkit/ui` components, which call them
// for us with the Messages we pass in.
//
// Derived, not stored. The Model holds only what cannot be worked out: the
// power state, the last reading, the smoothed needle, the chosen tuning, A4.
// The note name and octave, the "sharp / flat / in tune" wording, the needle's
// position, the lit string and whether the A4 field is valid are all computed
// here on every render (the DISPLAY section below). A stored copy could fall
// out of step with the reading it came from. A derived value cannot. The
// design says the same under "Model".
//
// The pages. The app has three, and the `route` field of the Model says
// which one is showing (src/route.ts). `view` draws what every page shares
// and hands the rest to the page's own view function:
//
//   view                     the title, the page ground, the "OK Tuner" heading
//     tunerPageView          route Tuner: the tuner, in this file
//     HowTo.view             route HowTo: src/page/howTo.ts
//     NotFound.view          route NotFound: src/page/notFound.ts
//
// The tuner's page is by far the largest, and the rest of this file is
// about it. Its layout, top to bottom, and the function that draws each
// part. The drawing in the design ("What is on screen") shows the same
// screen:
//
//   tunerPageView            intro line, the tuner, the link to the how-to page
//     tunerView              the grey pedal body
//       screenView           the dark screen
//         levelView          input level bar             (ui: Meter)
//         powerLightView     the green light
//         noteView           the big note and its octave
//         (inline)           the "Hz, cents, in tune" line
//         needleView         the needle bar
//         scaleView          -50 / 0 / +50
//       stringsView          one chip per string of the tuning
//         stringView
//       controlsView
//         tuningPickerView   the tuning list             (ui: Listbox)
//         settingsMenuView   the three-dot menu          (ui: Popover)
//           a4FieldView      the A4 number field         (ui: Input)
//       powerRowView         the button, and the room kept beside it
//         powerButtonView    On / Off                    (ui: Button)
//         messagesView       the room for one line of words
//           startHintView    "Waiting for the microphone", on a slow start
//           failureView      the error line
//       (inline)             the "OK Tuner 001" badge
//
// Conventions you will see throughout (FOLDKIT.md, "View" and "Code Style"):
//   - Every view function takes `h`, the Html builder, as its last parameter.
//   - `h.empty` renders nothing. There is no `null` or `&&` in the markup.
//   - A choice between pieces of markup is an exhaustive match
//     (`Option.match`, `Array.match`, `TunerState.match`): the compiler
//     insists that every case is handled.
//   - Keys appear in one place only: on the items of the mapped list that
//     changes with the Model (`stringView`). The switch between pages is
//     not keyed: each page is its own named view function, and Foldkit's
//     build gives each view function's output its own identity, so changing
//     page replaces the old page's DOM (FOLDKIT.md, "View").
//
// Read `src/main.ts` first: the Model, Message and TunerState used here are
// defined there. Then `src/scene.test.ts`, which drives this file through its
// roles and labels, shows what each part is expected to render.

// Effect ships its own `Array` and `Option` modules. Importing them under
// these names shadows JavaScript's global `Array` in this file, on purpose:
// `Array.map(items, f)` and `Array.match(items, {...})` below are Effect's
// functions, which take the array as their first argument.
// `Option<A>` is Effect's "maybe a value": either `Option.some(a)` or
// `Option.none()`. It stands in for `null` and `undefined`, and whoever reads
// one has to say what happens in both cases.
import { Array, Option } from 'effect'
// `foldkit/html` is the view layer's vocabulary:
//   - `Html`: one node of the virtual DOM, or `null`, which renders nothing.
//     Every view function below returns it.
//   - `Document`: what the top-level `view` returns: the page title together
//     with the `Html` of the body.
//   - `HtmlBuilder<Message>`: the type of `h`. Explained at `view` below.
//   - `childAttributes`: wraps attributes that are handed to a child
//     component. Explained at `tuningPickerView`.
import {
  type Document,
  type Html,
  type HtmlBuilder,
  childAttributes,
} from 'foldkit/html'

// `@foldkit/ui` is Foldkit's library of headless components. Headless means
// they supply behaviour, keyboard handling and ARIA attributes, and no styles:
// the app writes the Tailwind classes. Two kinds are used here.
//   - Button, Input and Meter are stateless helpers. You call
//     `X.view(config, h)` with a `toView` callback, and the helper calls it
//     back with ready-made groups of attributes to spread onto your own
//     elements. They have no Model and no Messages of their own.
//   - Popover, and Listbox (which arrives as `TuningListbox` from main.ts),
//     are Submodels: components with their own Model, Messages and `update`.
//     Their state is kept in our Model and they are embedded with
//     `h.submodel`. See `tuningPickerView` and `settingsMenuView`.
import { Button, Input, Meter, Popover } from '@foldkit/ui'

// The other two pages. Each file exports a function called `view`, so they
// are imported as namespaces: `HowTo.view(h)`.
// The footer and the header, drawn under and over every page.
import * as Footer from './footer'
import * as Header from './header'
// The four icons. Each is a function from a class name to an inline SVG.
import * as Icon from './icon'
// The classes of the frame every screen is drawn in: the page ground, the
// `<main>` and the centred column. The crash screen (src/crash.ts) reads the
// same three, so it looks like the site without calling this file.
import { COLUMN_CLASS, MAIN_CLASS, PAGE_CLASS } from './layout'
// From main.ts: the `Model` this file reads, the `Message` constructors it
// attaches to elements, `TunerState` (the tagged union for booting, off,
// starting, listening and failed) and `TuningListbox` (the Listbox bound to our
// `Tuning` type). `IN_TUNE_CENTS` is the number in the tuner's rule for "in
// tune", kept in main.ts beside its other constants. The rule itself is
// under IN TUNE below.
import {
  IN_TUNE_CENTS,
  Message,
  type Model,
  TunerState,
  TuningListbox,
} from './main'
// Turns the kind of microphone failure held in the Model into the sentence
// shown to the person.
import { failureSentence } from './microphone'
import * as BuiltWith from './page/builtWith'
import * as HowTo from './page/howTo'
import { pageHeadingAttributes, textLink } from './page/link'
import * as NotFound from './page/notFound'
import * as Privacy from './page/privacy'
// Pure note arithmetic: the nearest note to a frequency, the frequency of a
// MIDI note, and a note's name. No Foldkit in there.
import {
  type Note,
  frequencyOfMidi,
  noteFromFrequency,
  noteName,
} from './pitch'
// The limits of the A4 field, and the parser that decides whether what was
// typed is a usable A4.
import { A4_MAX, A4_MIN, parseA4 } from './preferences'
// The routes: `AppRoute` to tell the pages apart, and `howToRouter` to build
// the path of the how-to page for the link to it.
import {
  AppRoute,
  builtWithRouter,
  howToRouter,
  privacyRouter,
  tunerRouter,
} from './route'
// The live site's address, for each page's canonical address.
import { SITE_ORIGIN } from './site'
// The list of tunings, two lookups (a tuning by its id, and the string of a
// tuning that is nearest to a note), and the key of a string chip.
import {
  TUNINGS,
  type Tuning,
  nearestString,
  stringKey,
  tuningById,
} from './tuning'

// CONSTANT

// The needle bar covers 50 cents either side of the note. A cent is a
// hundredth of a semitone, so 50 is halfway to the next note, and
// `noteFromFrequency` never reports more: past that, the next note is nearer.
const NEEDLE_RANGE_CENTS = 50
// The input level runs from 0 to 1. Multiplied by this, it is the width of the
// level bar's fill in per cent, so the loudest input fills half the bar, as
// it does in the original tuner.
const LEVEL_BAR_SCALE = 50
// A non-breaking space (U+00A0), shown in place of the note and of the detail
// line while nothing is heard. An ordinary space on its own would take up no
// room at all. This one is laid out like a letter, so the line keeps its box.
const NON_BREAKING_SPACE = ' '
// What the tuner says when a start has gone on for a while (`startHintView`).
// The usual cause is the browser's permission prompt, which the person may
// not have noticed. The app cannot be sure a prompt is open, hence "if":
// the same line shows when the audio itself is slow to start.
const WAITING_FOR_MICROPHONE =
  'Waiting for the microphone. If your browser is asking for permission, allow it.'

// DISPLAY

// This section is the "derive, do not store" step. `toDisplay` turns the Model
// into a flat record shaped for drawing, and the view functions read that
// record, not the Model's tagged union. The case analysis (booting, off, starting,
// listening, failed) then happens in one place and the markup below stays
// free of it. `Heard` and `Display` are plain TypeScript types. The fields of
// the Model must be Effect Schemas, but values derived from it need not be
// (FOLDKIT.md, "Project Conventions").

// What the tuner is hearing right now, when it hears a note at all.
//   frequency    the detected pitch in Hz, straight from the Model.
//   note         the nearest note (name, octave, MIDI number). Derived here
//                from the frequency and the A4 setting.
//   needleCents  how far the needle is from that note, in cents. From the
//                Model: `update` smooths it from reading to reading. Only
//                the needle marker's position reads it.
//   shownCents   derived: the needle as a whole number of cents, which is
//                the number the detail line prints (`wholeCents`).
//   isInTune     derived from `shownCents`: see IN TUNE below.
type Heard = Readonly<{
  frequency: number
  note: Note
  needleCents: number
  shownCents: number
  isInTune: boolean
}>

// IN TUNE
//
// One rule, in one place: the needle, rounded to a whole cent, is in tune
// when it is within `IN_TUNE_CENTS` of the note. It goes by the number as
// shown, on purpose. The detail line prints a whole number of cents and a
// word beside it, and the two must never disagree. Until 0.7.2 the word
// came from the needle before rounding, so a needle at 5.4 read "+5 cents ·
// sharp" while one at 5.0 read "+5 cents · in tune".
//
// Four things on the page say "in tune": the word in the detail line, the
// needle marker's colour, the lit string chip's colour, and the green zone
// of the needle bar. The first three read `isInTune` from the `Heard`
// record that `toDisplay` builds with the two functions below, and the
// zone is drawn from `IN_TUNE_EDGE_CENTS`. Nothing else in the file
// compares cents with `IN_TUNE_CENTS`. Keep it so: a second comparison
// written somewhere else is how the number and the word came apart.

// The needle as the detail line prints it: a whole number of cents. A half
// rounds away from zero on both sides (5.5 is 6 and -5.5 is -6), so sharp
// and flat are treated alike. `Math.round` alone rounds a half upwards,
// which would make -5.5 into -5, hence the detour through the magnitude.
//
// A needle that rounds to nothing gives plain zero, never negative zero.
// JavaScript has both, and `(-0.4).toFixed(0)` is the text "-0", which is
// what the detail line used to print for a needle a hair flat.
const wholeCents = (needleCents: number): number => {
  const magnitude = Math.round(Math.abs(needleCents))

  return needleCents < 0 && magnitude > 0 ? -magnitude : magnitude
}

// The rule itself, on the whole number from `wholeCents`.
const isWithinInTune = (shownCents: number): boolean =>
  Math.abs(shownCents) <= IN_TUNE_CENTS

// The same rule as a place on the needle bar. A needle rounds to
// `IN_TUNE_CENTS` or less until it reaches half a cent beyond it, so that
// is how far either side of the middle the green zone goes (`needleView`).
const IN_TUNE_EDGE_CENTS = IN_TUNE_CENTS + 0.5

// Everything the screen needs, whichever state the tuner is in.
// A name that starts with `maybe` holds an `Option`: that is the project's
// convention (FOLDKIT.md, "Code Style"). `maybeHeard` is None when no note is
// sounding, and `maybeFailure` is None unless the microphone failed.
//   isStarting      the button was pressed and the microphone is not open
//                   yet.
//   isStartingSlow  the same, and it has been so for more than 1.2 seconds
//                   (`isSlow` in the Model's `Starting` state). Never true
//                   unless `isStarting` is.
type Display = Readonly<{
  isBooting: boolean
  isListening: boolean
  isStarting: boolean
  isStartingSlow: boolean
  level: number
  maybeHeard: Option.Option<Heard>
  maybeFailure: Option.Option<string>
}>

// The display of a tuner that is off: nothing lit, nothing heard, no error.
// The other states are written as this record with their differences spread
// over it.
const quietDisplay: Display = {
  isBooting: false,
  isListening: false,
  isStarting: false,
  isStartingSlow: false,
  level: 0,
  maybeHeard: Option.none(),
  maybeFailure: Option.none(),
}

// Model -> Display.
//
// `TunerState` was declared in main.ts with Foldkit's `defineTaggedUnion`,
// which gives the union a `match` function: one handler per variant, each
// handed that variant's fields, and a compile error if a variant is left out.
// It does the job of `switch (state._tag)`, and a variant added to the union
// later cannot be forgotten here.
//
// Note what is worked out here and never kept in the Model: the note (from
// the frequency and `model.a4`, so a change of A4 renames the note on the next
// render with no extra code), `shownCents` and `isInTune`.
const toDisplay = (model: Model): Display =>
  TunerState.match(model.tuner, {
    // Drawn like Off, with one difference: the power button is disabled.
    Booting: () => ({ ...quietDisplay, isBooting: true }),
    Off: () => quietDisplay,
    // `attempt`, the other field of this state, is `update`'s business: the
    // view has no use for which start this is.
    Starting: ({ isSlow }) => ({
      ...quietDisplay,
      isStarting: true,
      isStartingSlow: isSlow,
    }),
    Listening: ({ level, maybeReading, needleCents }) => ({
      ...quietDisplay,
      isListening: true,
      level,
      // `Option.map(option, f)` applies `f` to the value if there is one and
      // passes None through untouched. So "no reading" becomes "nothing
      // heard" without an `if`.
      // `shownCents` and `isInTune` are worked out here, once, for
      // everything that draws from them (IN TUNE above).
      maybeHeard: Option.map(maybeReading, ({ frequency }) => {
        const shownCents = wholeCents(needleCents)

        return {
          frequency,
          note: noteFromFrequency(frequency, model.a4),
          needleCents,
          shownCents,
          isInTune: isWithinInTune(shownCents),
        }
      }),
    }),
    // The Model stores the kind of failure (refused, unsupported, unexpected)
    // and not a sentence, because `update` has to tell a refusal from a fault
    // to decide whether to report it. The wording is the view's business.
    // FINDINGS.md, "A caught failure is reported by a Command".
    Failed: ({ failure }) => ({
      ...quietDisplay,
      maybeFailure: Option.some(failureSentence(failure)),
    }),
  })

// The last word of the detail line. "In tune" wins. Otherwise the sign of
// the number shown decides: above the note is sharp, below it is flat. It
// reads the same whole number the line prints, never the needle itself, so
// the word cannot contradict the number beside it.
const tuningWord = ({ shownCents, isInTune }: Heard): string => {
  if (isInTune) {
    return 'in tune'
  } else if (shownCents > 0) {
    return 'sharp'
  } else {
    return 'flat'
  }
}

// The line under the note: the frequency, the cents and the word, joined by
// middle dots. The cents are `shownCents`, already a whole number. A
// negative number prints its own minus sign, so only the plus has to be
// added, and zero gets neither: "0 cents".
const detailLine = (heard: Heard): string => {
  const sign = heard.shownCents > 0 ? '+' : ''

  return `${heard.frequency.toFixed(1)} Hz · ${sign}${heard.shownCents} cents · ${tuningWord(heard)}`
}

// Where the needle marker sits, as a CSS `left` percentage. The cents are
// clamped to the bar's range and then shifted, so that -50 cents is 0%, 0 is
// 50% (the centre line) and +50 is 100%.
const needleLeft = (needleCents: number): string => {
  const clamped = Math.max(
    -NEEDLE_RANGE_CENTS,
    Math.min(NEEDLE_RANGE_CENTS, needleCents),
  )

  return `${NEEDLE_RANGE_CENTS + clamped}%`
}

// VIEW

// `view` is the function Foldkit calls to draw the page. `src/entry.ts` passes
// it to `Runtime.makeApplication({ ..., view })`, and the runtime calls it
// with two arguments.
//
//   model  the current Model, as `update` last returned it.
//   h      the Html builder. Everything on the page is made by calling
//          something on `h`:
//
//            h.div(attributes, children)   an element: one function per tag
//            h.Class('...')                an attribute: capitalised names
//            h.AriaLabel('...')
//            h.OnClick(message)            an event handler is an attribute too
//            h.empty                       nothing at all
//            h.keyed('li')(key, ...)       an element with a key
//            h.submodel({...})             an embedded child component
//
//          An element takes an array of attributes, then an optional array of
//          children. A child is more Html or a plain string, and a string
//          becomes a text node. With no children, leave the second array out:
//          `h.div([h.Class('...')])`.
//
// `h` has the type `HtmlBuilder<Message>`. The type parameter is the set of
// Messages its event handlers may carry, so a handler holding anything that is
// not one of our Messages does not compile. The runtime supplies the builder.
// Application code never constructs one, and a helper view function receives
// it as its last parameter (FOLDKIT.md, "View"), which is why every function
// below ends with `h: HtmlBuilder<Message>`.
//
// The return value is a `Document`, not bare Html, because an app made with
// `makeApplication` owns the whole page:
//
//   title  the runtime writes it to `document.title` after a render, if it
//          differs from the title showing. Here it changes with the page
//          (`pageTitle` below).
//   body   the Html of the page. Its root element, the outer <div>, is the
//          app's root in the document: the build writes it into the HTML
//          file, and the runtime patches it where it stands.
//
// `Document` also has optional `lang`, `dir`, `canonical` and `ogUrl` fields.
// They are left out here, and the runtime leaves alone what it is not given,
// so the `lang="en"` that src/entry.server.ts gives the document stays.
//
// The title is a function of the route, and so is the page: both are an
// exhaustive `AppRoute.match`, so a route added to src/route.ts stops this
// file compiling until it has a title and a page.

// The build writes each page's title into its HTML file from this, and the
// runtime keeps the tab's title in step as the page changes. The tuner's
// page carries the site's full name. The other pages put their own name
// first. `pageTitle` is exported for
// src/view.test.ts: a scene renders the body and cannot see the title.
/** The text of the browser tab for each page. */
export const pageTitle = (route: AppRoute): string =>
  AppRoute.match(route, {
    Tuner: () => 'OK Tuner | Chromatic Instrument Tuner',
    HowTo: () => 'How to use the tuner | OK Tuner',
    BuiltWith: () => 'Built with | OK Tuner',
    Privacy: () => 'Privacy | OK Tuner',
    NotFound: () => 'Page not found | OK Tuner',
  })

// One sentence about each page, for a search result and for the preview of
// a shared link. The view itself does not use it: a description is a tag
// in the document's head, which the build writes (src/entry.server.ts).
// It lives here, beside the title, so that a new page is given both.
/** The description of each page, as search engines and link previews show it. */
export const pageDescription = (route: AppRoute): string =>
  AppRoute.match(route, {
    Tuner: () =>
      'A free chromatic tuner that works in the browser, with no ads and nothing to install. For guitar, bass, ukulele and other stringed instruments.',
    HowTo: () =>
      'How to use OK Tuner: switch it on, play one string, and read the note, the needle and the nearest string of your tuning.',
    BuiltWith: () =>
      'What OK Tuner is made of: Foldkit, Effect, the Web Audio API and the rest, all of it open source.',
    Privacy: () =>
      'What OK Tuner does with data: the sound never leaves your device, there are no ads and no cookies, and visits are counted without identifying anyone.',
    NotFound: () => 'There is no page at this address.',
  })

// The canonical address of a page: the one address that search engines
// should list for it. It is always on the live site (`SITE_ORIGIN`), built
// from the same routers as the links, so it cannot drift from them.
//
// The not-found page has none, which is what `Option.none()` says: it is
// not a page with an address of its own, and it should never be listed.
// Foldkit's `Document` has a `canonical` field for this, and leaves the
// page without one when the view gives none.
/** The canonical address of a page, if it has one. */
export const canonicalOf = (route: AppRoute): Option.Option<string> =>
  AppRoute.match(route, {
    Tuner: () => Option.some(`${SITE_ORIGIN}${tunerRouter()}`),
    HowTo: () => Option.some(`${SITE_ORIGIN}${howToRouter()}`),
    BuiltWith: () => Option.some(`${SITE_ORIGIN}${builtWithRouter()}`),
    Privacy: () => Option.some(`${SITE_ORIGIN}${privacyRouter()}`),
    NotFound: () => Option.none(),
  })

// The body: a dark page ground (`bg-oxford-dark`, a colour defined in
// styles.css) holding three things, one above the other: the header with
// the brand, the `<main>` with the page the route names, and the footer.
// Each is one centred column, at most 600px wide. The header and the
// footer sit outside the `<main>`, which is what makes each a landmark of
// its own (src/header.ts, src/footer.ts). All three are the same on every
// page, so they are drawn here once.
//
// Every page draws its own `<h1>`, which names that page. The site's name
// is the brand in the header, not a heading.
//
// The outer `<div>` is a column as tall as the window (`flex min-h-screen
// flex-col`), and the `<main>` takes whatever height the footer leaves
// (`flex-1`), so the footer sits at the bottom of a short page. Those
// classes are the three constants of src/layout.ts.
//
// `Header.view([], h)`: the first argument is extra attributes for the
// brand link. A page needs none. The crash screen passes one
// (src/header.ts).
//
// Composition is a function call. There are no components to register and
// no props objects: a page, or a part of one, is a function that returns
// Html, given what it needs and the builder. `tunerPageView` needs the
// Model, and the other pages and the footer need nothing but the builder.
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: pageTitle(model.route),
  // The spread adds `canonical` when the page has one and nothing when it
  // has not. The runtime writes it to the page's `<link rel="canonical">`,
  // and the build writes it into the file, with an Open Graph address to
  // match (src/entry.server.ts).
  ...Option.match(canonicalOf(model.route), {
    onNone: () => ({}),
    onSome: canonical => ({ canonical }),
  }),
  body: h.div(
    [h.Class(PAGE_CLASS)],
    [
      Header.view([], h),
      h.main(
        [h.Class(MAIN_CLASS)],
        [
          h.div(
            [h.Class(COLUMN_CLASS)],
            [
              AppRoute.match(model.route, {
                Tuner: () => tunerPageView(model, h),
                HowTo: () => HowTo.view(h),
                BuiltWith: () => BuiltWith.view(h),
                Privacy: () => Privacy.view(h),
                NotFound: () => NotFound.view(h),
              }),
            ],
          ),
        ],
      ),
      Footer.view(h),
    ],
  ),
})

// The tuner's page: its heading, a line of introduction, the tuner, and a
// link to the how-to page. The how-to text itself was here until it moved
// to a page of its own, which keeps this page to the tuner.
//
// The heading is there and not shown. Every page has one `<h1>` that names
// it, for a screen reader's list of headings and as the place focus moves
// to when the page appears (`pageHeadingAttributes`). The home page needs
// no title above the tuner for someone looking at it, so the heading takes
// Tailwind's `sr-only` class: in the page, read out, and off screen.
//
// The link is an ordinary `<a>` (src/page/link.ts), and `howToRouter()`
// builds its path, `/how-to`.
const tunerPageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.h1([...pageHeadingAttributes(h), h.Class('sr-only')], ['Tuner']),
      h.p(
        [h.Class('mt-4 mb-8 text-slate-200')],
        [
          'A free chromatic tuner that works in the browser. For guitar, bass, ukulele and other stringed instruments.',
        ],
      ),
      tunerView(model, h),
      h.p(
        [h.Class('mt-6')],
        [textLink(howToRouter(), 'How to use the tuner', h)],
      ),
    ],
  )

// The grey pedal body and everything on it.
//
// This is where the Model becomes the two derived values that the rest of the
// view works from: `display` (the DISPLAY section) and `tuning`, the full
// record for the id held in the Model. `tuningById` falls back to standard
// guitar for an id it does not know.
//
// The children are listed in the order they appear on the pedal, top to
// bottom. Each view function is given only what it draws from, so its
// signature says what it depends on.
const tunerView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const display = toDisplay(model)
  const tuning = tuningById(model.tuningId)

  return h.section(
    [
      // An `aria-label` on a <section> makes it a named region, which
      // assistive technology can list and jump to.
      h.AriaLabel('Tuner'),
      // `relative` is what the absolutely positioned badge at the bottom
      // right is placed against. It has a side effect that explains the
      // z-index classes further down: see `tuningPickerView`.
      h.Class(
        'relative min-h-[380px] w-full max-w-[600px] rounded-md bg-slate-400 bg-linear-to-b from-slate-500/10 via-slate-500/60 to-slate-500/80 px-5 py-5 shadow-xl shadow-oxford-950',
      ),
    ],
    [
      screenView(display, h),
      stringsView(tuning, model.a4, display, h),
      controlsView(model, tuning, display, h),
      powerRowView(display, h),
      // The model badge. `pointer-events-none` and `select-none` make it part
      // of the casing: it cannot be clicked or selected.
      h.div(
        [
          h.Class(
            'pointer-events-none absolute right-3 bottom-3 text-[12px] font-semibold text-oxford uppercase opacity-90 select-none',
          ),
        ],
        ['OK Tuner 001'],
      ),
    ],
  )
}

// The dark screen.
//
// Three nested divs draw the bezel: a faint outer border, a black rim, and the
// screen itself. `pointer-events-none`: nothing on the screen is interactive.
// The screen is a one-column grid whose rows are, in order: the level bar with
// the power light, the note, the detail line, the needle and the scale. The
// rows whose content comes and goes have fixed heights, so nothing moves when
// a note appears or disappears.
const screenView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('rounded-[8px] border-2 border-blue-200/10')],
    [
      h.div(
        [h.Class('rounded-[7px] bg-black p-[2px]')],
        [
          h.div(
            [
              h.Class(
                'pointer-events-none relative grid h-[165px] place-items-center gap-1 rounded-md bg-oxford-900 bg-linear-to-br from-oxford-900 to-oxford-850 px-4 pt-2 pb-5',
              ),
            ],
            [
              h.div(
                [
                  h.Class(
                    'grid w-full grid-cols-[1fr_auto] items-center gap-3',
                  ),
                ],
                [levelView(display, h), powerLightView(display, h)],
              ),
              noteView(display, h),
              // The detail line. `tabular-nums` gives every digit the same
              // width, so the text does not shimmer as the numbers change.
              h.div(
                [
                  h.Class(
                    'h-[20px] font-mono text-[13px] tabular-nums opacity-85',
                  ),
                ],
                [
                  // `Option.match` is how an Option is read: one function for
                  // "nothing" and one for "something", both returning the
                  // same type. Here both return a string, which becomes the
                  // div's text. `onSome: detailLine` passes the function
                  // itself, since it already takes a `Heard`.
                  Option.match(display.maybeHeard, {
                    onNone: () => NON_BREAKING_SPACE,
                    onSome: detailLine,
                  }),
                ],
              ),
              needleView(display, h),
              scaleView(display, h),
            ],
          ),
        ],
      ),
    ],
  )

// The input level bar, built with `Meter` from `@foldkit/ui`.
//
// Meter is one of the stateless helpers: no Model, no Messages. Button and
// Input further down work the same way, in four steps:
//
//   1. We call `Meter.view(config, h)`, passing our own builder `h`.
//   2. Meter works out the attributes that make the element accessible.
//   3. It calls our `toView` with those attributes, in named groups.
//   4. We return whatever markup we like, spreading each group onto the
//      element it is meant for and adding our classes.
//
// What Meter provides, in the `attributes.meter` group: `role="meter"`,
// `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` (the value,
// clamped to that range), the `aria-label`, the element's id, and
// `data-value`, `data-min` and `data-max` as hooks for styling. A screen
// reader gets a meter named "Input level" with a value.
// What the app provides: the two divs and their classes.
//
// Meter also offers a `fill` group (an inline width that matches the value)
// and a `label` group (an id for a visible label). Neither is used. The
// fill's width is set by hand so the bar can have its own scale, and there is
// no visible label, which is why `ariaLabel` is passed.
const levelView = (display: Display, h: HtmlBuilder<Message>): Html =>
  Meter.view(
    {
      // Becomes the id of the element that gets the `meter` group.
      id: 'input-level',
      ariaLabel: 'Input level',
      // Meter's range is 0 to 100 unless told otherwise, so the level (0 to
      // 1) is scaled and rounded to a whole per cent.
      value: Math.round(display.level * 100),
      toView: attributes =>
        h.div(
          [
            // The component's attributes first, then our own. When the same
            // attribute is given twice on one element, the later one replaces
            // the earlier, so what follows the spread can override the
            // component. (Event handlers are the exception: all of them run.)
            ...attributes.meter,
            h.Class('h-1 w-full overflow-hidden rounded-lg'),
          ],
          [
            h.div([
              h.Class('h-full rounded bg-blue-100/60'),
              // `h.Style` takes an object of CSS properties and sets them
              // inline. That is the tool for a value that varies
              // continuously: Tailwind cannot generate a class for a width
              // that is only known while the page is running.
              h.Style({ width: `${display.level * LEVEL_BAR_SCALE}%` }),
            ]),
          ],
        ),
    },
    h,
  )

// The power light: green while listening.
//
// The template string chooses between two complete class names. Tailwind
// finds the classes it must generate by scanning the source files as plain
// text, so every name has to appear whole: a name assembled from pieces, such
// as `bg-${colour}-400`, would never be generated. The same pattern recurs in
// most functions below.
//
// `h.div([...])` with no second argument is an element with no children.
const powerLightView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div([
    h.Class(
      `h-3 w-3 rounded-full ${display.isListening ? 'bg-green-400' : 'bg-oxford-800'}`,
    ),
  ])

// The big note name and its octave.
//
// `aria-live="polite"` makes this element a live region: when its text
// changes, a screen reader reads the new text out once it has finished what
// it was saying. That is how someone who cannot see the screen hears which
// note they are playing. `aria-atomic="true"` makes it read the whole region
// ("A 2") and not only the part that changed, so a change of octave is not
// announced as a bare "3".
// Only the note is live. The detail line under it changes with every reading
// and is ordinary text: it can be read, but it is not announced.
//
// `h.AriaLive` takes the attribute's string value. `h.AriaAtomic` takes a
// boolean and writes it as "true" or "false".
//
// The note keeps its blue-white colour when in tune, on purpose: FINDINGS.md,
// "The note name stays blue-white when in tune".
const noteView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.AriaLive('polite'),
      h.AriaAtomic(true),
      h.Class('h-[56px] text-[56px] leading-none tabular-nums'),
    ],
    // Here `Option.match` produces the whole array of children: a dimmed
    // non-breaking space when nothing is heard, or two spans, the note name
    // and a smaller octave number. Children are Html or strings, so the
    // octave, a number, is turned into a string first.
    Option.match(display.maybeHeard, {
      onNone: () => [h.span([h.Class('opacity-30')], [NON_BREAKING_SPACE])],
      onSome: ({ note }) => [
        h.span([h.Class('inline-block text-blue-100 opacity-95')], [note.name]),
        h.span(
          [h.Class('ml-1 inline-block text-[24px] text-blue-100 opacity-90')],
          [`${note.octave}`],
        ),
      ],
    }),
  )

// The needle bar: a track, a centre line, a green "in tune" zone, and the
// needle marker.
//
// `aria-hidden="true"` takes the whole bar out of the accessibility tree. It
// is a picture of what the detail line already says in words.
//
// The bar is 100 cents wide (50 either side), so one per cent of its width is
// one cent. The green zone is every place where the needle reads in tune:
// `IN_TUNE_EDGE_CENTS` either side of the centre, which is 5.5, so it starts
// at 44.5% and is 11% wide. It is set with an inline style, worked out from
// that constant, so that the picture follows the rule if the rule changes.
// A Tailwind class could not: a class name has to be written out whole.
// While the tuner is not listening, the track and the centre line are dimmed
// and the zone is fully transparent.
const needleView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.AriaHidden(true),
      h.Class(
        `relative mt-2 h-3 w-full max-w-sm rounded ${display.isListening ? 'bg-blue-300/10' : 'bg-blue-300/5'}`,
      ),
    ],
    [
      h.div([
        h.Class(
          `absolute inset-y-0 left-1/2 w-px ${display.isListening ? 'bg-white/40' : 'bg-white/10'}`,
        ),
      ]),
      h.div([
        // For the tests, like the marker's attribute below.
        h.DataAttribute('in-tune-zone', ''),
        h.Class(
          `absolute inset-y-0 rounded ${display.isListening ? 'bg-green-400/15' : 'bg-green-400/0'}`,
        ),
        h.Style({
          left: `${NEEDLE_RANGE_CENTS - IN_TUNE_EDGE_CENTS}%`,
          width: `${2 * IN_TUNE_EDGE_CENTS}%`,
        }),
      ]),
      // The marker exists only while a note is heard. `h.empty` is Foldkit's
      // "render nothing": it is `null`, and the builder drops it from the
      // list of children. Use it wherever a template language would use an
      // `{#if}` block with no `{:else}`.
      //
      // No key is needed for an element that comes and goes like this. Keys
      // are for mapped lists only: see `stringView`.
      Option.match(display.maybeHeard, {
        onNone: () => h.empty,
        onSome: ({ needleCents, isInTune }) =>
          h.div([
            // Writes `data-needle-marker=""`. It is there for the tests: a
            // bare div has no role or label, so scene.test.ts finds the
            // marker with `selector('[data-needle-marker]')`.
            h.DataAttribute('needle-marker', ''),
            // Colour has two states, so it is a class (green in tune,
            // `maximum-yellow` from styles.css otherwise). Position is
            // continuous, so it is an inline style.
            h.Class(
              `absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded ${isInTune ? 'bg-green-300' : 'bg-maximum-yellow'}`,
            ),
            h.Style({ left: needleLeft(needleCents) }),
          ]),
      }),
    ],
  )

// The numbers under the bar, hidden from assistive technology like the bar.
//
// `h.span([], ['0'])`: attributes always come first, so an element with
// children and no attributes still takes an empty attribute array.
const scaleView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.AriaHidden(true),
      h.Class(
        `flex h-[15px] w-full max-w-sm justify-between font-mono text-[10px] ${display.isListening ? 'opacity-90' : 'opacity-20'}`,
      ),
    ],
    [h.span([], ['−50']), h.span([], ['0']), h.span([], ['+50'])],
  )

// The row of string chips: one per string of the chosen tuning, with the
// string nearest to the note being played lit up.
//
// Two more values are derived here and not stored:
//
//   maybeNearestString  `Option.flatMap` chains two steps that may each come
//                       up empty. There may be no note, and `nearestString`
//                       returns None for a tuning with no strings
//                       (Chromatic). The result is Some only when both are.
//   isInTune            `Option.exists(option, test)` is true only when there
//                       is a value and it passes the test. No note means not
//                       in tune.
const stringsView = (
  tuning: Tuning,
  a4: number,
  display: Display,
  h: HtmlBuilder<Message>,
): Html => {
  const maybeNearestString = Option.flatMap(display.maybeHeard, ({ note }) =>
    nearestString(tuning, note.midi),
  )
  const isInTune = Option.exists(display.maybeHeard, heard => heard.isInTune)

  return h.div(
    // The wrapper keeps its minimum height when there are no chips, so the
    // controls below do not move when Chromatic is chosen.
    [h.Class('min-h-[42px] text-[13px] text-white/60 select-none')],
    [
      // `Array.match` is to a list what `Option.match` is to an Option: one
      // branch for an empty array and one for a non-empty one. FOLDKIT.md
      // asks for it wherever a list may be empty. Chromatic has no strings
      // and renders nothing.
      Array.match(tuning.notes, {
        onEmpty: () => h.empty,
        onNonEmpty: notes =>
          h.ul(
            [
              // A <ul> is a list already. But Tailwind's reset removes list
              // bullets, and Safari with VoiceOver stops announcing a <ul>
              // without bullets as a list. The explicit role puts that back.
              h.Role('list'),
              // Names the list. The tests also use it, to count the chips
              // without counting the how-to list as well
              // (`[aria-label="Strings"] li`; FINDINGS.md, "Scope a locator
              // to the part of the page it is about").
              h.AriaLabel('Strings'),
              h.Class('mt-3 flex flex-wrap items-center justify-center gap-2'),
            ],
            // Effect's `Array.map(array, f)`, array first. Like the native
            // `map`, it hands `f` the item's position as well, which
            // `stringKey` needs: see `stringView`.
            // `Option.contains(option, value)` is true when the Option holds
            // exactly that value: is this string the nearest one? Two
            // strings on one note would both be lit, which is as much as a
            // tuner can know.
            Array.map(notes, (midi, position) =>
              stringView(
                stringKey(tuning, position),
                midi,
                a4,
                Option.contains(maybeNearestString, midi),
                isInTune,
                display.isListening,
                h,
              ),
            ),
          ),
      }),
    ],
  )
}

// The border and text colour of a chip: dim when it is not the nearest
// string, green when it is and the note is in tune, and yellow (`accent`,
// defined in styles.css) when it is the nearest but not yet in tune.
const stringChipTone = (isNearest: boolean, isInTune: boolean): string => {
  if (!isNearest) {
    return 'border-white/10 text-blue-100/60'
  } else if (isInTune) {
    return 'border-green-400 text-green-400'
  } else {
    return 'border-accent text-accent'
  }
}

// One string chip.
//
// `h.keyed('li')(key, attributes, children)` is the keyed form of `h.li`. A
// key tells the runtime which DOM element belongs to which item of a list, so
// that when the list changes it keeps, moves or replaces the right elements
// and does not simply match old and new items by position. Foldkit's rule
// (FOLDKIT.md, "View") is to key the items of a mapped list by a stable
// identifier, and to key nothing else. Markup that comes and goes, like the
// needle marker above, needs no key, because the build (the Foldkit Vite
// plugin) gives the output of each view function an identity of its own.
//
// The key comes from `stringKey` in src/tuning.ts: the tuning's id and the
// string's place in that tuning, such as `banjo-0`. It is not the note. A
// note is what the chip displays, and two strings of one tuning may be tuned
// to the same note, which would put two chips with one key in the same row.
// `stringKey` has the reasoning in full.
const stringView = (
  key: string,
  midi: number,
  a4: number,
  isNearest: boolean,
  isInTune: boolean,
  isListening: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    key,
    [
      h.Class('rounded-[5px] border border-blue-300/10'),
      // `aria-current="true"` marks the chip nearest to the note being
      // played. The lit colour says so to the eye. The attribute says so to
      // assistive technology, and gives the tests something to look for
      // (`[aria-current="true"]`).
      // Spreading an array that is either empty or holds one attribute is the
      // usual way to make an attribute conditional.
      ...(isNearest ? [h.AriaCurrent('true')] : []),
    ],
    [
      h.span(
        [
          // The native tooltip: the frequency this string should have at the
          // current A4. One more derived value.
          h.Title(`${frequencyOfMidi(midi, a4).toFixed(2)} Hz`),
          h.Class(
            `block rounded border bg-oxford-900 px-3 py-1 font-mono text-[14px] tabular-nums shadow-inner ${stringChipTone(isNearest, isInTune)}`,
          ),
        ],
        [
          // The letter fades almost out while the tuner is not listening. The
          // chip itself stays, so the row keeps its shape.
          h.span(
            [h.Class(isListening ? 'opacity-100' : 'opacity-10')],
            [noteName(midi)],
          ),
        ],
      ),
    ],
  )

// The row with the two controls. It is a two-column grid: the tuning picker
// takes the width that is left (`1fr`) and the settings button its own width
// (`auto`). `min-w-0` lets the picker's cell become narrower than its own
// text, so a long tuning name is cut short with an ellipsis (`truncate`, in
// `tuningPickerView`) and does not push the row wider.
// The border divs are the same thin bezel as round the screen.
const controlsView = (
  model: Model,
  tuning: Tuning,
  display: Display,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'mt-5 grid grid-cols-[1fr_auto] place-content-center gap-3 text-[15px]',
      ),
    ],
    [
      h.div(
        [h.Class('min-w-0 rounded-[7px] border border-blue-200/10')],
        [tuningPickerView(model, tuning, display, h)],
      ),
      h.div(
        [h.Class('rounded-[7px] border border-blue-200/10')],
        [settingsMenuView(model, display, h)],
      ),
    ],
  )

// The tuning picker: a `@foldkit/ui` Listbox, embedded as a Submodel.
//
// A Submodel is a component with its own Model, Messages and `update`. It is
// Foldkit's answer to "this widget has state of its own": is the list open,
// which item is highlighted, what has been typed to search. That state is not
// hidden inside a component instance. The Listbox's Model is a field of our
// Model, and its Messages pass through our `update`, so the open list shows in
// the devtools and can be tested like everything else. Wiring one in takes
// four pieces, and this function is the last:
//
//   main.ts, Model    tuningListbox: Listbox.Model
//   main.ts, Message  GotTuningListboxMessage: { message: Listbox.Message }
//   main.ts, update   `foldTuningListbox` hands the inner message to the
//                     Listbox's own update and stores the Model it returns
//   here              `h.submodel({...})` draws it, and says how its Messages
//                     are wrapped
//
// What `h.submodel` is given:
//
//   slotId           a name for this place in the page, which must differ
//                    from the slotId of every other submodel in this view.
//                    The Listbox's own id is used ('tuning', given to
//                    `Listbox.init` in main.ts).
//   model            the child's Model, taken out of ours.
//   view             the child's view function. `TuningListbox` is
//                    `Listbox.create<Tuning>()` from main.ts: the Listbox's
//                    view and update bound to our item type, so that `items`,
//                    `itemToConfig` and the selected value are all checked
//                    against `Tuning`.
//   viewInputs       what the child needs from us on each render. See the
//                    comments on each field below.
//   toParentMessage  how a Listbox Message becomes one of ours. When someone
//                    clicks an option, the Listbox's handler produces a
//                    `Listbox.Message`. The runtime passes it through this
//                    function, so what `update` receives is
//                    `GotTuningListboxMessage({ message })`. `Got...Message`
//                    is Foldkit's naming convention for these wrappers.
//
// Who owns what. The Listbox owns the interaction: opening and closing, the
// arrow keys, Home and End, typing to search, Enter or Space to choose, Escape,
// a click outside, moving focus into the list and back to the button, and the
// ARIA wiring (`aria-haspopup="listbox"` and `aria-expanded` on the button,
// `role="listbox"` on the panel, `role="option"` and `aria-selected` on each
// item). It also renders the elements itself: a wrapper, the button, the
// panel, the items and a backdrop.
// The app owns the selection and the looks. Which tuning is chosen lives in
// `model.tuningId`, not in the Listbox. We pass it in as
// `maybeSelectedValue`. When the person picks an item, the Listbox's update
// reports a `Selected` OutMessage (a fact a child hands up to its parent), and
// our `update` stores the new id and saves it: `foldTuningListboxOutMessage`
// in main.ts.
const tuningPickerView = (
  model: Model,
  tuning: Tuning,
  display: Display,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.tuningListbox.id,
    model: model.tuningListbox,
    view: TuningListbox.view,
    viewInputs: {
      // Sets `aria-label` on the button, which names the control for
      // assistive technology. The tests find the picker by this name.
      ariaLabel: 'Tuning',
      // Where the open list goes. The Listbox positions the panel against
      // the button with Floating UI. `placement` asks for it below the
      // button with the left edges in line, `gap` is the space between them
      // in pixels, and `padding` is how close to the edge of the window the
      // panel may come before it is flipped to the other side or shifted.
      // The flip is what shows all eleven tunings in a window of ordinary
      // height: under the button there is often too little room, and above
      // it there is enough. See the note at `itemsAttributes` below.
      anchor: { placement: 'bottom-start', gap: 4, padding: 8 },
      // The options, and how to get from an option to the string that
      // identifies it. The items are whole `Tuning` records and the values
      // are their ids. `itemToValue` is required when items are objects.
      items: TUNINGS,
      itemToValue: item => item.id,
      // The current selection, from our Model. It is an Option because a
      // Listbox may have nothing selected. Ours always has a tuning.
      maybeSelectedValue: Option.some(model.tuningId),
      // The controls work only while the tuner is listening, as in the
      // original. A disabled Listbox marks its button `aria-disabled="true"`
      // and `data-disabled` and leaves the handlers off, so it cannot open.
      isDisabled: !display.isListening,
      // Called once for each option. The Listbox renders the option's element
      // (with its role, id, `aria-selected` and click handler). We return
      // the classes for that element and the Html to put inside it. The
      // second argument describes the option's state: `isSelected` (it is
      // the current tuning), `isActive` (the keyboard or pointer is on it),
      // `isDisabled` and `isReadOnly`.
      // The Listbox also puts a `data-active` attribute on the active option,
      // which the Tailwind variant `data-[active]:` matches. So the highlight
      // follows the arrow keys with no code here.
      itemToConfig: (item, { isSelected }) => ({
        className: `flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-blue-300/10 data-[active]:bg-blue-300/10 ${isSelected ? 'bg-white/10 font-semibold' : ''}`,
        content: h.span([h.Class('min-w-0 grow truncate')], [item.label]),
      }),
      // What goes inside the button: the label of the chosen tuning, and a
      // caret from icon.ts.
      buttonContent: h.span(
        [h.Class('flex w-full items-center gap-2')],
        [
          h.span([h.Class('min-w-0 grow truncate')], [tuning.label]),
          Icon.caretDown('h-3 w-3 shrink-0 opacity-70'),
        ],
      ),
      // Extra attributes for three of the elements the Listbox renders: the
      // button, the panel that holds the options, and the backdrop (an
      // invisible element behind the open list; a click on it closes the
      // list). Only classes are passed.
      //
      // These options are declared as arrays of `ChildAttribute`, and
      // `childAttributes([...])` is what makes one out of ordinary
      // attributes. It stamps each attribute with the dispatcher of the place
      // it was created in, so that a handler inside it still sends its
      // Message through the right component when the attribute ends up on an
      // element built somewhere else. That matters in the other direction,
      // when a child hands handlers to its parent: see `settingsMenuView`.
      // These carry no handlers, so here it is only the wrapper the type
      // asks for. Foldkit's own Listbox demos pass classes the same way.
      buttonAttributes: childAttributes([
        h.Class(
          `flex w-full items-center gap-2 rounded-md bg-oxford-dark px-4 py-2 text-left ${display.isListening ? 'cursor-pointer text-blue-100/80' : 'text-blue-100/5'}`,
        ),
      ]),
      // The panel's classes. Three of them need explaining.
      //
      // `w-(--button-width)` is Tailwind 4's shorthand for
      // `width: var(--button-width)`. The Listbox's positioning code measures
      // the button and writes its width to that custom property on the
      // panel, so the list is always as wide as the button.
      //
      // `z-20`, with `z-10` on the backdrop below. When the list opens, the
      // Listbox moves the panel and the backdrop out of the tuner and into a
      // `#foldkit-portal-root` element that it adds as the first child of
      // <body>. (This is a "portal". It stops an ancestor's overflow or
      // stacking from clipping the list.) That puts them before the app in
      // the document. The tuner body is `relative`, and positioned elements
      // with no z-index are painted in document order, so the tuner body
      // would be painted over the list. `z-20` lifts the panel above it.
      // `z-10` lifts the backdrop above the tuner body as well, so that a
      // click anywhere on the tuner lands on the backdrop and closes the
      // list. The panel, at 20, stays above the backdrop. FINDINGS.md, "An
      // open list or menu hides behind the tuner body without a z-index".
      //
      // There is no height class and no overflow class, on purpose. The
      // positioning code measures the list at its full height, opens it
      // above the button when it does not fit below (the `padding` of
      // `anchor` is the margin it keeps), and then sets `max-height` (the
      // room left on the side it chose) and `overflow-y: auto` as inline
      // styles on the panel. So the list scrolls only in a window too short
      // to hold it on either side.
      // NOTE: a `max-h-...` class here looks harmless, since the inline
      // style overrides it, and is not. On the first measurement there is
      // no inline style yet, so the class makes the list look short enough
      // to fit below, and it stays below and scrolls with room to spare
      // above. `max-h-64` did that until 0.7.2 (FINDINGS.md, "A height
      // class on the open list stopped it opening upwards").
      //
      // `scroll-cue` is this project's own utility (src/styles.css). In
      // that too-short window it draws a soft dark edge at the top or the
      // bottom of the list while there are more tunings that way, which is
      // the only sign of it where the system hides scrollbars.
      itemsAttributes: childAttributes([
        h.Class(
          'scroll-cue z-20 w-(--button-width) rounded bg-oxford pt-1 pb-3 text-[15px] text-blue-100/90 shadow-lg shadow-oxford-950',
        ),
      ]),
      // `fixed inset-0` stretches the backdrop over the whole window.
      backdropAttributes: childAttributes([h.Class('fixed inset-0 z-10')]),
    },
    // `message` here is a `Listbox.Message`. The result is one of ours.
    toParentMessage: message => Message.GotTuningListboxMessage({ message }),
  })

// The three-dot settings menu: a `@foldkit/ui` Popover that holds the A4
// field.
//
// Popover is a Submodel like the Listbox and is wired the same way:
// `a4Popover` in the Model, `GotA4PopoverMessage`, and `foldA4Popover` in
// main.ts. The difference is in who renders. The Listbox renders its own
// elements and asks us for classes. The Popover renders nothing: it calls our
// `toView` with bundles of attributes and we write every element, as with
// Meter's `toView`.
//
// What `toView` receives:
//
//   button     for the trigger: its id, `aria-expanded`, `aria-controls`
//              while open, the `aria-label`, and the pointer, keyboard and
//              click handlers that open and close. With `isDisabled` the
//              handlers are left off and the button gets
//              `aria-disabled="true"` and `data-disabled`.
//   panel      for the floating panel: its id, `tabindex="0"` so that it can
//              take focus, a handler that closes on Escape, a handler that
//              closes when focus leaves the panel, and a Mount (below).
//   backdrop   for an element behind the panel: a click handler that closes
//              the menu, and a Mount.
//   isVisible  whether to render the panel and the backdrop at all.
//
// (A fourth bundle, `arrow`, is for an optional pointer on the panel. It is
// not used.)
//
// These bundles are `ChildAttribute`s. The Popover made them inside its own
// view with `childAttributes`, so although we spread them onto elements that
// we create, their handlers still produce Popover Messages, which reach
// `update` wrapped by `toParentMessage` as `GotA4PopoverMessage`. Our own
// attributes on the same elements, such as `h.Class`, are ordinary ones.
//
// Mounts. A Mount is Foldkit's way to run code against a real DOM element for
// as long as that element is in the page: it starts when the element is
// inserted, and its clean-up runs when the element is removed. The view stays
// a pure description, and the Mount travels as an attribute (`h.OnMount`)
// inside the bundle. The panel's Mount positions the panel against the button
// with Floating UI, moves it into the portal root, and focuses it once it is
// in place. The backdrop's Mount moves the backdrop into the portal root. Each
// Mount reports back with a Message (`CompletedAnchorPopover`,
// `CompletedPortalPopoverBackdrop`), which is why scene.test.ts has
// `Mount.resolve(...)` steps for an open menu (FINDINGS.md, "Scene's
// `Mount.resolve` takes the child component's own Message"). The Listbox does
// the same for its panel and backdrop.
//
// `toView` is our function and uses our builder. Foldkit runs a function
// placed at the top level of `viewInputs` in the parent's context, not the
// child's. So `a4FieldView(model, h)` inside the panel is ordinary app markup:
// typing in the field sends `UpdatedA4Input` straight to `update`, with no
// Popover wrapper round it.
//
// What closing does to the field is decided in main.ts: the Popover reports a
// `Closed` OutMessage, and `update` puts the applied A4 back in the field.
const settingsMenuView = (
  model: Model,
  display: Display,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.a4Popover.id,
    model: model.a4Popover,
    view: Popover.view,
    viewInputs: {
      // The button shows only an icon, so this is its whole accessible name.
      // The Popover puts it in the `button` bundle as an `aria-label`.
      ariaLabel: 'Tuner settings',
      // Below the button, with the right edges in line. The fields mean the
      // same as for the Listbox. Popover requires `anchor`.
      anchor: { placement: 'bottom-end', gap: 4, padding: 8 },
      isDisabled: !display.isListening,
      // Receives the bundles and returns the markup. The outer div is a
      // positioned wrapper round the button, as in Foldkit's own Popover
      // examples.
      toView: ({ button, panel, backdrop, isVisible }) =>
        h.div(
          [h.Class('relative')],
          [
            // A plain <button> element: the Popover's bundle already carries
            // `type="button"` and the handlers, so `Button.view` is not
            // needed. The spread comes first and our class after it.
            h.button(
              [
                ...button,
                h.Class(
                  `grid h-[38px] place-items-center rounded-md bg-oxford-dark px-3 py-2 leading-none ${display.isListening ? 'cursor-pointer text-blue-100/80' : 'text-blue-100/10'}`,
                ),
              ],
              [Icon.dotsThreeVertical('h-4 w-4')],
            ),
            // The backdrop and the panel are in the page only while the menu
            // is open. Spreading an array that may be empty adds zero or two
            // children. Their Mounts start when these elements are inserted
            // and are cleaned up when they are removed.
            // The z-index classes are there for the same reason as on the
            // tuning list: see `tuningPickerView`.
            ...(isVisible
              ? [
                  h.div([...backdrop, h.Class('fixed inset-0 z-10')]),
                  h.div(
                    [
                      ...panel,
                      h.Class(
                        'z-20 w-56 rounded-md bg-oxford px-4 pt-3 pb-4 text-blue-100/90 shadow-lg shadow-oxford-950',
                      ),
                    ],
                    [a4FieldView(model, h)],
                  ),
                ]
              : []),
          ],
        ),
    },
    // `message` here is a `Popover.Message`. The result is one of ours.
    toParentMessage: message => Message.GotA4PopoverMessage({ message }),
  })

// The A4 field inside the settings menu, built with `Input` from
// `@foldkit/ui`: a stateless helper, used the same way as Meter.
//
// What Input provides:
//   attributes.label  `for="a4-input"`, which ties the <label> to the field.
//                     A click on the label focuses the field, and the label's
//                     text is the field's accessible name. The tests find the
//                     field by it: `label('A4 (Hz)')`.
//   attributes.input  the id, the `type`, the `value`, the input handler, and,
//                     when `isInvalid` is true, `aria-invalid="true"` and
//                     `data-invalid`.
// What the app provides: the elements, the classes, and the `min`, `max` and
// `step` of a number field.
//
// This is a controlled input, and the place to see the whole loop in small:
//
//   1. The field shows `model.a4Input`, the text as typed.
//   2. A keystroke fires the browser's `input` event. Input's handler calls
//      our `onInput` with the field's new text, and the runtime dispatches
//      the Message it returns: `UpdatedA4Input({ value })`.
//   3. `update` stores the text in `a4Input`. If the text is a usable A4
//      that differs from the current one, it also sets `a4` and saves it
//      (`applyA4Input` in main.ts).
//   4. The view runs again and the field shows the new `a4Input`.
//
// The Model keeps two fields because they can differ: `a4Input` is what has
// been typed, which may be empty or out of range, and `a4` is the last value
// that was applied. Whether the text is invalid is not stored at all. It is
// derived below, by parsing the text again. The design covers the behaviour
// under "Controls".
const a4FieldView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Input.view(
    {
      // The id of the <input>, and what the label's `for` points at.
      id: 'a4-input',
      type: 'number',
      value: model.a4Input,
      // `parseA4` returns an Option: Some(number) for a number from 400 to
      // 480, None otherwise. `Option.isNone` asks only "is it empty?".
      isInvalid: Option.isNone(parseA4(model.a4Input)),
      // A function from the field's text to a Message. Compare Button's
      // `onClick` below, which is a Message and not a function: a click has
      // no value to carry.
      onInput: value => Message.UpdatedA4Input({ value }),
      toView: attributes =>
        h.div(
          [h.Class('grid grid-cols-[auto_1fr] items-center gap-2 text-[13px]')],
          [
            h.label(
              [...attributes.label, h.Class('whitespace-nowrap')],
              ['A4 (Hz)'],
            ),
            // <input> is a void element, so `h.input` takes attributes only.
            // `h.Min`, `h.Max` and `h.Step` take strings, hence the template
            // strings round the numeric limits.
            // `data-[invalid]:border-red-400` is a Tailwind variant that
            // applies while the element has the `data-invalid` attribute,
            // which Input adds when `isInvalid` is true. A headless
            // component reports its state through attributes like this, and
            // the app decides what the state looks like.
            h.input([
              ...attributes.input,
              h.Min(`${A4_MIN}`),
              h.Max(`${A4_MAX}`),
              h.Step('1'),
              h.Class(
                'h-8 w-full rounded-md border border-blue-100/20 bg-blue-300/5 px-3 py-1 text-[15px] tabular-nums data-[invalid]:border-red-400',
              ),
            ]),
          ],
        ),
    },
    h,
  )

// The foot of the pedal: the On / Off button, and the room where the tuner
// says in words what it is waiting for or what went wrong.
//
// The room is always there, whether or not there is anything to say. That
// is the point of this function. A line that took its room only when it
// appeared made the pedal taller, by 52 pixels on a desktop and up to 92 on
// a phone, and pushed everything under the tuner down and back up again
// (FINDINGS.md, "A line that comes and goes must have its room kept").
//
// Where the room is depends on the width, because a wide pedal has spare
// room and a narrow one has none:
//
//   - From 640 pixels up (`sm:`, Tailwind's first breakpoint) the button
//     and the line share one row (`sm:flex-row`), the line to the right of
//     the button and centred on it (`sm:items-center`). The row is as tall
//     as two lines of text, which is the button's own height, so keeping
//     the room costs the pedal nothing.
//   - Below that the line goes under the button (`flex-col`), in a block
//     three lines tall. A phone's pedal is that much taller, always.
//
// `pb-3` is for the badge, which sits in the pedal's bottom right corner,
// out of the flow (`absolute`, in `tunerView`). With the pedal's own
// padding it keeps the last line of text above the badge's lettering, so a
// line may run the full width.
const powerRowView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        'mt-5 flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:gap-4',
      ),
    ],
    [powerButtonView(display, h), messagesView(display, h)],
  )

// The room itself: a block that holds the waiting line and the failure
// line, and is as tall with neither as with either.
//
// `min-h-[60px]` is three lines of `text-sm`, whose line is 20 pixels tall,
// and `sm:min-h-[40px]` is two. Those are what the longest of the app's own
// sentences needs (`BUSY` in src/microphone.ts) at 375 pixels and at 640.
// Measured in headless Chrome. Two things can still outgrow the room, and
// then the pedal grows as it used to: a long message from the browser
// itself (an `Unexpected` failure shows it as it came), and the longest
// sentence on a pedal narrower than a 375 pixel phone's.
//
// `sm:flex sm:flex-col sm:justify-center` centres the line in the block
// beside the button. On a phone the line starts at the top of the block,
// just under the button.
//
// `data-tuner-messages` is for the tests: an empty block has no role, name
// or text to be found by.
//
// The two lines are never on the page together: one belongs to `Starting`
// and the other to `Failed` (`toDisplay`).
const messagesView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.DataAttribute('tuner-messages', ''),
      h.Class(
        'min-h-[60px] text-sm sm:flex sm:min-h-[40px] sm:flex-col sm:justify-center',
      ),
    ],
    [startHintView(display, h), failureView(display, h)],
  )

// The On / Off button, built with `Button` from `@foldkit/ui`: the third
// stateless helper.
//
// What Button provides, in `attributes.button`: `type="button"`,
// `tabindex="0"`, and a click handler that dispatches the `onClick` Message.
// When `isDisabled` is true it leaves the click handler off and adds
// `aria-disabled="true"` and `data-disabled`. It does not use the native
// `disabled` attribute, so a disabled button can still be reached with the
// keyboard and is still announced by a screen reader.
// What the app provides: the element, its content, its classes, and the two
// ARIA states that only the app knows about.
//
// A disabled button must not look pressable. Because Button leaves the
// native `disabled` attribute off, the browser does nothing about that by
// itself: the pointer still becomes a hand over the button if the classes
// say so, and a `hover:` class still applies. So the cursor and the hover
// colour are chosen here, by `powerButtonLook`, from the state.
//
// Before the app is running the button is drawn disabled and dimmed. The
// page is prerendered, so this view is also what the build writes into the
// HTML file, and a browser shows that file before the script has loaded. A
// press then could do nothing. The tuner's first state is `Booting`, and it
// moves to `Off` with the first Message the running app sends itself
// (`TunerState` in src/main.ts), so the button comes alive the moment a
// press can be heard. On a fast connection that is before the page is first
// painted, and nobody sees the dimmed state.
//
// This is the one place in the file where a click becomes a Message of ours
// directly. `Message.ClickedPower()` builds the Message value while the view
// runs. Nothing is sent then. The value is kept with the click handler, and
// the runtime dispatches it to `update` when the button is clicked. The name
// says what happened ("the power button was clicked"), not what should
// happen: `update` decides, from the tuner's state, whether that means start
// or stop (FOLDKIT.md: Messages are facts, not commands).

// The classes that depend on whether the button can be pressed.
//   - Before the app is running: the ordinary cursor, and dimmed.
//   - Starting: the ordinary cursor, and not dimmed. The button is busy, not
//     out of use, and the spinner in it already says so.
//   - Otherwise: the pointing hand, and a darker ground under the pointer.
// It is an `if` chain, like `stringChipTone`, because three cases would
// otherwise be one ternary inside another. Each class name is written
// whole, as Tailwind needs (see `powerLightView`).
const powerButtonLook = (display: Display): string => {
  if (display.isBooting) {
    return 'cursor-default opacity-50'
  } else if (display.isStarting) {
    return 'cursor-default'
  } else {
    return 'cursor-pointer hover:bg-slate-900'
  }
}

// The outer div is the thin bezel, as round the screen and the controls.
// `max-w-fit` keeps it to the button's width where the row stacks, and
// `shrink-0` keeps the row from squeezing it where the button and a line
// sit side by side (`powerRowView`).
const powerButtonView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('max-w-fit shrink-0 rounded-[7px] border border-blue-200/10')],
    [
      Button.view(
        {
          onClick: Message.ClickedPower(),
          // Disabled while starting, when the browser may be asking for the
          // microphone, and before the app is running. A click then sends
          // no Message at all.
          isDisabled: display.isStarting || display.isBooting,
          toView: attributes =>
            h.button(
              [
                ...attributes.button,
                // `aria-pressed` makes this a toggle button: a screen reader
                // announces it as pressed or not pressed. `h.AriaPressed`
                // takes the attribute's value as a string.
                h.AriaPressed(display.isListening ? 'true' : 'false'),
                // `aria-busy` says that the button is in the middle of
                // changing: it is true while the tuner is starting.
                h.AriaBusy(display.isStarting),
                // The last part of the class list is the cursor and the
                // hover colour, which a disabled button does without.
                h.Class(
                  `flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-[15px] shadow ${display.isListening ? 'text-blue-100/80' : 'text-blue-100/70'} ${powerButtonLook(display)}`,
                ),
              ],
              [
                // While starting, the icon is a spinner (`animate-spin` is
                // Tailwind's rotation animation) and the text changes. The
                // icons are hidden from assistive technology, so the text is
                // the button's name.
                display.isStarting
                  ? Icon.spinner('h-[15px] w-[15px] animate-spin')
                  : Icon.power('h-[15px] w-[15px]'),
                h.span(
                  [h.Class('text-[14px]')],
                  [display.isStarting ? 'Starting…' : 'On / Off'],
                ),
              ],
            ),
        },
        h,
      ),
    ],
  )

// The place where the tuner says what it is waiting for.
//
// A start usually takes a fraction of a second. When the browser has to ask
// for permission it takes as long as the person does, and all the button
// says meanwhile is "Starting…". Someone who has not noticed the prompt
// sees a tuner that seems stuck. So once a start has lasted 1.2 seconds
// (`update` marks it slow: WaitBeforeSlowStartHint in src/main.ts), a line
// here says that the tuner is waiting for the microphone and what to do.
// When the start ends, in any way, the line goes.
//
// `role="status"` makes the div a polite live region: a screen reader reads
// out what appears in it once it has finished what it was saying. That is
// the right weight for a hint. The failure line below is an `alert`, which
// interrupts.
//
// NOTE: the div is always in the page, empty, and only the paragraph inside
// it comes and goes. `failureView` below adds and removes its whole
// element, and this one must not copy it. A screen reader announces a
// change inside a live region it already knows about, and may say nothing
// when a region arrives with its text already in it. An `alert` is the
// exception browsers make. `h.empty` is dropped from the list of children,
// so the div really is empty. The room the line will need is kept by the
// block round this div (`messagesView`), not by the div, and it is kept all
// the time, so nothing moves when the line comes or goes.
const startHintView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('status')],
    [
      display.isStartingSlow
        ? h.p([h.Class('text-slate-950')], [WAITING_FOR_MICROPHONE])
        : h.empty,
    ],
  )

// The error line, present only when the microphone failed.
//
// `role="alert"` makes the paragraph an assertive live region: a screen
// reader announces its text as soon as it appears, interrupting what it was
// saying. That suits a failure the person must act on, where the note above
// is only `polite`. It works because the element is absent (`h.empty`) until
// there is a failure and is then inserted with its text. Its room is kept
// by `messagesView`, like the waiting line's.
const failureView = (display: Display, h: HtmlBuilder<Message>): Html =>
  Option.match(display.maybeFailure, {
    onNone: () => h.empty,
    onSome: reason => h.p([h.Role('alert'), h.Class('text-red-950')], [reason]),
  })
