/* The voice turn loop — where "the patient never presses record" actually happens.

    VIORA speaks → playback ends → mic opens → person speaks → sustained silence
    → mic closes → upload → backend replies → VIORA speaks → repeat

This module owns the audio surface (recording, metering, playback) and nothing
else. The turn-ending POLICY lives in `useVAD.ts` as a pure state machine over
numbers, so it can be unit-tested with no audio hardware; this file is the
adapter that feeds it real samples.

Two things it deliberately does NOT do:

  * It does not decide what VIORA says. It uploads audio and plays what comes
    back, so a vendor or model change never touches this file.
  * It does not retry a failed turn on its own. A person waiting in silence
    while we retry invisibly is worse than being told plainly that something
    went wrong, so the error surfaces and the loop pauses for a tap.

Android permission: recording throws if the microphone was refused, which is
caught and surfaced as a normal error state rather than a crash.

--- Why expo-av and not expo-audio -----------------------------------------

This app is Expo SDK 51, and expo-audio is not part of it. SDK 51's audio
package is expo-av (`expo/bundledNativeModules.json` pins `expo-av: ~14.0.7`
and lists no expo-audio at all). expo-audio first shipped with SDK 52 against
expo-modules-core 2.x, so on core 1.12.26 it does not merely misbehave — it
does not compile: `AudioModule.kt` calls `appContext.throwingActivity` and
`AudioPlayer.kt` calls `emit`, neither of which exists in this core.

That matters for turn-taking, because expo-audio 0.2.4 also never enabled
metering on either platform. expo-av does, natively and on both:
`AVManager.getAudioRecorderStatus()` puts a `metering` value in the status
whenever `isMeteringEnabled` is set. So the VAD gets real samples here and
natural turn-taking is the normal path, not the fallback.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av'
import * as FileSystem from 'expo-file-system'
import { extensionFor } from './audioFormat'
import { ApiError, api } from '../api/client'
import type { AudioSentence, TurnResponse } from '../api/types'
import { POLL_MS, listenForTurn, type ListenMode, type Recorder } from './useVAD'

export type VoicePhase = 'CONNECTING' | 'SPEAKING' | 'LISTENING' | 'THINKING' | 'ERROR' | 'ENDED'

export interface VoiceTurnState {
  phase: VoicePhase
  /** Newest-last conversation text, for the subtitles under the orb. */
  messages: { role: 'USER' | 'VIORA'; text: string }[]
  /** 0..1, driven by real metering. The waveform reads this. */
  level: number
  error: string | null
  crisis: boolean
  muted: boolean
  /** Diagnostics — rendered only behind the __DEV__ panel. */
  noiseFloor: number
  /** How the current listening window will end. `DURATION` means the platform
   *  reported no levels, so the person needs a way to say they have finished:
   *  the UI must show the "Done speaking" tap whenever this is DURATION and the
   *  phase is LISTENING. Null before the first window has decided. */
  listenMode: ListenMode | null
}

/** Recording tuned for speech, not music: mono, 16kHz.
 *
 *  Built from HIGH_QUALITY rather than assembled field by field, because
 *  expo-av warns that not every combination of codec options can actually be
 *  prepared — the preset is a known-good base, and only the speech-shaped
 *  fields are overridden. HIGH_QUALITY already sets `isMeteringEnabled: true`;
 *  it is repeated here because the VAD is useless without it, and a silent
 *  regression in a future preset would be expensive to find. */
const SPEECH_RECORDING: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
}

/** Convert a platform metering sample to true dBFS, the scale `useVAD.ts` is
 *  written against (~-50 in a quiet room, ~-20 while speaking, 0 at clipping).
 *
 *  iOS already reports that scale. Android does not, and the discrepancy is
 *  easy to miss: `AVManager.getAudioRecorderLevels()` returns
 *  `20 * Math.log(amplitude / 32767)` — a NATURAL log, where the decibel
 *  definition calls for log10. Every Android sample therefore arrives stretched
 *  by a factor of ln(10) ≈ 2.303, so a quiet room reads about -116 instead of
 *  -50 and silence reads -160.
 *
 *  Left unconverted the VAD still runs, but none of its constants mean what
 *  they say: ATTACK_DB of 6 would be a 1.35x rise in amplitude rather than the
 *  intended 2x, making the detector noticeably more eager to call fan or AC
 *  noise the start of a turn — the one behaviour the contract says must never
 *  happen. Dividing by ln(10) restores real dBFS: -116 → -50, -46 → -20. */
function toDbfs(raw: number): number {
  return Platform.OS === 'android' ? raw / Math.LN10 : raw
}

/** dBFS → 0..1 for the waveform. -50 (quiet room) reads as 0, -10 as full. */
function levelFromDb(db: number, floor: number): number {
  const span = Math.max(12, -floor)
  return Math.max(0, Math.min(1, (db - floor) / span))
}

/** The expo-av implementation of the `Recorder` seam the VAD polls.
 *
 *  Two expo-av facts shape this class:
 *
 *  1. A `Audio.Recording` is single-use. `stopAndUnloadAsync()` retires the
 *     object for good, so every listening window needs a brand new one — which
 *     is exactly what `listenForTurn` already does by calling
 *     `prepareToRecordAsync()` at the top of each window.
 *  2. Status is asynchronous (`getStatusAsync`), but the VAD polls a synchronous
 *     `getStatus()`. So the recorder samples itself on its own interval and the
 *     VAD reads the latest snapshot. The interval is POLL_MS, matching the
 *     cadence the VAD's sample-counted timings assume; relying instead on
 *     `setOnRecordingStatusUpdate` would tie those timings to the native push
 *     rate, which defaults to 500ms and would stretch a 1.4s silence window
 *     into about nine seconds.
 */
class AvRecorder implements Recorder {
  private rec: Audio.Recording | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private snapshot: { metering?: number; isRecording: boolean; url: string | null } = {
    metering: undefined,
    isRecording: false,
    url: null,
  }

  async prepareToRecordAsync(): Promise<void> {
    // A window that errored mid-flight can leave a recorder loaded; releasing it
    // first keeps a failed turn from poisoning every turn after it.
    await this.release()
    this.snapshot = { metering: undefined, isRecording: false, url: null }
    const rec = new Audio.Recording()
    await rec.prepareToRecordAsync(SPEECH_RECORDING)
    this.rec = rec
  }

  async record(): Promise<void> {
    if (!this.rec) throw new Error('The microphone was not prepared')
    await this.rec.startAsync()
    this.snapshot = { ...this.snapshot, isRecording: true }
    this.timer = setInterval(() => {
      void this.sample()
    }, POLL_MS)
  }

  /** One status read into the snapshot. A missing `metering` keeps the previous
   *  value rather than blanking it: a single dropped sample must not read as
   *  "this platform has no metering" and hand the window to the duration
   *  fallback. Until the FIRST sample arrives the value stays undefined, which
   *  is what legitimately triggers that fallback. */
  private async sample(): Promise<void> {
    const rec = this.rec
    if (!rec) return
    try {
      const status = await rec.getStatusAsync()
      this.snapshot = {
        metering:
          typeof status.metering === 'number' ? toDbfs(status.metering) : this.snapshot.metering,
        isRecording: status.isRecording,
        url: this.snapshot.url,
      }
    } catch {
      /* The window is closing underneath us; the next stop() settles it. */
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const rec = this.rec
    if (!rec) return
    this.rec = null
    try {
      await rec.stopAndUnloadAsync()
    } finally {
      // getURI() still resolves after unloading — this is the documented expo-av
      // order, and it is the only way to learn where the audio landed.
      this.snapshot = { ...this.snapshot, isRecording: false, url: rec.getURI() }
    }
  }

  /** Best-effort teardown for cleanup paths, where a throw would be noise. */
  async release(): Promise<void> {
    try {
      await this.stop()
    } catch {
      /* nothing was recording */
    }
  }

  getStatus() {
    return this.snapshot
  }
}

/* The container sniffing lives in ./audioFormat, so it can be tested without
   pulling expo-av and a renderer into the test process. */

/** Write one base64 clip to a real file and hand back its uri.
 *
 *  The clips arrive as base64 and could in principle be played from a `data:`
 *  uri, but Android playback of those depends on which data-scheme sources the
 *  underlying ExoPlayer build happens to register — a demo is the wrong place
 *  to find out. A cache file is unambiguous on both platforms, and
 *  expo-file-system is already pinned by this SDK, so it costs no dependency.
 *
 *  The index keeps concurrent sentences in one reply from colliding on a name. */
async function clipToFile(base64: string, index: number): Promise<string> {
  const uri = `${FileSystem.cacheDirectory}viora-tts-${index}${extensionFor(base64)}`
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return uri
}

export function useVoiceTurn({
  uid,
  language,
  enabled,
  onEnded,
}: {
  uid: string
  language: string
  enabled: boolean
  onEnded?: (interactionId: number) => void
}) {
  /** One recorder for the whole call. Held in a ref because the VAD polls it —
   *  a value that changed identity on render would be a different microphone. */
  const recorderRef = useRef<AvRecorder | null>(null)
  if (!recorderRef.current) recorderRef.current = new AvRecorder()

  const [state, setState] = useState<VoiceTurnState>({
    phase: 'CONNECTING',
    messages: [],
    level: 0,
    error: null,
    crisis: false,
    muted: false,
    noiseFloor: -50,
    listenMode: null,
  })
  const [interactionId, setInteractionId] = useState<number | null>(null)

  const abort = useRef({ aborted: false })
  const mutedRef = useRef(false)
  const playerRef = useRef<Audio.Sound | null>(null)
  const loopRunning = useRef(false)
  /** Set by `finishSpeaking()`, read by the active listening window. A ref, not
   *  state, because the window polls it — a re-render would not reach it. */
  const doneTapped = useRef({ tapped: false })

  const patch = useCallback((next: Partial<VoiceTurnState>) => {
    setState((prev) => ({ ...prev, ...next }))
  }, [])

  const say = useCallback((role: 'USER' | 'VIORA', text: string) => {
    if (!text.trim()) return
    setState((prev) => ({ ...prev, messages: [...prev.messages, { role, text }] }))
  }, [])

  /* ---------------------------------------------------------- playback --- */

  /** Speak the reply, sentence by sentence, and resolve when the voice stops.
   *
   *  Sentence chunking is what makes the reply start playing before the whole
   *  utterance has been synthesised. If a sentence has no audio (TTS degraded)
   *  it is skipped rather than faked with silence — the subtitle still shows, so
   *  the conversation survives a TTS outage as text. */
  const speak = useCallback(async (sentences: AudioSentence[]) => {
    for (const sentence of sentences) {
      if (abort.current.aborted) return
      if (!sentence.audio_b64) continue

      let file: string | null = null
      try {
        file = await clipToFile(sentence.audio_b64, sentence.index)
      } catch {
        // Could not stage the audio. The subtitle already carries the words, so
        // skip the clip rather than abandoning the reply.
        continue
      }
      if (abort.current.aborted) return

      await new Promise<void>((resolve) => {
        let done = false
        let sound: Audio.Sound | null = null
        let backstop: ReturnType<typeof setTimeout> | null = null

        const finish = () => {
          if (done) return
          done = true
          if (backstop) clearTimeout(backstop)
          const staged = file
          void (async () => {
            try {
              await sound?.unloadAsync()
            } catch {
              /* already released */
            }
            try {
              if (staged) await FileSystem.deleteAsync(staged, { idempotent: true })
            } catch {
              /* the cache directory is allowed to keep it */
            }
          })()
          resolve()
        }

        void (async () => {
          try {
            // The status callback is passed to createAsync rather than attached
            // afterwards: playback starts inside this call, and a short clip can
            // finish before a later setOnPlaybackStatusUpdate would have been
            // registered — which would hang the loop on a missed didJustFinish.
            const { sound: created } = await Audio.Sound.createAsync(
              { uri: file as string },
              { shouldPlay: true, volume: mutedRef.current ? 0 : 1 },
              (status) => {
                if (!status.isLoaded) return
                if (status.didJustFinish) finish()
              },
            )
            sound = created
            playerRef.current = created
            if (abort.current.aborted) finish()
          } catch {
            finish()
            return
          }

          // Backstop: a dropped status event must never deadlock the loop and
          // leave the person sitting in front of a silent screen. Scaled to the
          // sentence so a long reply is not cut off mid-word.
          backstop = setTimeout(finish, Math.min(30000, 4000 + sentence.text.length * 120))
        })()
      })
    }
  }, [])

  /* ------------------------------------------------------------- turns --- */

  /** One full cycle: listen, upload, speak. Returns false to stop the loop. */
  const runOneTurn = useCallback(async (): Promise<boolean> => {
    const recorder = recorderRef.current
    if (!interactionId || !recorder || abort.current.aborted) return false

    doneTapped.current = { tapped: false }
    patch({ phase: 'LISTENING', level: 0 })
    const heard = await listenForTurn(recorder, {
      signal: abort.current,
      done: doneTapped.current,
      onLevel: (db, floor) => patch({ level: levelFromDb(db, floor), noiseFloor: floor }),
      onMode: (listenMode) => patch({ listenMode }),
    })

    if (abort.current.aborted) return false

    if (heard.kind === 'error') {
      patch({ phase: 'ERROR', error: heard.message, level: 0 })
      return false
    }
    // Nobody spoke. Listen again rather than sending silence to be transcribed:
    // a person gathering their thoughts is not a finished turn.
    if (heard.kind === 'silence') return true

    patch({ phase: 'THINKING', level: 0 })
    let res: TurnResponse
    try {
      res = await api.voiceTurn(interactionId, heard.uri, language)
    } catch (err) {
      // 422 is the backend saying it found no speech in that audio. Listening
      // again is the right response; stopping the call would not be. This stays
      // reachable with metering working: a duration-mode window (no levels) or a
      // turn where someone opened the mic and then said nothing both land here.
      if (err instanceof ApiError && err.status === 422) return true
      patch({
        phase: 'ERROR',
        error: err instanceof Error ? err.message : 'Could not reach VIORA',
        level: 0,
      })
      return false
    }

    if (abort.current.aborted) return false
    if (res.transcript) say('USER', res.transcript)
    say('VIORA', res.reply_text)
    if (res.crisis_detected) patch({ crisis: true })

    patch({ phase: 'SPEAKING' })
    await speak(res.sentences)
    return !abort.current.aborted
  }, [interactionId, language, patch, say, speak])

  /* -------------------------------------------------------- open + run --- */

  useEffect(() => {
    if (!enabled) return
    abort.current = { aborted: false }
    let alive = true

    ;(async () => {
      try {
        // Ask for the microphone before anything else; on Android a refusal here
        // is the difference between a clear message and a silent dead screen.
        const permission = await Audio.requestPermissionsAsync()
        if (!permission.granted) {
          patch({
            phase: 'ERROR',
            error: 'VIORA needs microphone access for a voice check-in. You can use text instead.',
          })
          return
        }
        // Keep playing through the speaker while the mic is open, and do not let
        // recording duck VIORA's own voice.
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        })

        const opened = await api.openInteraction(uid, 'VOICE')
        if (!alive) return
        setInteractionId(opened.interaction_id)
        say('VIORA', opened.opening_message)
        patch({ phase: 'SPEAKING' })
        if (opened.opening_audio_b64) {
          await speak([
            { index: 0, text: opened.opening_message, audio_b64: opened.opening_audio_b64 },
          ])
        }
      } catch (err) {
        if (alive) {
          patch({
            phase: 'ERROR',
            error: err instanceof Error ? err.message : 'Could not start the check-in',
          })
        }
      }
    })()

    return () => {
      alive = false
      abort.current.aborted = true
      void recorderRef.current?.release()
      void playerRef.current?.unloadAsync().catch(() => {})
    }
  }, [enabled, uid, patch, say, speak])

  /* Drive the loop once the opening line has been spoken. A single runner:
     re-entering would open two recorders on the same microphone. */
  useEffect(() => {
    if (!enabled || interactionId == null) return
    if (state.phase !== 'SPEAKING' || loopRunning.current) return

    loopRunning.current = true
    ;(async () => {
      try {
        for (;;) {
          const again = await runOneTurn()
          if (!again) break
        }
      } finally {
        loopRunning.current = false
      }
    })()
  }, [enabled, interactionId, state.phase, runOneTurn])

  /* ----------------------------------------------------------- controls --- */

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted
    void playerRef.current?.setVolumeAsync(muted ? 0 : 1).catch(() => {})
    setState((prev) => ({ ...prev, muted }))
  }, [])

  /** "Done speaking" — ends the current listening window now.
   *
   *  Only meaningful while `listenMode` is DURATION: with no metering the app
   *  cannot hear that the person has stopped, so this tap is the only way to
   *  finish a turn before the timer. Harmless in VAD mode, where sustained
   *  silence ends the turn on its own. */
  const finishSpeaking = useCallback(() => {
    doneTapped.current.tapped = true
  }, [])

  /** End the call and write the report. The abort flag stops the loop first so
   *  no turn lands after the interaction has been completed. */
  const end = useCallback(async (): Promise<number | null> => {
    abort.current.aborted = true
    await recorderRef.current?.release()
    try {
      await playerRef.current?.unloadAsync()
    } catch {
      /* already gone */
    }
    if (interactionId == null) return null
    try {
      const res = await api.complete(interactionId)
      patch({ phase: 'ENDED' })
      onEnded?.(interactionId)
      return res.report_version
    } catch (err) {
      patch({ phase: 'ERROR', error: err instanceof Error ? err.message : 'Could not finish' })
      return null
    }
  }, [interactionId, onEnded, patch])

  return { ...state, interactionId, setMuted, finishSpeaking, end, pollMs: POLL_MS }
}
