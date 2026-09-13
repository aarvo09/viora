/* Client-side voice activity detection — reference implementation.

This is the seam where natural voice turns happen (contract: "VIORA speaks →
listening begins → user speaks → sustained silence → respond"). The full
behaviour is scripted in the demo Session component; this module is where the
real metering-driven logic lives when the user runs it on a device.

Two design rules that cannot be traded away:

  1. NOISE FLOOR: an ambient floor is learned over the first ~500ms of each
     listen window, and only speech above that floor counts. Fan, AC, keyboard
     and room hum must never open a turn (contract: "must not continuously
     trigger because of fan / AC / background noise").
  2. SUSTAINED SILENCE: a turn ends only after SILENCE_MS of sustained silence,
     not on the first quiet tick. That keeps "I think... actually the problem
     started..." as ONE turn and lets fillers (umm, uh, matlab, haan, acha)
     pass without closing.

The audio surface is reached only through the `Recorder` interface below, so the
VAD logic is testable on a laptop with no audio hardware and the adapter is the
only thing that changes if the SDK moves. It has already moved once: this app is
SDK 51, whose audio package is expo-av, not expo-audio.

Metering units. This policy is written against true dBFS: about -50 in a quiet
room, about -20 while speaking, 0 at clipping. Samples reach it already in that
scale — Android's raw values are not (expo-av converts amplitude with a natural
log where decibels want log10), so `toDbfs` in the adapter normalises them
before they ever get here. An earlier version instead clamped samples with
`db > 0 ? db : 0`, which floored every real Android sample to 0 and made silence
indistinguishable from speech — the VAD would have ended a turn immediately on
device.
*/

export const NOISE_FLOOR_MS = 500
/** Sustained silence that ends a turn. 1400ms sits inside the agreed 1.2–1.5s
 *  window: a ~1s thinking pause continues the turn, so "I think... actually it
 *  started when..." stays one turn, and fillers never close it. */
export const SILENCE_MS = 1400
export const SPEECH_MS = 350
export const ATTACK_DB = 6
export const POLL_MS = 80
/** A turn is cut off here even if the person is still speaking, so a stuck
 *  recorder or a hot mic can never hold the call open indefinitely. */
export const MAX_TURN_MS = 45000

/* -- Turn-ending when the platform reports no metering -------------------- *

   expo-av does report metering, on both platforms, whenever the recording was
   prepared with `isMeteringEnabled` (Android fills it in natively from
   MediaRecorder's amplitude; iOS from AVAudioRecorder's average power). So the
   VAD below is the normal path, and this fallback is a genuine fallback.

   It is kept because "no samples" is still reachable and is silent when it
   happens: a device or emulator whose microphone produces no signal, a
   platform (web) with no metering, or a future SDK that drops it. Left
   unhandled that is not a degraded experience but a dead one — no sample means
   no speech onset, so every turn would sit open until MAX_TURN_MS and then
   report silence, with the orb looking alive the whole time. So a listening
   window that has seen no sample by NO_METERING_MS stops waiting for one and
   closes on duration instead, with a visible "Done speaking" affordance the
   person can tap sooner.

   The VAD stays in charge the moment a real sample arrives, so on the hardware
   this ships to, natural turn-taking is what runs. */

/** No metering sample by this point → the platform is not going to send one.
 *  Sits just past NOISE_FLOOR_MS so a working platform finishes calibrating
 *  and is never mistaken for a silent one. */
export const NO_METERING_MS = 600
/** How long a duration-mode window records before closing on its own. Long
 *  enough for a full answer, short enough that a person who has finished is not
 *  left talking to a screen that seems to have stopped caring. */
export const FALLBACK_TURN_MS = 7000

/** How a listening window decided when to stop.
 *  `VAD` — real metering drove it. `DURATION` — no metering; closed on time or
 *  on the person's tap. Surfaced so the UI can offer the tap affordance and so
 *  a device session can be diagnosed from the state alone. */
export type ListenMode = 'VAD' | 'DURATION'

export type Phase = 'IDLE' | 'SPEAKING' | 'LISTENING' | 'THINKING'

/** What the VAD needs from a recorder, and nothing more.
 *
 *  `metering` is true dBFS (negative; see the note at the top of this file) or
 *  undefined when the platform has not produced a sample yet.
 *
 *  `prepareToRecordAsync` is not optional even though it looks like setup. An
 *  expo-av `Audio.Recording` is single-use: `stopAndUnloadAsync()` retires the
 *  object permanently, so a second turn needs a fresh one. Preparing at the top
 *  of every window is what makes that the adapter's problem rather than a
 *  second-turn crash.
 *
 *  `record()` may be synchronous or async — expo-av's `startAsync()` is a
 *  promise, and it is awaited below so a microphone that fails to start surfaces
 *  as an error instead of an unhandled rejection. */
export interface Recorder {
  prepareToRecordAsync(): Promise<void>
  record(): void | Promise<void>
  stop(): Promise<void>
  getStatus(): { metering?: number; isRecording: boolean; url: string | null }
}

/** Where the floor starts before any sample has been seen: a typical quiet
 *  room in dBFS. Calibration moves it to the actual room within ~500ms. */
const INITIAL_FLOOR_DB = -50
/** The floor is never allowed above this. Otherwise a person who starts talking
 *  during calibration teaches the detector that their own voice is silence. */
const MAX_FLOOR_DB = -25

/** A pure VAD state machine over a stream of metering samples.
 *
 *  No audio, no timers, no platform calls — it consumes numbers, which is what
 *  makes the whole turn-taking policy unit-testable. */
export class VoiceActivityDetector {
  private floor = INITIAL_FLOOR_DB
  private calibSamples = 0
  private speechSamples = 0
  private silenceSamples = 0
  private inSpeech = false
  private readonly speechTarget = Math.round(SPEECH_MS / POLL_MS)
  private readonly silenceTarget = Math.round(SILENCE_MS / POLL_MS)
  private readonly calibTarget = Math.round(NOISE_FLOOR_MS / POLL_MS)

  /** Feed one metering sample in dBFS (negative). Returns what it means:
   *  'speech' the moment a turn opens, 'end' once silence has been sustained
   *  long enough to close it, 'silence' otherwise (including mid-speech). */
  update(db: number): 'speech' | 'silence' | 'end' {
    // dBFS as reported. Guard only against a non-finite sample, which some
    // devices emit for the first tick after record() before audio flows.
    const level = Number.isFinite(db) ? db : this.floor
    const above = level > this.floor + ATTACK_DB

    // Learn the room over the first window, then drift slowly while it is quiet
    // so a fan spinning up mid-call raises the floor instead of opening a turn.
    this.calibSamples += 1
    if (this.calibSamples <= this.calibTarget) {
      this.floor = Math.min(MAX_FLOOR_DB, this.floor * 0.7 + level * 0.3)
    } else if (!above && !this.inSpeech) {
      this.floor = Math.min(MAX_FLOOR_DB, this.floor * 0.99 + level * 0.01)
    }

    // Still calibrating: never open a turn on a sample we cannot yet judge.
    if (this.calibSamples <= this.calibTarget) return 'silence'

    if (above) {
      // Any speech-level sample cancels a pending end-of-turn: this is what
      // keeps a mid-sentence pause, and fillers like "umm" or "matlab", inside
      // the same turn rather than closing it.
      this.silenceSamples = 0
      if (!this.inSpeech) {
        this.speechSamples += 1
        if (this.speechSamples >= this.speechTarget) {
          this.inSpeech = true
          return 'speech'
        }
      }
      return 'silence'
    }

    // Below the floor. A brief dip does not undo speech onset, but it does
    // reset the onset counter so a single noise spike cannot accumulate.
    this.speechSamples = 0
    if (this.inSpeech) {
      this.silenceSamples += 1
      if (this.silenceSamples >= this.silenceTarget) {
        this.inSpeech = false
        return 'end'
      }
    }
    return 'silence'
  }

  reset(): void {
    this.floor = INITIAL_FLOOR_DB
    this.calibSamples = 0
    this.speechSamples = 0
    this.silenceSamples = 0
    this.inSpeech = false
  }

  /** True once the person has actually started speaking in this window. Used to
   *  discard an empty turn rather than send silence to the transcriber. */
  get heardSpeech(): boolean {
    return this.inSpeech || this.silenceSamples > 0
  }

  /** Exposed for the developer diagnostics panel only. */
  get noiseFloor(): number {
    return this.floor
  }

  get listening(): boolean {
    return this.inSpeech
  }
}

/** Outcome of one listening window. `mode` says which policy ended it. */
export type ListenResult =
  | { kind: 'speech'; uri: string; mode: ListenMode }
  /** Sustained silence with nothing said — nobody spoke, so nothing to send.
   *  Only ever produced in VAD mode: without metering there is no way to know
   *  the window was empty, so duration mode sends what it captured and lets the
   *  backend's own "no speech detected" be the judge. */
  | { kind: 'silence' }
  /** Closed by MAX_TURN_MS while still speaking; audio is still usable. */
  | { kind: 'cutoff'; uri: string; mode: ListenMode }
  | { kind: 'error'; message: string }

/**
 * Run ONE listening window: record until the person stops speaking, then return
 * the audio file for transcription.
 *
 * The loop that owns this (`useVoiceTurn`) never touches metering itself — it
 * awaits this, sends the uri, plays the reply, and calls it again. That is the
 * whole of "the patient never presses record".
 *
 * `onLevel` is fed every sample so the waveform can move with the actual voice.
 */
export async function listenForTurn(
  recorder: Recorder,
  {
    onLevel,
    onSpeechStart,
    onMode,
    signal,
    done,
    fallbackMs = FALLBACK_TURN_MS,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  }: {
    onLevel?: (db: number, floor: number) => void
    onSpeechStart?: () => void
    /** Fires once, as soon as the window knows which policy is ending it. The UI
     *  uses this to show the "Done speaking" tap only when it is the only way to
     *  finish early. */
    onMode?: (mode: ListenMode) => void
    signal?: { aborted: boolean }
    /** The person tapped "Done speaking". Ends a duration-mode window early;
     *  ignored in VAD mode, where sustained silence is the signal. */
    done?: { tapped: boolean }
    fallbackMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<ListenResult> {
  const vad = new VoiceActivityDetector()

  // Prepare before every window: `stop()` leaves the recorder unprepared, so
  // without this the second turn of a call throws instead of recording.
  try {
    await recorder.prepareToRecordAsync()
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Could not prepare the microphone',
    }
  }

  const startedAt = now()
  try {
    await recorder.record()
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Could not start the microphone' }
  }

  let mode: ListenMode | null = null
  const enter = (next: ListenMode) => {
    if (mode) return
    mode = next
    onMode?.(next)
  }

  let outcome: 'speech' | 'silence' | 'cutoff' = 'silence'
  try {
    for (;;) {
      await sleep(POLL_MS)
      if (signal?.aborted) {
        outcome = 'silence'
        break
      }

      const status = recorder.getStatus()
      const db = status.metering
      const elapsed = now() - startedAt

      if (typeof db === 'number') {
        // A real sample: metering works here, so the VAD owns this window even
        // if the no-metering deadline has already passed.
        enter('VAD')
        const verdict = vad.update(db)
        onLevel?.(db, vad.noiseFloor)
        if (verdict === 'speech') onSpeechStart?.()
        if (verdict === 'end') {
          outcome = 'speech'
          break
        }
      } else if (elapsed >= NO_METERING_MS) {
        // No sample by now means none is coming. Close on duration, or as soon
        // as the person says they are finished.
        if (mode === null) {
          enter('DURATION')
          // Nothing else will announce speech in this mode, and the UI needs to
          // leave its "VIORA is speaking" state to show it is listening.
          onSpeechStart?.()
        }
        if (done?.tapped || elapsed >= fallbackMs) {
          outcome = 'speech'
          break
        }
      }

      if (elapsed >= MAX_TURN_MS) {
        outcome = mode === 'DURATION' ? 'cutoff' : vad.heardSpeech ? 'cutoff' : 'silence'
        break
      }
    }
  } catch (err) {
    try {
      await recorder.stop()
    } catch {
      /* already stopping */
    }
    return { kind: 'error', message: err instanceof Error ? err.message : 'Microphone failed' }
  }

  let uri: string | null = null
  try {
    await recorder.stop()
    uri = recorder.getStatus().url
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Could not finish recording' }
  }

  if (outcome === 'silence' || !uri) return { kind: 'silence' }
  const ended: ListenMode = mode ?? 'VAD'
  return outcome === 'cutoff' ? { kind: 'cutoff', uri, mode: ended } : { kind: 'speech', uri, mode: ended }
}
