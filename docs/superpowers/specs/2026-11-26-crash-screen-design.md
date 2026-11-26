# A crash screen of our own: design

Asked for by Kevin on 2026-11-26, with the main decisions already made (marked "given" below). One item from the backlog's "Page content" section: "A custom crash screen in place of Foldkit's default, which is written for developers."

## Intent

When the app crashes, Foldkit stops it and draws its own crash screen: a white card headed "Application Crash", the error's message, a line about the browser console, and a note on how to customise the screen. That is written for the person building the app. A visitor needs three things instead: to be told the tuner has stopped, a way to start it again, and a way to tell us.

## What was found first

Read in `repos/foldkit/packages/foldkit/src/runtime/` (`crashUI.ts`, `renderer.ts`, `browserListeners.ts`, `messageQueue.ts`, `documentMetadata.ts`) and then seen in headless Chrome against a build served with the site's headers.

- **What the crash view is given.** `crash.view(context, h)`. The context holds `error` (always an `Error`), `model` (the Model as it was) and `message` (an `Option` of the Message being handled). `h` is an `HtmlBuilder<never>`: its Message type is `never`, so no event handler that sends a Message can be written with it.
- **What it must return.** A `Document`, like the app's own view: a `title` and a `body`, with optional `lang`, `dir`, `canonical` and `ogUrl`.
- **When it runs.** Once. The runtime logs the error to the console, calls `crash.report`, then calls `crash.view` and patches the result over whatever the app had drawn. If `crash.view` throws, Foldkit draws its default screen instead.
- **The runtime is stopped, but not gone.** A flag (`isCrashed`) makes the message queue drop every Message. Nothing is torn down: the listeners the runtime put on the document are still there.
- **So a plain link is dead.** With routing on, the runtime's click listener calls `preventDefault()` on every same-tab link and turns the click into a Message. After a crash the Message is dropped, and the browser has already been told not to follow the link. Seen: an internal link, a link to the page's own address and a link to another site all did nothing. The brief expected an internal link to be an ordinary page load. It is not.
- **The listener leaves three kinds of link alone:** a click with a modifier key or another button, a link with a `download` attribute, and a link whose `target` is set to anything but `_self`. Seen: with `target="_top"` all three kinds of link loaded their page, in the same tab.
- **Foldkit's own Reload button does nothing on this site.** The default screen, and Foldkit's example, reload with `onclick="location.reload()"`. The Content Security Policy refuses inline event handlers. Seen: the button was pressed and no page was requested. So until this change a visitor who crashed had a button that did nothing.
- **The title.** The runtime writes the crash Document's `title` to `document.title`. The default is "Application Crash". A `lang` that is left out is left as it is in the page (`en`), and a `canonical` that is left out goes back to the one the file was served with.
- **A prerendered page.** By the time anything can crash, the runtime has taken the server-drawn root over, and the crash screen is patched in its place like any other render. Nothing about it is drawn by the build.
- **Is a throw in the readings a crash?** Yes. A Subscription's stream is run with `Effect.catchCause(cause => crashWith(cause, Option.none()))` (`subscriptionFibers.ts`). Seen: replacing `AnalyserNode.prototype.getFloatTimeDomainData` with a function that throws, while the tuner listens, brings up the crash screen within one reading.
- **The microphone stays open.** After that crash the stream's track was still `live`. Nothing closes a managed resource when the runtime crashes. Not fixed here: it is in the backlog.

## Goals

- A crash replaces the page with a screen in the site's own look, in plain words: the tuner hit a problem and had to stop, and reloading the page starts it again.
- One clear way to reload, and one way to tell us: a link to the repository's issues page.
- Both work with the app dead and under the Content Security Policy.
- A screen reader announces the message when the screen appears, and the reload control is reachable with the keyboard.
- The crash is still reported to Sentry once, before the screen is drawn, exactly as before.

## Not goals

- **No developer details on the page** (given): no stack trace, no error text, no Model. A developer has Sentry and the console, where Foldkit still logs the error.
- **No claim that the problem "has been reported"** (given). Reports are sent only from the live hosts, and a visitor's browser may block them. The screen says nothing about reporting.
- No recovery without a reload. A crashed runtime cannot be restarted.
- No closing of the microphone on a crash (backlog).
- No footer on the crash screen. Each of its seven links would need the same treatment as the links below, and none helps someone whose tuner has just stopped.

## Approaches

### Where the screen comes from

1. **Foldkit's `crash.view` option (chosen, given).** It is the hook made for this. `crash.report` stays exactly as it is, so `reportCrash` and its tests are untouched.
2. **Our own error boundary around `update` and the view.** Not possible in the Elm architecture as Foldkit builds it, and it would miss crashes in Commands, Subscriptions and managed resources.

### The reload control

The browser has to do the work by itself: no Message will ever be handled, and the policy forbids inline handlers.

1. **A link to the page's own address, marked `target="_top"` (chosen).** `href=""` is the address of the page itself, with its query and without its fragment, so the view needs to know nothing about where it is. `target="_top"` names the window's own top level, which for a page that is never framed (`frame-ancestors 'none'`) is the same tab, and it is what makes the runtime's click listener leave the link alone. Seen in Chrome: the page is requested again and a working tuner comes back, from `/` and from `/?a=1#frag`.
2. **A plain link.** Dead, as found above.
3. **`onclick="location.reload()"`,** Foldkit's own way. Refused by the policy.
4. **A form with one button, `method="get"`.** Works (`form-action 'self'` allows it), and is a real button. Not chosen: it leaves a stray `?` on the address, and replaces a query string if there was one.
5. **A sentence asking the visitor to reload the page themselves.** Always works. Kept as the wording around the link, so the screen still helps if the link ever stops working.

The control is a link, and is announced as one. That is accurate: it loads a page.

### The other links

The issues link and the brand link take the same `target="_top"`, for the same reason. `_top` and not `_blank`: every other link on the site opens in the same tab, and with the app stopped there is nothing in this tab to keep.

### Announcing the screen

1. **`role="alert"` on the heading and the message (chosen).** An alert that is inserted with its text is announced at once, with no script. The app already does this for the microphone's failure line.
2. **Moving focus to the heading,** as a page change does. Not possible: after a crash there is no Command to run, the view may not touch the DOM, an `autofocus` attribute is not honoured once the visitor has focused anything in the page, and the policy forbids an inline script.

The two links sit outside the alert, so the announcement is the two sentences and not the controls. Focus is left where the browser puts it when the focused element is removed, on the body, so the first Tab reaches the brand link and the second the reload link.

### The site's look

The crash screen cannot call the app's `view`: that is the code that may have just thrown. It needs the same ground, column and type without it.

1. **Shared constants (chosen).** The three class strings that make the page ground, the `<main>` and the 600 px column move to `src/layout.ts`, and `view`, the header, the footer and the crash screen all read them from there. A change to the site's look reaches the crash screen without anyone remembering it.
2. **Copy the strings.** Smallest change, and the crash screen would drift the first time the look changes. Nobody looks at a crash screen until they need it.

The header is reused: `Header.view` takes the attributes of the brand link as a parameter, empty for the pages and `target="_top"` for the crash screen. It becomes generic in the builder's Message type, because the crash view's builder is an `HtmlBuilder<never>`. It uses no Message, so nothing else changes.

## Design

- **`src/crash.ts`,** a new file: `view(context, h)`, the function given to `crash.view`. It ignores its context on purpose. Its parameter is typed with `unknown` for the Model and the Message, as `reportCrash`'s is, so the file imports nothing from `src/main.ts` or `src/view.ts`.
- **The Document.** `title`: "The tuner has stopped | OK Tuner", in the pattern of the other pages. No `lang` and no `canonical`: the runtime leaves the first alone and puts the second back to what the file was served with.
- **The body.** The page ground, the header with the brand, and a `<main>` holding the column:
  - a `role="alert"` block with the `<h1>` "The tuner has stopped" and one paragraph: "Something went wrong and the tuner had to stop. Reloading the page starts it again."
  - the reload link, "Reload the page", drawn as a bordered button so it is the one obvious thing to press;
  - a sentence with the issues link: "If it keeps happening, " then the link "tell us about it on GitHub", to `GITHUB_URL` plus `/issues` (`ISSUES_URL` in `src/site.ts`);
  - the version, small, as the footer shows it, for someone who does write to us.
- **The heading** has no `pageHeadingAttributes`: nothing will move focus to it, and its id belongs to the Command that does.
- **`src/entry.ts`:** `crash: { view: Crash.view, report: reportCrash }`.
- **Privacy.** Nothing new leaves the browser. The link to GitHub is followed only if the visitor presses it, like the footer's.
- **Tests.**
  - Scene (`src/crash.scene.test.ts`), with the crash context as the scene's Model and `never` as its Message: one `<h1>`, the alert and what it holds, the two links with their addresses and `target`, the brand link's `target`, and that the error's own text and the Model are nowhere on the screen.
  - A plain test for the title.
  - A runtime test (`src/crash.runtime.test.ts`) in happy-dom: a three-line app with routing whose `update` throws, started with our crash view and a recording `report`. It pins what the design rests on and no scene can see: the report is made once and before the screen is drawn, the screen replaces the app, and a click on each of its links is not cancelled by the runtime while a click on a plain link is.
  - Headless Chrome against a build with the site's headers: a forced crash in the readings, then every check in the brief. The script stays in the smoke folder for the live site.
- **Version** 0.7.0.

## Calls made for Kevin

- **`target="_top"` on every link of the crash screen.** The brief's suggestion, a plain link, does not work here. If `_top` is wrong somewhere, the link is dead there and the sentence still says what to do.
- **The reload control is a link, not a button.** A real button needs either an inline handler, which the policy refuses, or a form, which leaves a `?` on the address.
- **No footer,** and the version shown on its own.
- **The words,** and the title.
- **`src/layout.ts`** and the header's new parameter: small changes to files this task did not have to touch, made so the crash screen cannot drift from the site.
- **A runtime test in the suite.** It is the first test here that starts a Foldkit runtime. It is slower than a scene (it waits on real frames) and it leans on happy-dom behaving like a browser for click events.

## Left to the builder

- Whether happy-dom can run the runtime test at all. If it cannot, the claims it pins stay with the headless Chrome script, and the design says so.
- The exact classes of the reload link.
