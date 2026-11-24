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

const DEVTOOLS_MAX_ENTRIES = 500

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  managedResources,
  subscriptions,
  container: document.getElementById('root'),
  crash: { report: reportCrash },
  devTools: {
    Message,
    maxEntries: DEVTOOLS_MAX_ENTRIES,
  },
})

Runtime.run(application, { flags })
