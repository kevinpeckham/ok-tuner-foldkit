// instrument.ts: starts Sentry, and does nothing else.
//
// This module exists to be imported for its side effect. src/entry.ts
// imports it first, with a bare `import './instrument'`, so that error
// reporting is running before any other module of the app is evaluated.
//
// It has to be a module of its own. In an ES module every import is
// evaluated before the first statement of the file that imports it. A call
// to `initSentry()` written at the top of entry.ts would therefore run after
// main.ts, view.ts and everything they import had already been evaluated,
// and an error thrown while they loaded would go unreported. Imports are
// evaluated in the order they are written, so a first import runs first
// (FINDINGS.md, "Sentry must start before any other module is evaluated").
//
// This is not part of the Foldkit architecture, and nothing here is Foldkit.
// It runs before the runtime exists. Sentry's handlers, installed here, see
// the errors thrown outside the Foldkit runtime. Errors inside it are caught
// by Foldkit and reach Sentry another way: the `crash: { report }` option in
// src/entry.ts.
//
// Tests never import entry.ts or this file, so no test starts Sentry by
// accident. (src/sentry.test.ts starts it on purpose, with a transport that
// records what would have been sent.) What `initSentry` sets up, and what it
// deliberately leaves off, is in src/sentry.ts and in
// docs/superpowers/specs/2026-11-24-sentry-design.md.

import { initSentry } from './sentry'

// NOTE: entry.ts imports this module first, so Sentry's handlers for uncaught
// errors are in place before any other module of the app is evaluated.
initSentry()
