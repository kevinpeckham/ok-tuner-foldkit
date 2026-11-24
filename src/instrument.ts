import { initSentry } from './sentry'

// NOTE: entry.ts imports this module first, so Sentry's handlers for uncaught
// errors are in place before any other module of the app is evaluated.
initSentry()
