import { Runtime } from 'foldkit'

import { Message, Model, init, update } from './main'
import { view } from './view'

const DEVTOOLS_MAX_ENTRIES = 500

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('root'),
  devTools: {
    Message,
    maxEntries: DEVTOOLS_MAX_ENTRIES,
  },
})

Runtime.run(application)
