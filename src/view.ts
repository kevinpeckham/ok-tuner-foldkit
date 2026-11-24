import { type Document, type HtmlBuilder } from 'foldkit/html'

import { Message, type Model } from './main'

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'OK Tuner | Chromatic Instrument Tuner',
  body: h.main(
    [h.Class('min-h-screen p-6')],
    [
      h.h1([], ['OK Tuner']),
      h.button(
        [h.Type('button'), h.OnClick(Message.ClickedPower())],
        ['On / Off'],
      ),
      h.p([], [model.tuner._tag]),
    ],
  ),
})
