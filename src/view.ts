import { Array, Option } from 'effect'
import {
  type Document,
  type Html,
  type HtmlBuilder,
  childAttributes,
} from 'foldkit/html'

import { Button, Input, Meter, Popover } from '@foldkit/ui'

import * as Icon from './icon'
import {
  IN_TUNE_CENTS,
  Message,
  type Model,
  TunerState,
  TuningListbox,
} from './main'
import { failureSentence } from './microphone'
import {
  type Note,
  frequencyOfMidi,
  noteFromFrequency,
  noteName,
} from './pitch'
import { A4_MAX, A4_MIN, parseA4 } from './preferences'
import { TUNINGS, type Tuning, nearestString, tuningById } from './tuning'

// CONSTANT

const NEEDLE_RANGE_CENTS = 50
const LEVEL_BAR_SCALE = 50
const NON_BREAKING_SPACE = ' '

const HOW_TO_TIPS: ReadonlyArray<string> = [
  'Pick your tuning from the menu: guitar standard, drop D, a half step down, DADGAD, open G, bass, five-string bass or ukulele.',
  'Choose Chromatic for any other instrument or tuning: it just names whatever it hears.',
  'The menu beside the tuning sets A4 if your band tunes to 442 Hz; the tuning and the reference pitch are remembered on this device.',
  'Play one string at a time and let it ring: the needle settles rather than jitters.',
]

// DISPLAY

type Heard = Readonly<{
  frequency: number
  note: Note
  needleCents: number
  isInTune: boolean
}>

type Display = Readonly<{
  isListening: boolean
  isStarting: boolean
  level: number
  maybeHeard: Option.Option<Heard>
  maybeFailure: Option.Option<string>
}>

const quietDisplay: Display = {
  isListening: false,
  isStarting: false,
  level: 0,
  maybeHeard: Option.none(),
  maybeFailure: Option.none(),
}

const toDisplay = (model: Model): Display =>
  TunerState.match(model.tuner, {
    Off: () => quietDisplay,
    Starting: () => ({ ...quietDisplay, isStarting: true }),
    Listening: ({ level, maybeReading, needleCents }) => ({
      ...quietDisplay,
      isListening: true,
      level,
      maybeHeard: Option.map(maybeReading, ({ frequency }) => ({
        frequency,
        note: noteFromFrequency(frequency, model.a4),
        needleCents,
        isInTune: Math.abs(needleCents) <= IN_TUNE_CENTS,
      })),
    }),
    Failed: ({ failure }) => ({
      ...quietDisplay,
      maybeFailure: Option.some(failureSentence(failure)),
    }),
  })

const tuningWord = ({ needleCents, isInTune }: Heard): string => {
  if (isInTune) {
    return 'in tune'
  } else if (needleCents > 0) {
    return 'sharp'
  } else {
    return 'flat'
  }
}

const detailLine = (heard: Heard): string => {
  const sign = heard.needleCents > 0 ? '+' : ''

  return `${heard.frequency.toFixed(1)} Hz · ${sign}${heard.needleCents.toFixed(0)} cents · ${tuningWord(heard)}`
}

const needleLeft = (needleCents: number): string => {
  const clamped = Math.max(
    -NEEDLE_RANGE_CENTS,
    Math.min(NEEDLE_RANGE_CENTS, needleCents),
  )

  return `${NEEDLE_RANGE_CENTS + clamped}%`
}

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'OK Tuner | Chromatic Instrument Tuner',
  body: h.main(
    [h.Class('min-h-screen bg-oxford-dark px-6 py-12 text-slate-100')],
    [
      h.div(
        [h.Class('mx-auto w-full max-w-[600px]')],
        [
          h.h1([h.Class('font-serif text-3xl')], ['OK Tuner']),
          h.p(
            [h.Class('mt-4 mb-8 text-slate-200')],
            [
              'Free chromatic tuner that works in your browser. Preset tunings for guitar, bass and ukulele.',
            ],
          ),
          tunerView(model, h),
          howToView(h),
        ],
      ),
    ],
  ),
})

const tunerView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const display = toDisplay(model)
  const tuning = tuningById(model.tuningId)

  return h.section(
    [
      h.AriaLabel('Tuner'),
      h.Class(
        'relative min-h-[380px] w-full max-w-[600px] rounded-md bg-slate-400 bg-linear-to-b from-slate-500/10 via-slate-500/60 to-slate-500/80 px-5 py-5 shadow-xl shadow-oxford-950',
      ),
    ],
    [
      screenView(display, h),
      stringsView(tuning, model.a4, display, h),
      controlsView(model, tuning, display, h),
      powerButtonView(display, h),
      failureView(display, h),
      h.div(
        [
          h.Class(
            'pointer-events-none absolute right-3 bottom-3 text-[12px] font-semibold text-oxford uppercase opacity-90 select-none',
          ),
        ],
        ['OK Tuner 001'],
      ),
    ],
  )
}

const screenView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('rounded-[8px] border-2 border-blue-200/10')],
    [
      h.div(
        [h.Class('rounded-[7px] bg-black p-[2px]')],
        [
          h.div(
            [
              h.Class(
                'pointer-events-none relative grid h-[165px] place-items-center gap-1 rounded-md bg-oxford-900 bg-linear-to-br from-oxford-900 to-oxford-850 px-4 pt-2 pb-5',
              ),
            ],
            [
              h.div(
                [
                  h.Class(
                    'grid w-full grid-cols-[1fr_auto] items-center gap-3',
                  ),
                ],
                [levelView(display, h), powerLightView(display, h)],
              ),
              noteView(display, h),
              h.div(
                [
                  h.Class(
                    'h-[20px] font-mono text-[13px] tabular-nums opacity-85',
                  ),
                ],
                [
                  Option.match(display.maybeHeard, {
                    onNone: () => NON_BREAKING_SPACE,
                    onSome: detailLine,
                  }),
                ],
              ),
              needleView(display, h),
              scaleView(display, h),
            ],
          ),
        ],
      ),
    ],
  )

const levelView = (display: Display, h: HtmlBuilder<Message>): Html =>
  Meter.view(
    {
      id: 'input-level',
      ariaLabel: 'Input level',
      value: Math.round(display.level * 100),
      toView: attributes =>
        h.div(
          [
            ...attributes.meter,
            h.Class('h-1 w-full overflow-hidden rounded-lg'),
          ],
          [
            h.div([
              h.Class('h-full rounded bg-blue-100/60'),
              h.Style({ width: `${display.level * LEVEL_BAR_SCALE}%` }),
            ]),
          ],
        ),
    },
    h,
  )

const powerLightView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div([
    h.Class(
      `h-3 w-3 rounded-full ${display.isListening ? 'bg-green-400' : 'bg-oxford-800'}`,
    ),
  ])

const noteView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.AriaLive('polite'),
      h.AriaAtomic(true),
      h.Class('h-[56px] text-[56px] leading-none tabular-nums'),
    ],
    Option.match(display.maybeHeard, {
      onNone: () => [h.span([h.Class('opacity-30')], [NON_BREAKING_SPACE])],
      onSome: ({ note }) => [
        h.span([h.Class('inline-block text-blue-100 opacity-95')], [note.name]),
        h.span(
          [h.Class('ml-1 inline-block text-[24px] text-blue-100 opacity-90')],
          [`${note.octave}`],
        ),
      ],
    }),
  )

const needleView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.AriaHidden(true),
      h.Class(
        `relative mt-2 h-3 w-full max-w-sm rounded ${display.isListening ? 'bg-blue-300/10' : 'bg-blue-300/5'}`,
      ),
    ],
    [
      h.div([
        h.Class(
          `absolute inset-y-0 left-1/2 w-px ${display.isListening ? 'bg-white/40' : 'bg-white/10'}`,
        ),
      ]),
      h.div([
        h.Class(
          `absolute inset-y-0 left-[45%] w-[10%] rounded ${display.isListening ? 'bg-green-400/15' : 'bg-green-400/0'}`,
        ),
      ]),
      Option.match(display.maybeHeard, {
        onNone: () => h.empty,
        onSome: ({ needleCents, isInTune }) =>
          h.div([
            h.DataAttribute('needle-marker', ''),
            h.Class(
              `absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded ${isInTune ? 'bg-green-300' : 'bg-maximum-yellow'}`,
            ),
            h.Style({ left: needleLeft(needleCents) }),
          ]),
      }),
    ],
  )

const scaleView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.AriaHidden(true),
      h.Class(
        `flex h-[15px] w-full max-w-sm justify-between font-mono text-[10px] ${display.isListening ? 'opacity-90' : 'opacity-20'}`,
      ),
    ],
    [h.span([], ['−50']), h.span([], ['0']), h.span([], ['+50'])],
  )

const stringsView = (
  tuning: Tuning,
  a4: number,
  display: Display,
  h: HtmlBuilder<Message>,
): Html => {
  const maybeNearestString = Option.flatMap(display.maybeHeard, ({ note }) =>
    nearestString(tuning, note.midi),
  )
  const isInTune = Option.exists(display.maybeHeard, heard => heard.isInTune)

  return h.div(
    [h.Class('min-h-[42px] text-[13px] text-white/60 select-none')],
    [
      Array.match(tuning.notes, {
        onEmpty: () => h.empty,
        onNonEmpty: notes =>
          h.ul(
            [
              h.Role('list'),
              h.AriaLabel('Strings'),
              h.Class('mt-3 flex flex-wrap items-center justify-center gap-2'),
            ],
            Array.map(notes, midi =>
              stringView(
                midi,
                a4,
                Option.contains(maybeNearestString, midi),
                isInTune,
                display.isListening,
                h,
              ),
            ),
          ),
      }),
    ],
  )
}

const stringChipTone = (isNearest: boolean, isInTune: boolean): string => {
  if (!isNearest) {
    return 'border-white/10 text-blue-100/60'
  } else if (isInTune) {
    return 'border-green-400 text-green-400'
  } else {
    return 'border-accent text-accent'
  }
}

const stringView = (
  midi: number,
  a4: number,
  isNearest: boolean,
  isInTune: boolean,
  isListening: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    `${midi}`,
    [
      h.Class('rounded-[5px] border border-blue-300/10'),
      ...(isNearest ? [h.AriaCurrent('true')] : []),
    ],
    [
      h.span(
        [
          h.Title(`${frequencyOfMidi(midi, a4).toFixed(2)} Hz`),
          h.Class(
            `block rounded border bg-oxford-900 px-3 py-1 font-mono text-[14px] tabular-nums shadow-inner ${stringChipTone(isNearest, isInTune)}`,
          ),
        ],
        [
          h.span(
            [h.Class(isListening ? 'opacity-100' : 'opacity-10')],
            [noteName(midi)],
          ),
        ],
      ),
    ],
  )

const controlsView = (
  model: Model,
  tuning: Tuning,
  display: Display,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        'mt-5 grid grid-cols-[1fr_auto] place-content-center gap-3 text-[15px]',
      ),
    ],
    [
      h.div(
        [h.Class('min-w-0 rounded-[7px] border border-blue-200/10')],
        [tuningPickerView(model, tuning, display, h)],
      ),
      h.div(
        [h.Class('rounded-[7px] border border-blue-200/10')],
        [settingsMenuView(model, display, h)],
      ),
    ],
  )

const tuningPickerView = (
  model: Model,
  tuning: Tuning,
  display: Display,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.tuningListbox.id,
    model: model.tuningListbox,
    view: TuningListbox.view,
    viewInputs: {
      ariaLabel: 'Tuning',
      anchor: { placement: 'bottom-start', gap: 4, padding: 8 },
      items: TUNINGS,
      itemToValue: item => item.id,
      maybeSelectedValue: Option.some(model.tuningId),
      isDisabled: !display.isListening,
      itemToConfig: (item, { isSelected }) => ({
        className: `flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-blue-300/10 data-[active]:bg-blue-300/10 ${isSelected ? 'bg-white/10 font-semibold' : ''}`,
        content: h.span([h.Class('min-w-0 grow truncate')], [item.label]),
      }),
      buttonContent: h.span(
        [h.Class('flex w-full items-center gap-2')],
        [
          h.span([h.Class('min-w-0 grow truncate')], [tuning.label]),
          Icon.caretDown('h-3 w-3 shrink-0 opacity-70'),
        ],
      ),
      buttonAttributes: childAttributes([
        h.Class(
          `flex w-full items-center gap-2 rounded-md bg-oxford-dark px-4 py-2 text-left ${display.isListening ? 'cursor-pointer text-blue-100/80' : 'text-blue-100/5'}`,
        ),
      ]),
      itemsAttributes: childAttributes([
        h.Class(
          'z-20 max-h-64 w-(--button-width) overflow-y-auto rounded bg-oxford pt-1 pb-3 text-[15px] text-blue-100/90 shadow-lg shadow-oxford-950',
        ),
      ]),
      backdropAttributes: childAttributes([h.Class('fixed inset-0 z-10')]),
    },
    toParentMessage: message => Message.GotTuningListboxMessage({ message }),
  })

const settingsMenuView = (
  model: Model,
  display: Display,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.a4Popover.id,
    model: model.a4Popover,
    view: Popover.view,
    viewInputs: {
      ariaLabel: 'Tuner settings',
      anchor: { placement: 'bottom-end', gap: 4, padding: 8 },
      isDisabled: !display.isListening,
      toView: ({ button, panel, backdrop, isVisible }) =>
        h.div(
          [h.Class('relative')],
          [
            h.button(
              [
                ...button,
                h.Class(
                  `grid h-[38px] place-items-center rounded-md bg-oxford-dark px-3 py-2 leading-none ${display.isListening ? 'cursor-pointer text-blue-100/80' : 'text-blue-100/10'}`,
                ),
              ],
              [Icon.dotsThreeVertical('h-4 w-4')],
            ),
            ...(isVisible
              ? [
                  h.div([...backdrop, h.Class('fixed inset-0 z-10')]),
                  h.div(
                    [
                      ...panel,
                      h.Class(
                        'z-20 w-56 rounded-md bg-oxford px-4 pt-3 pb-4 text-blue-100/90 shadow-lg shadow-oxford-950',
                      ),
                    ],
                    [a4FieldView(model, h)],
                  ),
                ]
              : []),
          ],
        ),
    },
    toParentMessage: message => Message.GotA4PopoverMessage({ message }),
  })

const a4FieldView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Input.view(
    {
      id: 'a4-input',
      type: 'number',
      value: model.a4Input,
      isInvalid: Option.isNone(parseA4(model.a4Input)),
      onInput: value => Message.UpdatedA4Input({ value }),
      toView: attributes =>
        h.div(
          [h.Class('grid grid-cols-[auto_1fr] items-center gap-2 text-[13px]')],
          [
            h.label(
              [...attributes.label, h.Class('whitespace-nowrap')],
              ['A4 (Hz)'],
            ),
            h.input([
              ...attributes.input,
              h.Min(`${A4_MIN}`),
              h.Max(`${A4_MAX}`),
              h.Step('1'),
              h.Class(
                'h-8 w-full rounded-md border border-blue-100/20 bg-blue-300/5 px-3 py-1 text-[15px] tabular-nums data-[invalid]:border-red-400',
              ),
            ]),
          ],
        ),
    },
    h,
  )

const powerButtonView = (display: Display, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('mt-8 max-w-fit rounded-[7px] border border-blue-200/10')],
    [
      Button.view(
        {
          onClick: Message.ClickedPower(),
          isDisabled: display.isStarting,
          toView: attributes =>
            h.button(
              [
                ...attributes.button,
                h.AriaPressed(display.isListening ? 'true' : 'false'),
                h.AriaBusy(display.isStarting),
                h.Class(
                  `flex cursor-pointer items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-[15px] shadow hover:bg-slate-900 ${display.isListening ? 'text-blue-100/80' : 'text-blue-100/70'}`,
                ),
              ],
              [
                display.isStarting
                  ? Icon.spinner('h-[15px] w-[15px] animate-spin')
                  : Icon.power('h-[15px] w-[15px]'),
                h.span(
                  [h.Class('text-[14px]')],
                  [display.isStarting ? 'Starting…' : 'On / Off'],
                ),
              ],
            ),
        },
        h,
      ),
    ],
  )

const failureView = (display: Display, h: HtmlBuilder<Message>): Html =>
  Option.match(display.maybeFailure, {
    onNone: () => h.empty,
    onSome: reason =>
      h.p(
        [h.Role('alert'), h.Class('mt-3 max-w-[75%] text-sm text-red-950')],
        [reason],
      ),
  })

const howToView = (h: HtmlBuilder<Message>): Html =>
  h.section(
    [
      h.Class(
        'mt-8 rounded-md border border-white/70 p-5 leading-relaxed text-slate-200',
      ),
    ],
    [
      h.h2([h.Class('font-semibold text-slate-50')], ['How to use the tuner']),
      h.p(
        [h.Class('mt-3')],
        [
          'Turn the tuner on (the browser asks for the microphone once) and play a single string or note. The nearest note shows large, the needle reads how many cents sharp or flat it is (green within five), and the string of your tuning it is closest to lights up. Nothing is recorded.',
        ],
      ),
      h.h3([h.Class('mt-5 font-semibold text-slate-50')], ['Quick tips']),
      h.ul(
        [h.Class('mt-3 list-disc space-y-2 pl-5')],
        Array.map(HOW_TO_TIPS, tip => h.li([], [tip])),
      ),
    ],
  )
