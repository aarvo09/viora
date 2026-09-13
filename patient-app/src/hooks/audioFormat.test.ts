/* Container sniffing tests.
 *
 * These matter because the failure they guard against is silent: a clip written
 * with the wrong extension does not raise anything, it just never plays, while
 * the subtitle still says VIORA is speaking. The backend's TTS container is
 * unverified, so every plausible one is covered here rather than assumed.
 *
 * Run: npm test
 */

import { describe, expect, it } from 'vitest'
import { decodeHead, extensionFor } from './audioFormat'

/** Real container headers, base64'd the way the backend sends them.
 *
 *  `Buffer` is fine in a test (this runs on node); the module under test is the
 *  one that cannot use it. */
function b64(bytes: (number | string)[]): string {
  const parts = bytes.map((b) => (typeof b === 'string' ? Buffer.from(b, 'latin1') : Buffer.from([b])))
  return Buffer.concat(parts).toString('base64')
}

const HEADERS = {
  /** 'RIFF' + size + 'WAVEfmt ' — what Sarvam Bulbul is expected to return. */
  wav: b64(['RIFF', 0x24, 0x08, 0x00, 0x00, 'WAVEfmt ']),
  ogg: b64(['OggS', 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  flac: b64(['fLaC', 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00, 0x00]),
  mp3WithId3: b64(['ID3', 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  /** Raw MPEG frame sync, no ID3 tag. */
  mp3Bare: b64([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  /** ISO-BMFF: 4-byte box size, then 'ftyp'. */
  m4a: b64([0x00, 0x00, 0x00, 0x20, 'ftypM4A ', 0x00, 0x00]),
}

describe('extensionFor', () => {
  it('recognises WAV, the format the backend is expected to send', () => {
    expect(extensionFor(HEADERS.wav)).toBe('.wav')
  })

  it('recognises the other containers Bulbul could return', () => {
    expect(extensionFor(HEADERS.ogg)).toBe('.ogg')
    expect(extensionFor(HEADERS.flac)).toBe('.flac')
    expect(extensionFor(HEADERS.m4a)).toBe('.m4a')
  })

  it('recognises MP3 both with an ID3 tag and as a bare frame', () => {
    expect(extensionFor(HEADERS.mp3WithId3)).toBe('.mp3')
    expect(extensionFor(HEADERS.mp3Bare)).toBe('.mp3')
  })

  /* The point of the default is that ExoPlayer sniffs content as well as name,
     so an unrecognised clip still gets a chance to play. */
  it('falls back to .mp3 for anything unrecognised', () => {
    expect(extensionFor(b64(['NOPE', 0x00, 0x00, 0x00, 0x00]))).toBe('.mp3')
  })

  /* A malformed or truncated clip must not throw: the loop would surface it as a
     failed check-in when the right response is to skip one clip. */
  it('never throws on degenerate input', () => {
    expect(() => extensionFor('')).not.toThrow()
    expect(() => extensionFor('=')).not.toThrow()
    expect(() => extensionFor('!!!!not base64!!!!')).not.toThrow()
    expect(() => extensionFor('UklG')).not.toThrow()
    expect(extensionFor('')).toBe('.mp3')
  })

  /* Sniffing must not depend on clip length — a one-word sentence is short. */
  it('recognises a container from a short clip', () => {
    expect(extensionFor(Buffer.from('RIFF....WAVE', 'latin1').toString('base64'))).toBe('.wav')
  })
})

describe('decodeHead', () => {
  /* This is the part that would break silently if `atob` were used instead:
     RN has no atob, so the whole sniff would collapse to the default branch. */
  it('decodes base64 to bytes without atob or Buffer', () => {
    expect(decodeHead(Buffer.from('RIFF', 'latin1').toString('base64'))).toBe('RIFF')
    expect(decodeHead(Buffer.from('OggS', 'latin1').toString('base64'))).toBe('OggS')
  })

  it('preserves high bytes, which a naive decode mangles', () => {
    const decoded = decodeHead(Buffer.from([0xff, 0xfb, 0x90]).toString('base64'))
    expect(decoded.charCodeAt(0)).toBe(0xff)
    expect(decoded.charCodeAt(1)).toBe(0xfb)
    expect(decoded.charCodeAt(2)).toBe(0x90)
  })

  it('stops cleanly at padding instead of decoding it as data', () => {
    // 'AA==' is one byte plus padding; the padding must not add a NUL byte.
    expect(decodeHead('AA==')).toHaveLength(1)
  })

  it('reads enough bytes to see an ftyp box at offset 4', () => {
    expect(decodeHead(HEADERS.m4a).length).toBeGreaterThanOrEqual(8)
  })
})
