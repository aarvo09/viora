/* Container sniffing for the TTS clips the backend returns.
 *
 * Its own module, not a helper inside the voice loop, so it can be tested
 * without pulling expo-av and a React renderer into the test process.
 *
 * Why sniff at all: the extension is not cosmetic on Android. ExoPlayer selects
 * an extractor partly by filename, and a wrong extension can fail to play audio
 * that is otherwise fine. The backend's container is explicitly unverified —
 * `services/sarvam.py` returns whatever Bulbul sends, with a ⚠️ VERIFY on the
 * call — so guessing here would fail silently, as a clip that simply never
 * plays while the subtitle claims VIORA is speaking.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Decode the leading base64 chars to bytes-as-charcodes.
 *
 *  Hand-rolled because React Native defines no `atob` — on Hermes it is simply
 *  absent, so calling it would throw and quietly send every clip to the default
 *  branch, defeating the sniff. `Buffer` is equally absent. Stops at the first
 *  character outside the base64 alphabet (padding, whitespace, a truncated
 *  clip) rather than throwing: a short read just yields a shorter prefix, and
 *  every check below is a prefix test.
 *
 *  12 chars → 9 bytes, which covers the longest signature here (`ftyp` at
 *  offset 4..8). */
export function decodeHead(base64: string, chars = 12): string {
  let bits = 0
  let acc = 0
  let out = ''
  for (const ch of base64.slice(0, chars)) {
    const v = B64.indexOf(ch)
    if (v < 0) break
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 0xff)
    }
  }
  return out
}

/** File extension for a base64 audio clip, from its magic bytes.
 *
 *  Unknown audio gets `.mp3`: ExoPlayer's sniffers fall back to inspecting
 *  content, so a wrong-but-plausible extension still plays more often than a
 *  meaningless one. */
export function extensionFor(base64: string): string {
  const head = decodeHead(base64)

  if (head.startsWith('RIFF')) return '.wav'
  if (head.startsWith('OggS')) return '.ogg'
  if (head.startsWith('fLaC')) return '.flac'
  // ID3 tag, or a raw MPEG frame sync (11 bits set).
  if (head.startsWith('ID3')) return '.mp3'
  if (head.charCodeAt(0) === 0xff && (head.charCodeAt(1) & 0xe0) === 0xe0) return '.mp3'
  // `ftyp` box at offset 4 marks ISO-BMFF: m4a/aac from Bulbul or from iOS.
  if (head.slice(4, 8) === 'ftyp') return '.m4a'

  return '.mp3'
}
