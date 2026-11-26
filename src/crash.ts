// crash.ts: the screen a visitor sees when the app has crashed.
//
// What this file is. One view function, `view`, which src/entry.ts gives to
// `Runtime.makeApplication` as `crash.view`. It is not a page of the app and
// has no route: the Foldkit runtime calls it, once, when the app has
// stopped for good.
//
// WHAT A CRASH IS
//
// The runtime catches an error thrown in `update`, in the view, in a
// Command, in a Subscription or in a managed resource's lifecycle. It then
// does four things, in this order (`renderCrashView` in
// `repos/foldkit/packages/foldkit/src/runtime/crashUI.ts`):
//
//   1. marks itself crashed. From here on every Message is dropped: none
//      reaches `update`, and the app's view is never called again;
//   2. logs the error to the browser's console;
//   3. calls `crash.report`, which here is `reportCrash` (src/sentry.ts);
//   4. calls `crash.view`, this file, and puts the result where the app's
//      page was, as it would any other render.
//
// Without a `crash.view` Foldkit draws a screen of its own: a white card
// headed "Application Crash" with the error's message and a note on how to
// customise it. That is written for the person building the app. This one
// is written for the person using it.
//
// WHAT THE VIEW IS GIVEN
//
// Two arguments, like the app's view, and both differ from the app's.
//
//   context  the error, the Model as it was, and the Message being handled
//            if there was one. This screen uses none of them: a stack trace
//            or a Model is no use to a visitor, and a developer has both in
//            Sentry and in the console.
//   h        an `HtmlBuilder<never>`. The app's view gets an
//            `HtmlBuilder<Message>`, whose type parameter is the set of
//            Messages an event handler may send. Here that set is `never`,
//            the empty type, so `h.OnClick(...)` cannot be given an
//            argument and does not compile. Foldkit is saying in the types
//            what is true at run time: nothing on this screen can send a
//            Message, because nothing is left to receive one.
//
// It returns a `Document`, as the app's view does (src/view.ts): the title
// and the body.
//
// WHY EVERY LINK HERE HAS A TARGET
//
// With no Messages, everything on the screen has to be something the
// browser does by itself. A link is the obvious thing, and a plain link
// does not work.
//
// The app has routing, so the runtime listens for clicks on links across
// the whole document (src/page/link.ts). For each one it tells the browser
// not to follow the link (`preventDefault`) and sends a Message in its
// place. A crash does not remove that listener. So after a crash a click on
// a plain link is still cancelled, the Message it becomes is dropped, and
// nothing happens at all. Seen in headless Chrome for a link to another
// page of the site, to this page and to another site.
//
// The listener leaves a few clicks to the browser, and one of them is a
// link whose `target` is set to something other than `_self`
// (`addLinkClickListener` in
// `repos/foldkit/packages/foldkit/src/runtime/browserListeners.ts`).
// `target="_top"` means "open in the top-level window", and this site is
// never shown inside a frame (`frame-ancestors 'none'` in vercel.json), so
// the top-level window is the tab the visitor is in. The link then behaves
// exactly as a plain link would on a page with no Foldkit: the browser
// loads the address in the same tab.
//
// Foldkit's own crash screen reloads another way, with
// `onclick="location.reload()"` written as an attribute. This site's
// Content Security Policy refuses inline event handlers, so that button
// does nothing here.
//
// WHAT IS REUSED, AND WHAT IS NOT
//
// The screen has to look like the site, and it must not call the app's own
// `view` (src/view.ts), which may be the code that threw. It takes the
// frame's classes from src/layout.ts, the brand from src/header.ts and the
// look of a text link from src/page/link.ts. It has no footer: none of the
// footer's links would work without the same `target`, and none of them is
// what someone whose tuner has just stopped is looking for.
//
// Nothing here is drawn by the build. The prerendered files hold the app's
// pages (src/entry.server.ts), and this screen exists only in a browser
// where the app has already taken a page over and then crashed.
//
// Read with: `crash` in src/entry.ts, where this is wired in beside
// `reportCrash`, and FINDINGS.md, "A plain link does nothing after a
// crash". Tested in src/crash.scene.test.ts and src/crash.runtime.test.ts.
import { type Runtime } from 'foldkit'
import {
  type Attribute,
  type Document,
  type Html,
  type HtmlBuilder,
} from 'foldkit/html'

import * as Header from './header'
import { COLUMN_CLASS, MAIN_CLASS, PAGE_CLASS } from './layout'
import { LINK_CLASS } from './page/link'
import { ISSUES_URL, VERSION } from './site'

// CONSTANT

// The words of the screen. Plain, and for a visitor: what happened, and
// what to do about it.
//
// NOTE: nothing here says the problem "has been reported". A report is sent
// only from the live hosts (`reportsFrom` in src/sentry.ts), and a
// visitor's browser may block it, so the screen cannot know.
const HEADING = 'The tuner has stopped'
const EXPLANATION =
  'Something went wrong and the tuner had to stop. Reloading the page starts it again.'

// The title follows the other pages: the name of the screen, then the site
// (`pageTitle` in src/view.ts). Exported for the tests, which cannot read a
// title from a drawn body.
/** The text of the browser tab while the crash screen shows. */
export const CRASH_TITLE = `${HEADING} | OK Tuner`

// An empty `href` is a relative address with nothing in it, which a browser
// resolves to the address of the page it is on: the same path and the same
// query string, without the `#fragment`. So the view does not need to know
// which page crashed. Following a link to the address you are already at
// loads the page again, which starts the app afresh. A fragment has to go
// for that to hold: a link that differs from the current address only by
// its fragment scrolls the page and loads nothing.
const SAME_PAGE = ''

// The reload link is drawn as a bordered button, so that it is the one
// obvious thing on the screen to press. It is still a link, and a screen
// reader calls it one, which is accurate: it loads a page. The
// `focus-visible:` classes draw the same ring as the site's other links
// when it is reached with the Tab key.
const RELOAD_CLASS =
  'inline-block rounded-md border border-slate-300 px-4 py-2 font-semibold text-slate-50 hover:border-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white'

// VIEW

// The attribute that keeps a link alive after a crash (see "WHY EVERY LINK
// HERE HAS A TARGET" in the header). `h.Target` sets the `target`
// attribute, as `h.Href` sets `href`. It is a function of the builder
// because an attribute is made with `h`, and it returns a list so that it
// can be spread into a link's attributes or handed whole to the header.
const browserHandled = (
  h: HtmlBuilder<never>,
): ReadonlyArray<Attribute<never>> => [h.Target('_top')]

// The first parameter is the crash context: `Runtime.CrashContext<Model,
// Message>` in Foldkit, with the error, the Model and an Option of the
// Message. It is typed with `unknown` for both, as `reportCrash` types its
// own (src/sentry.ts): the screen reads neither, and this way the file
// imports nothing from src/main.ts. A function that accepts any context
// also accepts the app's, which is all `makeApplication` asks. The
// underscore says the parameter is unused on purpose.
//
// The Document has a title and a body and nothing else. The runtime writes
// the title to `document.title`. It leaves the page's `lang="en"` alone
// when no `lang` is given, and with no `canonical` it puts the page's
// canonical address back to the one its file was served with.
//
// The body is the frame of every page (src/layout.ts): the ground, the
// header with the brand, and a `<main>` holding the column. Inside:
//
//   - the heading and the explanation, in a `role="alert"`. An alert is an
//     assertive live region: a screen reader reads it out as soon as it is
//     inserted, without the person having to find it. That is the only
//     announcement available here. A change of page moves focus to the
//     page's heading with a Command (`FocusPageHeading` in src/main.ts),
//     and after a crash no Command will run. The `<h1>` therefore has no
//     `pageHeadingAttributes` either: nothing is going to focus it. Focus
//     stays where the browser leaves it when the focused element is
//     removed, on the body, so the first press of Tab reaches the brand
//     and the second the reload link.
//   - the two links, outside the alert, so that what is read out is the two
//     sentences and not a list of controls.
//   - the version, as the footer shows it, for someone who does write to us.
/** The screen Foldkit draws in place of the app when the app has crashed. */
export const view = (
  _context: Runtime.CrashContext<unknown, unknown>,
  h: HtmlBuilder<never>,
): Document => ({
  title: CRASH_TITLE,
  body: h.div(
    [h.Class(PAGE_CLASS)],
    [
      Header.view(browserHandled(h), h),
      h.main(
        [h.Class(MAIN_CLASS)],
        [
          h.div(
            [h.Class(COLUMN_CLASS)],
            [alertView(h), reloadView(h), tellUsView(h), versionView(h)],
          ),
        ],
      ),
    ],
  ),
})

// The part that is announced. The classes of the heading and the paragraph
// are those of the not-found page (src/page/notFound.ts), so the screen
// reads as one more page of the site.
const alertView = (h: HtmlBuilder<never>): Html =>
  h.div(
    [h.Role('alert')],
    [
      h.h1([h.Class('mt-8 font-semibold text-slate-50')], [HEADING]),
      h.p([h.Class('mt-3 text-slate-200')], [EXPLANATION]),
    ],
  )

// The one way to start again. The link's text is its accessible name.
const reloadView = (h: HtmlBuilder<never>): Html =>
  h.p(
    [h.Class('mt-6')],
    [
      h.a(
        [h.Href(SAME_PAGE), ...browserHandled(h), h.Class(RELOAD_CLASS)],
        ['Reload the page'],
      ),
    ],
  )

// The one way to tell us: the repository's issues page (`ISSUES_URL` in
// src/site.ts). It is a sentence that ends in a link, and the link's own
// words say where it goes, for anyone who hears it out of its sentence in a
// screen reader's list of links. `textLink` (src/page/link.ts) is not used:
// it is written for the app's builder, and this link needs the target.
const tellUsView = (h: HtmlBuilder<never>): Html =>
  h.p(
    [h.Class('mt-6 text-slate-200')],
    [
      'If it keeps happening, ',
      h.a(
        [h.Href(ISSUES_URL), ...browserHandled(h), h.Class(LINK_CLASS)],
        ['tell us about it on GitHub'],
      ),
      '.',
    ],
  )

// `VERSION` comes from package.json (src/site.ts). The footer shows the
// same text in the same type.
const versionView = (h: HtmlBuilder<never>): Html =>
  h.p([h.Class('mt-12 font-mono text-xs text-slate-300')], [`v${VERSION}`])
