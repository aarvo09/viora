/* Turn-taking policy tests — the behaviour the voice call lives or dies on.
 *
 * These run with no audio hardware and no device, because the VAD is a pure
 * state machine over dBFS numbers. That separation is the point: the thing that
 * decides when a person has finished speaking is the thing most likely to be
 * wrong, and it is the hardest to test on a phone.
 *
 * The scenarios are the ones from the spec, in the spec's own terms: a fan must
 * never open a turn, a 300/700/1000ms pause must not end one, and ~1.4s of
 * sustained silence must.
 *
 * Run: npm test
 */

import { describe, expect, it } from 'vitest'
import {
  ATTACK_DB,
  FALLBACK_TURN_MS,
  MAX_TURN_MS,
  NO_METERING_MS,
  POLL_MS,
  SILENCE_MS,
  VoiceActivityDetector,
  listenForTurn,
  type ListenMode,
  type Recorder,
} from './useVAD'

/** Realistic Android dBFS levels. */
const QUIET_ROOM = -50
const FAN = -46 // steady, a few dB above the floor but under the attack threshold
const SPEECH = -18
const LOUD_SPEECH = -12

const ticks = (ms: number) => Math.round(ms / POLL_MS)

/** Feed n samples at one level, returning every verdict. */
function feed(vad: VoiceActivityDetector, db: number, ms: number): string[] {
  const out: string[] = []
  for (let i = 0; i < ticks(ms); i++) out.push(vad.update(db))
  return out
}

/** Settle the noise floor on a room level, as happens at the start of a window. */
function calibrate(vad: VoiceActivityDetector, room = QUIET_ROOM) {
  feed(vad, room, 600)
}

describe('noise floor', () => {
  it('never opens a turn on a quiet room', () => {
    const vad = new VoiceActivityDetector()
    const verdicts = feed(vad, QUIET_ROOM, 5000)
    expect(verdicts).not.toContain('speech')
    expect(verdicts).not.toContain('end')
  })

  it('never opens a turn on a steady fan', () => {
    // The scenario from the spec: continuous mechanical noise, minutes of it.
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    const verdicts = feed(vad, FAN, 60000)
    expect(verdicts).not.toContain('speech')
  })

  it('adapts when the room gets louder mid-call', () => {
    // An AC switching on raises the floor rather than reading as speech.
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    feed(vad, FAN, 10000)
    expect(vad.noiseFloor).toBeGreaterThan(QUIET_ROOM)
    expect(feed(vad, FAN, 5000)).not.toContain('speech')
  })

  it('does not learn a talking voice as the floor', () => {
    // Someone already mid-sentence when the window opens must still be heard.
    const vad = new VoiceActivityDetector()
    const verdicts = feed(vad, SPEECH, 3000)
    expect(verdicts).toContain('speech')
  })

  it('ignores a non-finite sample instead of treating it as loud', () => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    expect(vad.update(NaN)).toBe('silence')
    expect(vad.update(Infinity)).toBe('silence')
  })
})

describe('speech onset', () => {
  it('opens a turn when the person speaks', () => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    expect(feed(vad, SPEECH, 1000)).toContain('speech')
  })

  it('does not open a turn on a single click or thud', () => {
    // One keyboard tap is a spike, not speech: it must not survive the onset
    // requirement, and it must not accumulate across separate spikes either.
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    for (let i = 0; i < 8; i++) {
      expect(vad.update(LOUD_SPEECH)).toBe('silence') // one tick only
      feed(vad, QUIET_ROOM, 400)
    }
  })
})

describe('sustained silence ends the turn', () => {
  it.each([
    ['300ms', 300],
    ['700ms', 700],
    ['1000ms', 1000],
  ])('a %s pause does NOT end the turn', (_label, pause) => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    feed(vad, SPEECH, 1000)
    expect(feed(vad, QUIET_ROOM, pause)).not.toContain('end')
  })

  it(`ends after ${SILENCE_MS}ms of sustained silence`, () => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    feed(vad, SPEECH, 1000)
    expect(feed(vad, QUIET_ROOM, SILENCE_MS + POLL_MS * 2)).toContain('end')
  })

  it('keeps a filler word inside the same turn', () => {
    // "I think... umm... actually it started when..." — one turn, not three.
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    feed(vad, SPEECH, 800)
    const verdicts = [
      ...feed(vad, QUIET_ROOM, 600), // thinking
      ...feed(vad, SPEECH, 250), // "umm"
      ...feed(vad, QUIET_ROOM, 900), // thinking again
      ...feed(vad, SPEECH, 1200), // continues
    ]
    expect(verdicts).not.toContain('end')
  })

  it('the silence timer restarts after each pause, not accumulating', () => {
    // Three 800ms pauses total 2400ms, well past the threshold — but none of
    // them is sustained, so the turn must still be open.
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    feed(vad, SPEECH, 600)
    const verdicts: string[] = []
    for (let i = 0; i < 3; i++) {
      verdicts.push(...feed(vad, QUIET_ROOM, 800))
      verdicts.push(...feed(vad, SPEECH, 300))
    }
    expect(verdicts).not.toContain('end')
  })

  it('ends only once, not on every subsequent quiet tick', () => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    feed(vad, SPEECH, 800)
    const verdicts = feed(vad, QUIET_ROOM, SILENCE_MS + 2000)
    expect(verdicts.filter((v) => v === 'end')).toHaveLength(1)
  })

  it('does not end a turn that never started', () => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    expect(feed(vad, QUIET_ROOM, 10000)).not.toContain('end')
  })
})

describe('attack threshold', () => {
  it('requires speech to exceed the floor by the attack margin', () => {
    const vad = new VoiceActivityDetector()
    calibrate(vad)
    const justUnder = vad.noiseFloor + ATTACK_DB - 1
    expect(feed(vad, justUnder, 3000)).not.toContain('speech')
  })
})

/* ------------------------------------------------------------------------- */

/** A scripted recorder: replays a level timeline, no audio involved.
 *
 *  `levels` may contain `undefined` to model a platform that reports no
 *  metering — an emulator or device whose microphone produces no signal at all,
 *  or a platform (web) that has no metering to report. */
function fakeRecorder(
  levels: (number | undefined)[],
  url = 'file:///turn.m4a',
): Recorder & { stopped: boolean; prepared: number } {
  let i = 0
  let recording = false
  return {
    stopped: false,
    prepared: 0,
    async prepareToRecordAsync() {
      this.prepared += 1
    },
    record() {
      recording = true
    },
    async stop() {
      recording = false
      this.stopped = true
    },
    getStatus() {
      const metering = i < levels.length ? levels[i++] : levels[levels.length - 1]
      return { metering, isRecording: recording, url: recording ? null : url }
    },
  }
}

/** A recorder that never reports a level, like a real device on this SDK. */
const silentMeterRecorder = (url?: string) => fakeRecorder([undefined], url)

const level = (db: number, ms: number) => new Array(ticks(ms)).fill(db)

/** No real timers: the clock is injected, so these run in microseconds.
 *
 *  A fresh clock per call — sharing one across tests would leak elapsed time
 *  and silently push a later window straight past its deadlines. */
const fastClock = () => ({
  sleep: async () => {},
  now: (() => {
    let t = 0
    return () => (t += POLL_MS)
  })(),
})

describe('listenForTurn', () => {
  const fast = fastClock()

  it('returns the recording after the person stops speaking', async () => {
    const rec = fakeRecorder([
      ...level(QUIET_ROOM, 600),
      ...level(SPEECH, 1500),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    const result = await listenForTurn(rec, { ...fast })
    expect(result.kind).toBe('speech')
    expect(rec.stopped).toBe(true)
  })

  it('reports silence when nobody speaks, so nothing is sent to be transcribed', async () => {
    const rec = fakeRecorder(level(QUIET_ROOM, MAX_TURN_MS + 1000))
    const result = await listenForTurn(rec, { ...fast })
    expect(result.kind).toBe('silence')
  })

  it('a fan alone produces silence, not a turn', async () => {
    const rec = fakeRecorder(level(FAN, MAX_TURN_MS + 1000))
    expect((await listenForTurn(rec, { ...fast })).kind).toBe('silence')
  })

  it('cuts off an endless turn but keeps the audio', async () => {
    const rec = fakeRecorder([...level(QUIET_ROOM, 600), ...level(SPEECH, MAX_TURN_MS + 5000)])
    const result = await listenForTurn(rec, { ...fast })
    expect(result.kind).toBe('cutoff')
    if (result.kind === 'cutoff') expect(result.uri).toBeTruthy()
  })

  it('surfaces a refused microphone as an error rather than hanging', async () => {
    const rec = fakeRecorder(level(SPEECH, 1000))
    rec.record = () => {
      throw new Error('Recording permission denied')
    }
    const result = await listenForTurn(rec, { ...fast })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/permission/i)
  })

  it('stops immediately when the call is ended mid-turn', async () => {
    const rec = fakeRecorder(level(SPEECH, 60000))
    const signal = { aborted: false }
    const promise = listenForTurn(rec, { ...fast, signal })
    signal.aborted = true
    expect((await promise).kind).toBe('silence')
    expect(rec.stopped).toBe(true)
  })

  it('feeds levels out for the waveform', async () => {
    const seen: number[] = []
    const rec = fakeRecorder([
      ...level(QUIET_ROOM, 600),
      ...level(SPEECH, 800),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    await listenForTurn(rec, { ...fast, onLevel: (db) => seen.push(db) })
    expect(seen.length).toBeGreaterThan(10)
    expect(Math.max(...seen)).toBeGreaterThan(QUIET_ROOM)
  })

  it('announces speech onset once so the UI can switch state', async () => {
    let starts = 0
    const rec = fakeRecorder([
      ...level(QUIET_ROOM, 600),
      ...level(SPEECH, 1200),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    await listenForTurn(rec, { ...fast, onSpeechStart: () => starts++ })
    expect(starts).toBe(1)
  })

  it('reports VAD mode when the platform does report levels', async () => {
    const modes: ListenMode[] = []
    const rec = fakeRecorder([
      ...level(QUIET_ROOM, 600),
      ...level(SPEECH, 1000),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    const result = await listenForTurn(rec, {
      ...fastClock(),
      onMode: (m) => modes.push(m),
    })
    expect(modes).toEqual(['VAD'])
    if (result.kind === 'speech') expect(result.mode).toBe('VAD')
  })
})

/* ------------------------------------------------------------------------- */

/* The turn loop must survive a platform that reports no metering at all. expo-av
   does report it on both Android and iOS, so this is no longer the expected
   path — but it stays reachable and is silent when it happens: a microphone
   that yields no signal, an emulator with no audio input wired up, or a future
   SDK that drops the field. Without the duration fallback every window would run
   to MAX_TURN_MS and report silence, so the call would look alive and never take
   a single turn. */
describe('no metering available (no mic signal, or a platform without levels)', () => {
  it('still ends a turn, on duration rather than on silence', async () => {
    const rec = silentMeterRecorder()
    const result = await listenForTurn(rec, { ...fastClock() })
    expect(result.kind).toBe('speech')
    if (result.kind === 'speech') {
      expect(result.mode).toBe('DURATION')
      expect(result.uri).toBeTruthy()
    }
    expect(rec.stopped).toBe(true)
  })

  it('announces DURATION mode so the UI can offer "Done speaking"', async () => {
    const modes: ListenMode[] = []
    await listenForTurn(silentMeterRecorder(), {
      ...fastClock(),
      onMode: (m) => modes.push(m),
    })
    // Once only: the UI must not flicker the affordance on every poll.
    expect(modes).toEqual(['DURATION'])
  })

  it('leaves the speaking state so the person knows it is their turn', async () => {
    // With no levels there is no onset to detect, but the orb still has to stop
    // looking like VIORA is talking — otherwise nobody knows to speak.
    let starts = 0
    await listenForTurn(silentMeterRecorder(), {
      ...fastClock(),
      onSpeechStart: () => starts++,
    })
    expect(starts).toBe(1)
  })

  it('waits out the fallback window rather than closing instantly', async () => {
    // A turn that ends the moment listening opens would cut the person off
    // before they had said anything.
    const clock = fastClock()
    let elapsed = 0
    await listenForTurn(silentMeterRecorder(), {
      sleep: clock.sleep,
      now: () => (elapsed = clock.now()),
    })
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_TURN_MS)
  })

  it('ends early when the person taps "Done speaking"', async () => {
    const done = { tapped: true }
    const clock = fastClock()
    let elapsed = 0
    const result = await listenForTurn(silentMeterRecorder(), {
      sleep: clock.sleep,
      now: () => (elapsed = clock.now()),
      done,
    })
    expect(result.kind).toBe('speech')
    // Closed on the tap, well inside the fallback window.
    expect(elapsed).toBeLessThan(FALLBACK_TURN_MS)
    expect(elapsed).toBeGreaterThanOrEqual(NO_METERING_MS)
  })

  it('ignores a tap that arrives before listening has opened', async () => {
    // The deadline still has to pass: a stray tap must not send an empty clip.
    const clock = fastClock()
    let elapsed = 0
    await listenForTurn(silentMeterRecorder(), {
      sleep: clock.sleep,
      now: () => (elapsed = clock.now()),
      done: { tapped: true },
    })
    expect(elapsed).toBeGreaterThanOrEqual(NO_METERING_MS)
  })

  it('honours a shorter fallback window when one is configured', async () => {
    const clock = fastClock()
    let elapsed = 0
    const result = await listenForTurn(silentMeterRecorder(), {
      sleep: clock.sleep,
      now: () => (elapsed = clock.now()),
      fallbackMs: 2000,
    })
    expect(result.kind).toBe('speech')
    expect(elapsed).toBeGreaterThanOrEqual(2000)
    expect(elapsed).toBeLessThan(FALLBACK_TURN_MS)
  })

  it('still aborts immediately when the call is ended', async () => {
    const rec = silentMeterRecorder()
    const signal = { aborted: true }
    const result = await listenForTurn(rec, { ...fastClock(), signal })
    expect(result.kind).toBe('silence')
    expect(rec.stopped).toBe(true)
  })

  it('hands over to the VAD if a level ever does arrive', async () => {
    // A newer SDK, or a platform that reports levels: the fallback must not
    // have taken permanent ownership of turn-ending.
    const modes: ListenMode[] = []
    const rec = fakeRecorder([
      ...level(QUIET_ROOM, 700), // real samples from the first tick
      ...level(SPEECH, 1000),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    const clock = fastClock()
    let elapsed = 0
    const result = await listenForTurn(rec, {
      sleep: clock.sleep,
      now: () => (elapsed = clock.now()),
      onMode: (m) => modes.push(m),
    })
    expect(modes).toEqual(['VAD'])
    if (result.kind === 'speech') expect(result.mode).toBe('VAD')
    // Ended on sustained silence, not by waiting out the duration window.
    expect(elapsed).toBeLessThan(FALLBACK_TURN_MS)
  })

  it('lets the VAD win even when levels start after the no-metering deadline', async () => {
    // A device that is slow to produce its first sample must still get natural
    // turn-taking rather than being locked into duration mode.
    const modes: ListenMode[] = []
    const rec = fakeRecorder([
      ...new Array(ticks(NO_METERING_MS + 400)).fill(undefined),
      ...level(QUIET_ROOM, 600),
      ...level(SPEECH, 1000),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    const result = await listenForTurn(rec, { ...fastClock(), onMode: (m) => modes.push(m) })
    // DURATION was entered first — no sample had arrived — but the real samples
    // take over, and the window ends on silence with the VAD's verdict.
    expect(modes).toEqual(['DURATION'])
    expect(result.kind).toBe('speech')
  })
})

describe('recorder preparation', () => {
  /* An expo-av `Audio.Recording` is single-use: `stopAndUnloadAsync()` retires
     it permanently, so a window that does not prepare a fresh recorder first
     throws on the second turn of a call — the conversation would end after one
     exchange. */

  it('prepares the recorder before every window', async () => {
    const rec = fakeRecorder([
      ...level(QUIET_ROOM, 600),
      ...level(SPEECH, 800),
      ...level(QUIET_ROOM, SILENCE_MS + 400),
    ])
    await listenForTurn(rec, { ...fastClock() })
    expect(rec.prepared).toBe(1)
  })

  it('prepares again for a second turn on the same recorder', async () => {
    const rec = silentMeterRecorder()
    await listenForTurn(rec, { ...fastClock() })
    await listenForTurn(rec, { ...fastClock() })
    expect(rec.prepared).toBe(2)
  })

  it('surfaces a failed preparation as an error and does not record', async () => {
    const rec = silentMeterRecorder()
    let recorded = false
    rec.prepareToRecordAsync = async () => {
      throw new Error('Recorder is busy')
    }
    rec.record = () => {
      recorded = true
    }
    const result = await listenForTurn(rec, { ...fastClock() })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toMatch(/busy/i)
    expect(recorded).toBe(false)
  })
})
