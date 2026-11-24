import { initSentry } from './sentry'

// Imported first by entry.ts, so Sentry's handlers for uncaught errors are in
// place before any other module of the app is evaluated.
initSentry()
