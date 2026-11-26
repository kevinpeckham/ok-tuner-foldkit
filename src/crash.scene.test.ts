// CRASH SCENE TESTS: the crash screen, as a person meets it
//
// This file exercises `view` and `CRASH_TITLE` in `src/crash.ts`: the screen
// Foldkit draws in place of the app when the app has crashed.
//
// A CRASH VIEW IN A SCENE
//
// A Scene test (see the header of `src/scene.test.ts`) takes an `update` and
// a view and draws the view from a Model. A crash view is not the view of an
// app, but it has the same shape, `(something, h) => Document`, so it drops
// into a scene with two substitutions:
//
//   the Model    is the crash context: the error, the Model as it was, and
//                the Message being handled. `given(context)` supplies it.
//   the Message  is `never`. A crash view is handed an `HtmlBuilder<never>`,
//                a builder with which no event handler can be written, so
//                there is no Message for `update` to receive. The `update`
//                below is there because `scene` asks for one. It is never
//                called.
//
// So these tests can look and cannot click, which is the right limit: after
// a crash nothing on the page sends a Message. What a click on a link then
// does is the browser's business, and `src/crash.runtime.test.ts` and the
// headless Chrome check cover it.
import { Option } from 'effect'
import { type Runtime } from 'foldkit'
import { inertHtml } from 'foldkit/html'
import {
  all,
  expect,
  expectAll,
  given,
  role,
  scene,
  text,
  within,
} from 'foldkit/scene'
import { describe, test, expect as vitestExpect } from 'vitest'

import { CRASH_TITLE, view } from './crash'
import { GITHUB_URL, ISSUES_URL, VERSION } from './site'

// FIXTURES

// What the runtime would hand the crash view. `unknown` for the Model and
// the Message, as in `src/crash.ts`: the screen reads neither.
type Context = Runtime.CrashContext<unknown, unknown>

// Words that must never reach the page. Each part of the context carries
// one, so a crash view that printed the error, the Model or the Message
// would put one of them on the screen.
const ERROR_TEXT = 'Cannot read properties of undefined'
const MODEL_TEXT = 'model-detail'
const MESSAGE_TEXT = 'MeasuredInput'

const context: Context = {
  error: new Error(ERROR_TEXT),
  model: { tuner: MODEL_TEXT },
  message: Option.some({ _tag: MESSAGE_TEXT }),
}

// `scene` needs an `update`. With `never` for the Message it cannot be
// called: there is no value to call it with.
const update = (model: Context, _message: never) => ({ model })

// The name of the screen, and of its two controls.
const HEADING = 'The tuner has stopped'
const RELOAD = 'Reload the page'
const TELL_US = 'tell us about it on GitHub'

describe('the crash screen', () => {
  // Every page has exactly one `<h1>`, which names it (AGENTS.md, "Pages").
  // The crash screen is not a page of the app, and keeps the rule anyway.
  test('has one first-level heading, which names the screen', () => {
    scene(
      { update, view },
      given(context),
      expect(role('heading', { level: 1, name: HEADING })).toExist(),
      expectAll(all.role('heading', { level: 1 })).toHaveCount(1),
    )
  })

  // `role="alert"` is how the screen is announced: a screen reader reads an
  // alert out when it is inserted. The heading and the sentence are inside
  // it, so they are what is read. The links are outside it.
  test('announces the heading and the message as an alert', () => {
    const alert = role('alert')

    scene(
      { update, view },
      given(context),
      expect(within(alert, role('heading', { name: HEADING }))).toExist(),
      expect(
        within(
          alert,
          text(
            'Something went wrong and the tuner had to stop. Reloading the page starts it again.',
          ),
        ),
      ).toExist(),
      expect(within(alert, role('link'))).toBeAbsent(),
    )
  })

  // The reload control is a link to the page's own address. An empty `href`
  // is that address, whatever page crashed. `target="_top"` is what makes it
  // work with the app stopped (src/crash.ts, "WHY EVERY LINK HERE HAS A
  // TARGET").
  test('offers one link that loads the page again', () => {
    scene(
      { update, view },
      given(context),
      expect(role('link', { name: RELOAD })).toHaveAttr('href', ''),
      expect(role('link', { name: RELOAD })).toHaveAttr('target', '_top'),
    )
  })

  test('offers a link to the issues page of the repository', () => {
    scene(
      { update, view },
      given(context),
      expect(role('link', { name: TELL_US })).toHaveAttr('href', ISSUES_URL),
      expect(role('link', { name: TELL_US })).toHaveAttr('target', '_top'),
    )
  })

  // The brand is the header the pages have (src/header.ts), with the one
  // attribute a link needs here.
  test('shows the brand, as a link home that still works', () => {
    const brand = within(role('banner'), role('link', { name: 'OK Tuner' }))

    scene(
      { update, view },
      given(context),
      expect(brand).toHaveAttr('href', '/'),
      expect(brand).toHaveAttr('target', '_top'),
    )
  })

  // A plain link does nothing once the app has crashed, so there must be
  // none: every link on the screen carries the target.
  test('has no link without the target', () => {
    scene(
      { update, view },
      given(context),
      expectAll(all.role('link')).toHaveCount(3),
      expectAll(all.selector('a[target="_top"]')).toHaveCount(3),
    )
  })

  // The version, for someone who writes to us, as the footer shows it.
  test('shows the version', () => {
    scene(
      { update, view },
      given(context),
      expect(text(`v${VERSION}`)).toExist(),
    )
  })

  // The screen is for a visitor. The error, the Model and the Message go to
  // Sentry and the console, not to the page. The first step shows the scene
  // is drawing the screen at all, so the absences mean something.
  test('shows nothing of the error, the Model or the Message', () => {
    scene(
      { update, view },
      given(context),
      expect(role('heading', { name: HEADING })).toExist(),
      expect(text(new RegExp(ERROR_TEXT))).toBeAbsent(),
      expect(text(new RegExp(MODEL_TEXT))).toBeAbsent(),
      expect(text(new RegExp(MESSAGE_TEXT))).toBeAbsent(),
      expect(text(/Error|stack|console/i)).toBeAbsent(),
    )
  })

  // It must not claim that we know: a report is sent only from the live
  // hosts, and a browser may block it.
  test('does not say the problem was reported', () => {
    scene(
      { update, view },
      given(context),
      expect(role('heading', { name: HEADING })).toExist(),
      expect(text(/report/i)).toBeAbsent(),
    )
  })
})

// A scene draws the body and cannot see the title (src/view.test.ts), so
// the title is checked on what the view returns, with Vitest's own `expect`.
// The view is called with Foldkit's `inertHtml`, the builder for code that
// has none in scope. It is an `HtmlBuilder<never>`, the type the runtime
// passes a crash view.
describe('the crash screen as a Document', () => {
  test('is titled in the pattern of the pages', () => {
    const document = view(context, inertHtml)

    vitestExpect(document.title).toBe('The tuner has stopped | OK Tuner')
    vitestExpect(document.title).toBe(CRASH_TITLE)
  })

  // Left out, so the runtime leaves the page's language alone and puts the
  // canonical address back to the one the file was served with.
  test('sets no language and no canonical address', () => {
    const document = view(context, inertHtml)

    vitestExpect(document.lang).toBeUndefined()
    vitestExpect(document.canonical).toBeUndefined()
  })
})

// The address of the issues page is built from the repository's, so the two
// cannot drift.
describe('ISSUES_URL', () => {
  test('is the issues page of the repository', () => {
    vitestExpect(ISSUES_URL).toBe(`${GITHUB_URL}/issues`)
    vitestExpect(ISSUES_URL).toBe(
      'https://github.com/kevinpeckham/ok-tuner-foldkit/issues',
    )
  })
})
