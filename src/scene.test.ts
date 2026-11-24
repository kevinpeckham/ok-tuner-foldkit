import { Option } from 'effect'
import {
  Command,
  ManagedResource,
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  label,
  nth,
  role,
  scene,
  selector,
  text,
  title,
  type,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Popover } from '@foldkit/ui'

import {
  Message,
  type Model,
  SavePreferences,
  TunerState,
  init,
  managedResources,
  update,
} from './main'
import { REFUSED } from './microphone'
import { DEFAULT_PREFERENCES } from './preferences'
import { view } from './view'

const offModel: Model = init({ preferences: DEFAULT_PREFERENCES }).model

type ListeningFields = Partial<Omit<typeof TunerState.Listening.Type, '_tag'>>

const listening = (fields: ListeningFields = {}): Model =>
  modifyFields(offModel, {
    tuner: () =>
      TunerState.Listening({
        level: 0,
        maybeReading: Option.none(),
        needleCents: 0,
        quietTicks: 0,
        ...fields,
      }),
  })

const hearing = (frequency: number, needleCents: number): Model =>
  listening({
    level: 0.5,
    maybeReading: Option.some({ frequency, clarity: 0.95 }),
    needleCents,
  })

const withTuning = (model: Model, tuningId: string): Model =>
  modifyFields(model, { tuningId: () => tuningId })

const powerButton = role('button', { name: 'On / Off' })
const needleMarker = selector('[data-needle-marker]')
const litString = selector('[aria-current="true"]')
const strings = all.selector('[aria-label="Strings"] li')

describe('power', () => {
  test('off: the button is not pressed, there is no note and no alert', () => {
    scene(
      { update, view },
      given(offModel),
      expect(role('heading', { name: 'OK Tuner' })).toExist(),
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
      expect(powerButton).toBeEnabled(),
      expect(needleMarker).toBeAbsent(),
      expect(role('alert')).toBeAbsent(),
    )
  })

  test('pressing the button shows Starting…, and acquiring the microphone turns it on', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      expect(text('Starting…')).toExist(),
      expect(role('button', { name: 'Starting…' })).toBeDisabled(),
      expect(role('button', { name: 'Starting…' })).toHaveAttr(
        'aria-busy',
        'true',
      ),
      ManagedResource.acquire(managedResources.microphone),
      expect(powerButton).toHaveAttr('aria-pressed', 'true'),
      expect(powerButton).toBeEnabled(),
    )
  })

  test('pressing the button while listening turns it off and releases the microphone', () => {
    scene(
      { update, view },
      given(hearing(110, 3)),
      click(powerButton),
      ManagedResource.release(managedResources.microphone),
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
      expect(needleMarker).toBeAbsent(),
    )
  })

  test('a refused microphone shows the reason as an alert', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      ManagedResource.failAcquire(
        managedResources.microphone,
        Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
      ),
      expect(role('alert')).toHaveText(REFUSED),
      expect(powerButton).toHaveAttr('aria-pressed', 'false'),
      expect(powerButton).toBeEnabled(),
    )
  })

  test('an unexpected microphone error shows the browser’s message', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      ManagedResource.failAcquire(
        managedResources.microphone,
        Object.assign(new Error('The device is busy'), {
          name: 'NotReadableError',
        }),
      ),
      expect(role('alert')).toHaveText('The device is busy'),
    )
  })

  test('an unexplained microphone error shows the fallback sentence', () => {
    scene(
      { update, view },
      given(offModel),
      click(powerButton),
      ManagedResource.failAcquire(managedResources.microphone, '???'),
      expect(role('alert')).toHaveText('The microphone could not be opened.'),
    )
  })
})

describe('screen', () => {
  test('an in-tune A2 on standard tuning', () => {
    scene(
      { update, view },
      given(hearing(110, 3)),
      expect(selector('[aria-live="polite"]')).toHaveText('A2'),
      expect(text('110.0 Hz · +3 cents · in tune')).toExist(),
      expectAll(all.selector('[aria-current="true"]')).toHaveCount(1),
      expect(litString).toHaveText('A'),
    )
  })

  test.each([
    [12, '440.0 Hz · +12 cents · sharp'],
    [-12, '440.0 Hz · -12 cents · flat'],
    [5, '440.0 Hz · +5 cents · in tune'],
    [-5, '440.0 Hz · -5 cents · in tune'],
    [5.6, '440.0 Hz · +6 cents · sharp'],
    [0, '440.0 Hz · 0 cents · in tune'],
  ])('needle %d reads "%s"', (needleCents, detail) => {
    scene(
      { update, view },
      given(hearing(440, needleCents)),
      expect(text(detail)).toExist(),
    )
  })

  test.each([
    [0, '50%'],
    [-80, '0%'],
    [80, '100%'],
    [-12.5, '37.5%'],
  ])('needle %d sits at %s', (needleCents, left) => {
    scene(
      { update, view },
      given(hearing(440, needleCents)),
      expect(needleMarker).toHaveStyle('left', left),
    )
  })

  test('no reading: there is no detail line and no needle marker', () => {
    scene(
      { update, view },
      given(listening({ level: 0.2 })),
      expect(text(/Hz ·/)).toBeAbsent(),
      expect(needleMarker).toBeAbsent(),
      expect(litString).toBeAbsent(),
    )
  })

  test('the level meter reports the level as a percentage', () => {
    scene(
      { update, view },
      given(listening({ level: 0.42 })),
      expect(role('meter', { name: 'Input level' })).toHaveAttr(
        'aria-valuenow',
        '42',
      ),
    )
  })
})

describe('strings', () => {
  test('standard tuning shows six strings, low to high', () => {
    scene(
      { update, view },
      given(listening()),
      expect(role('list', { name: 'Strings' })).toExist(),
      expectAll(strings).toHaveCount(6),
      expect(nth(strings, 0)).toHaveText('E'),
      expect(nth(strings, 1)).toHaveText('A'),
      expect(nth(strings, 5)).toHaveText('E'),
    )
  })

  test('ukulele shows G C E A in that order', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'ukulele')),
      expectAll(strings).toHaveCount(4),
      expect(nth(strings, 0)).toHaveText('G'),
      expect(nth(strings, 1)).toHaveText('C'),
      expect(nth(strings, 2)).toHaveText('E'),
      expect(nth(strings, 3)).toHaveText('A'),
    )
  })

  test('chromatic shows no strings', () => {
    scene(
      { update, view },
      given(withTuning(hearing(110, 0), 'chromatic')),
      expect(role('list', { name: 'Strings' })).toBeAbsent(),
      expect(litString).toBeAbsent(),
    )
  })

  test('a string chip carries its target frequency', () => {
    scene(
      { update, view },
      given(listening()),
      expect(title('82.41 Hz')).toHaveText('E'),
    )
  })

  test('the target frequency follows A4', () => {
    scene(
      { update, view },
      given(modifyFields(listening(), { a4: () => 442 })),
      expect(title('82.78 Hz')).toHaveText('E'),
    )
  })
})

describe('how-to', () => {
  test('the page explains the tuner', () => {
    scene(
      { update, view },
      given(offModel),
      expect(role('heading', { name: 'How to use the tuner' })).toExist(),
      expect(text(/Nothing is recorded\./)).toExist(),
    )
  })
})

describe('controls', () => {
  const tuningPicker = role('button', { name: 'Tuning' })
  const settingsMenu = role('button', { name: 'Tuner settings' })

  test('the picker and the A4 menu are disabled while the tuner is off', () => {
    scene(
      { update, view },
      given(offModel),
      expect(tuningPicker).toBeDisabled(),
      expect(settingsMenu).toBeDisabled(),
    )
  })

  test('the picker and the A4 menu are enabled while listening', () => {
    scene(
      { update, view },
      given(listening()),
      expect(tuningPicker).toBeEnabled(),
      expect(settingsMenu).toBeEnabled(),
    )
  })

  test('the picker shows the chosen tuning', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'drop-d')),
      expect(tuningPicker).toContainText('Guitar - Drop D'),
    )
  })

  test('the strings follow the chosen tuning', () => {
    scene(
      { update, view },
      given(withTuning(listening(), 'bass')),
      expectAll(strings).toHaveCount(4),
      expect(nth(strings, 0)).toHaveText('E'),
      expect(nth(strings, 3)).toHaveText('G'),
    )
  })

  const withOpenSettings = (model: Model): Model =>
    modifyFields(model, {
      a4Popover: () => Popover.open(model.a4Popover).model,
    })

  const acknowledgeSettingsMenu = [
    Mount.resolve(
      Popover.AnchorPopover,
      Popover.Message.CompletedAnchorPopover(),
    ),
    Mount.resolve(
      Popover.PortalPopoverBackdrop,
      Popover.Message.CompletedPortalPopoverBackdrop(),
    ),
  ]

  test('typing a valid A4 in the settings menu applies and saves it', () => {
    scene(
      { update, view },
      given(withOpenSettings(listening())),
      ...acknowledgeSettingsMenu,
      expect(label('A4 (Hz)')).toHaveValue('440'),
      type(label('A4 (Hz)'), '442'),
      Command.expectExact(SavePreferences({ tuningId: 'standard', a4: 442 })),
      Command.resolve(SavePreferences, Message.SucceededSavePreferences()),
      expect(label('A4 (Hz)')).toHaveValue('442'),
      expect(title('82.78 Hz')).toHaveText('E'),
    )
  })

  test('junk in the A4 field is marked invalid and changes nothing', () => {
    scene(
      { update, view },
      given(withOpenSettings(listening())),
      ...acknowledgeSettingsMenu,
      type(label('A4 (Hz)'), '39'),
      Command.expectNone(),
      expect(label('A4 (Hz)')).toHaveAttr('aria-invalid', 'true'),
      expect(title('82.41 Hz')).toHaveText('E'),
    )
  })
})
