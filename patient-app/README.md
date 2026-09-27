# VIORA — patient app

Expo + React Native + TypeScript, Android-first. The calm, supportive face of
VIORA — the person's own app, which never shows a risk band, a score, or any
clinical framing.

Run with **Expo Go** (no EAS build needed for the demo):

```bash
cd patient-app
npm install
cp .env.example .env
# EXPO_PUBLIC_API_BASE_URL=http://<your-laptop-lan-ip>:8000   ← find with `hostname -I`
EXPO_PUBLIC_API_MODE=http
npx expo start
```

Scan the QR code with Expo Go on the Android phone (both on the same Wi-Fi).
The phone reaches the backend at the laptop's LAN address, and the backend binds
`0.0.0.0:8000`.

Set `EXPO_PUBLIC_API_MODE=mock` to run the whole app on fixtures with no
backend — useful for design and for a stage fallback.

Expo Go is enough because every native module this app uses (`expo-av`,
`expo-file-system`) ships inside Expo Go for SDK 51. That was **not** true of
expo-audio, which is one more reason the audio layer moved — see "Why expo-av,
not expo-audio" below.

## Running the native Android build

Only needed to test on the emulator or to produce an installable APK; Expo Go
above is the faster loop.

```bash
cd patient-app/android
./gradlew :app:assembleDebug          # APK → app/build/outputs/apk/debug/
```

Three settings in `android/gradle.properties` are load-bearing on a
memory-constrained laptop. **`android/` is generated and gitignored, so
`npx expo prebuild` wipes all three** — re-apply them after any prebuild:

| Setting | Why |
| --- | --- |
| `org.gradle.java.home=…/jdk-17…` | The default `java` here is JDK 25, which Gradle 8.8 and RN 0.74 do not support. Without this the build dies at configuration. Set in `gradle.properties`, not `JAVA_HOME`, because `expo run:android` spawns Gradle itself. |
| `reactNativeArchitectures=x86_64` | The template default builds all four ABIs — four sets of native libraries when the emulator needs one. This is what exhausted memory on a 14 GB machine and took the editor down with it. A physical phone needs `arm64-v8a`; pass it on the command line rather than editing the file. |
| `kotlin.daemon.jvmargs`, `org.gradle.workers.max` | A Gradle build is not one JVM — daemon plus Kotlin compile daemon plus per-task workers, each sizing its own heap from total RAM unless capped. |

`local.properties` (also generated, also gitignored) must point at the SDK:
`sdk.dir=/home/<user>/Android/Sdk`.

Run the build on its own. Gradle, Metro, and an emulator at once is roughly
5 GB before the editor gets a look in; `./gradlew --stop` reclaims the daemon's
share before the emulator starts.

## Safety rules this app enforces

- **Text is the default check-in mode.** Voice is a deliberate choice. A spoken
  conversation can be overheard by the person the user is afraid of, so the
  app must never default to voice.
- **One-tap Exit** from any conversation screen returns to a neutral home.
- **Conversation content never appears in a notification.** Notifications, if
  used, say only that a check-in is due.
- **The patient never sees clinical framing.** No risk band, no distress score,
  no "CRITICAL". The wellbeing screen shows the person's own trend and their
  own rhythm.
- **No secrets in the app.** The phone talks to the VIORA backend; only the
  backend talks to Sarvam. `SARVAM_API_KEY` must never appear here.

## Voice turn-taking

`src/hooks/useVAD.ts` holds the turn-ending policy as a pure state machine over
metering samples: an ambient noise floor learned over the first ~500ms, speech
detected only above that floor, and a turn that closes only after 1400ms of
sustained silence — so natural pauses ("I think... actually the problem
started...") stay one turn and fan/AC/keyboard noise never opens one.
`useVoiceTurn.ts` is the expo-av adapter that feeds it real audio and owns
recording, upload and playback. `VoiceSession.tsx` is the screen that runs on a
device; the scripted orb in `Session.tsx` is the mock-mode stand-in, so the flow
can still be shown with no backend and no phone.

### Why expo-av, not expo-audio

This app is Expo SDK 51, and **expo-audio is not part of SDK 51**.
`expo/bundledNativeModules.json` pins `expo-av: ~14.0.7` and lists no
expo-audio at all; expo-audio first shipped with SDK 52 against
expo-modules-core 2.x. On this project's core (1.12.26) it does not merely
misbehave, it does not compile:

```
e: AudioModule.kt:296  Unresolved reference: throwingActivity
e: AudioPlayer.kt:129  Unresolved reference: emit
```

Its `peerDependencies` are `"expo": "*"`, so npm installs it without complaint
and the incompatibility only surfaces at `compileDebugKotlin`.

That swap also fixed turn-taking rather than compromising it. expo-audio 0.2.4
never enabled metering on either platform, so the VAD would have received zero
samples and every turn would have ended on a timer. **expo-av reports metering
natively on both platforms** — `AVManager.getAudioRecorderStatus()` puts a
`metering` value in the status whenever the recording was prepared with
`isMeteringEnabled` — so real voice-activity detection is the normal path here.

#### One unit trap worth knowing

Android's metering is not true dBFS. `AVManager.getAudioRecorderLevels()`
returns `20 * Math.log(amplitude / 32767)` — a **natural** log where the decibel
definition wants log10 — so every Android sample arrives stretched by
ln(10) ≈ 2.303, and a quiet room reads about -116 instead of -50.

`toDbfs()` in the adapter divides it back out, so `useVAD.ts` sees the scale its
constants are written against (-116 → -50, -46 → -20). Unconverted, the VAD
still runs but none of its constants mean what they say: `ATTACK_DB` of 6 would
be a 1.35x rise in amplitude instead of the intended 2x, making the detector
markedly more eager to treat fan or AC noise as the start of a turn — the one
behaviour the contract says must never happen.

### The duration fallback is still there

A listening window that has seen no metering sample by `NO_METERING_MS` (600ms)
stops waiting and closes on duration instead: `FALLBACK_TURN_MS` (7s), or as
soon as the person taps **Done speaking**, which `VoiceSession` shows only in
that mode. A 422 from `voice-turn` ("no speech detected") is treated as an empty
turn and listened through again.

With expo-av this is a genuine fallback rather than the default path, but it is
not dead code — a microphone that produces no signal (a bare emulator with no
audio input wired up), a platform without metering, or a future SDK that drops
the field all land here, and each of them is silent when it happens. Both paths
are covered by tests.

One expo-av constraint to know before touching the loop: an `Audio.Recording` is
**single-use**. `stopAndUnloadAsync()` retires the object permanently, so
**every** window must build and prepare a fresh recorder or the second turn of a
call throws. `listenForTurn` calls `prepareToRecordAsync()` at the top of each
window, which is what makes that the adapter's problem rather than a crash.

## Screens

Welcome → Profile picker → Home → Check-in (text default, voice opt-in) →
Completion → Home.

The profiles are ordinary people with ordinary names and anonymous UIDs —
nothing on screen describes them as demo or test data.

## Contract

Wire types in `src/api/types.ts` mirror `backend/app/schemas.py`. If a field
changes there it changes here. The backend is the single source of truth.
