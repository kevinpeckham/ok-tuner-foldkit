import { Runtime } from 'foldkit'

import {
  Message,
  Model,
  init,
  managedResources,
  subscriptions,
  update,
} from './main'
import { view } from './view'

const DEVTOOLS_MAX_ENTRIES = 500

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  managedResources,
  subscriptions,
  container: document.getElementById('root'),
  devTools: {
    Message,
    maxEntries: DEVTOOLS_MAX_ENTRIES,
  },
})

Runtime.run(application)
