// NOTE: this import must stay first. Imports are evaluated in order, and
// Sentry has to be listening before the rest of the app loads.
import './instrument'
import { Runtime } from 'foldkit'

import {
  Flags,
  Message,
  Model,
  flags,
  init,
  managedResources,
  subscriptions,
  update,
} from './main'
import { reportCrash } from './sentry'
import { view } from './view'

// entry.ts: the one file that starts something.
//
// index.html loads this module and no other. Everything else under src is
// definitions. src/main.ts declares the Model, the Messages, `update` and the
// rest, and src/view.ts declares the view, but neither of them runs anything.
// This file gathers those definitions into one configuration, hands it to the
// Foldkit runtime and starts it.
//
// Keeping the start here and out of main.ts is a Foldkit convention
// (FOLDKIT.md, "File Organization"). Tests import main.ts and view.ts freely.
// They never import this file, so they never boot an app, and never start
// Sentry by accident.
//
// The runtime is the part of Foldkit that does things. Once started it owns
// the loop: it renders the Model with `view`, turns events in the page into
// Messages, calls `update` with each one, runs the Commands that `update`
// returns, opens and closes the microphone, and starts and stops the
// readings. The app's own code is only ever called by it.
//
// Reading order: this file first, then src/main.ts, where the eight names
// imported from it above are declared and explained, then src/view.ts.
// src/instrument.ts explains the first import.

// How many Messages the Foldkit DevTools keep in their history. The default
// is 100, which at twenty readings a second is about five seconds. 500 is the
// most Foldkit allows (it clamps the value to between 20 and 500) and holds
// about twenty-five seconds (FINDINGS.md, "The microphone is a managed
// resource and the readings a subscription").
const DEVTOOLS_MAX_ENTRIES = 500

// `Runtime.makeApplication` assembles the app from its parts and returns a
// program. Nothing is rendered and nothing runs yet: `Runtime.run` below
// starts it.
//
// "Application" means the app owns the whole page. Its view returns a
// Document (the body, and things such as the page's title), and the runtime
// keeps the real page in step with it. Foldkit's other constructor,
// `Runtime.makeElement`, is for an app that lives inside a page it does not
// own.
//
// Two options are left out because this app has no use for them:
// `resources` (services that live as long as the app does) and `crash.view`
// (a crash screen of its own, in place of Foldkit's default).
const application = Runtime.makeApplication({
  // The Schema of the Model. The runtime uses it in development, to save the
  // Model before a reload and to restore it afterwards.
  Model,
  // The Schema of the Flags, the data read at start-up. Its presence is what
  // says the app has any: `init` then takes the flags as its argument, and
  // `Runtime.run` must be given an Effect that produces them.
  Flags,
  // Builds the first Model from the flags.
  init,
  // (Model, Message) -> the next Model and Commands. The runtime calls it
  // for every Message, one at a time, and runs the Commands it returns.
  update,
  // Model -> the page. The runtime calls it after the Model has changed, at
  // most once per animation frame, and patches the DOM to match the result.
  view,
  // The microphone. The runtime opens and closes it as the Model requires.
  managedResources,
  // The readings. The runtime starts and stops the stream as the Model
  // requires, and sends each Message it emits to `update`.
  subscriptions,
  // Routing: the app has more than one page (src/route.ts). The address bar
  // is outside the app, so the runtime watches it, and these two functions
  // say which Message to make of what it sees.
  //   onUrlRequest  a link in the page was clicked. The runtime has stopped
  //                 the browser from loading it. It leaves alone a click
  //                 with a modifier key or another mouse button, a link
  //                 that opens in another tab, and a download link.
  //   onUrlChange   the address changed: after the app asked for a new one,
  //                 or because of the back or forward button.
  // The presence of this option is also what makes `init` take the address
  // as its second argument (src/main.ts, INIT), and the runtime passes it
  // the address the page was opened at.
  routing: {
    onUrlRequest: request => Message.ClickedLink({ request }),
    onUrlChange: url => Message.ChangedUrl({ url }),
  },
  // The element the app is rendered into: `<div id="root">` in index.html.
  // `getElementById` may return null, and Foldkit throws at once if it
  // does. The element must have an id, which the runtime uses to tell this
  // app's saved Model from another's across a development reload.
  container: document.getElementById('root'),
  // What to do when the app crashes. Foldkit catches an error thrown in
  // `update`, in the view, in a Command, in a subscription or in a managed
  // resource's lifecycle. It stops the app and shows a crash screen, so the
  // error never reaches `window.onerror` and Sentry's own handlers never see
  // it. `report` is the way out: the runtime calls it, before it draws the
  // crash screen, with the error, the Model as it was, and the Message being
  // handled if there was one. `reportCrash` (src/sentry.ts) sends all three
  // to Sentry (FINDINGS.md, "Foldkit catches crashes itself, so Sentry's own
  // handlers never see them").
  crash: { report: reportCrash },
  // The Foldkit DevTools: a panel that lists every Message as it happens,
  // with the Model after it and the Commands `update` returned for it, and
  // that can show the page as it was at an earlier Message. With no `show`
  // option they are on only under Vite's dev server, so the deployed site
  // has none.
  devTools: {
    // The Schema of the Messages. With it, an AI agent connected through
    // the DevTools MCP server can send Messages to the running app, and
    // Foldkit checks each one against the Schema first. Without it an agent
    // can look but not send.
    Message,
    // See DEVTOOLS_MAX_ENTRIES above.
    maxEntries: DEVTOOLS_MAX_ENTRIES,
  },
})

// Starts the app, for as long as the page lives. The runtime runs the `flags`
// Effect (the saved preferences, read from localStorage), calls `init` with
// the result and the page's address, renders the first Model into the container, and begins the
// loop. `run` returns nothing: from here on everything happens inside the
// runtime.
//
// In development there is one difference. When Vite reloads the page after
// an edit, Foldkit's Vite plugin hands back the Model it saved, and the
// runtime starts from that without running `flags` or `init` (FINDINGS.md,
// "In development the page can boot already 'listening'").
Runtime.run(application, { flags })
