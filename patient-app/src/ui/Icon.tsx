/* Icons drawn from Views.
 *
 * There is no `react-native-svg` in the compiled binary and adding it would
 * force a Gradle rebuild, so every glyph here is composed from borders, circles
 * and rotated rectangles. That sounds worse than it is: at 20-24px a chat
 * bubble is a rounded box with a tail, and a chevron is a square with two
 * borders turned 45°. Emoji were the alternative and were rejected — they
 * render differently per platform and drag a colourful, jokey tone into an app
 * about someone's safety.
 *
 * Every icon takes `size` and `color` and draws inside a `size` box, so icons
 * line up in a row without per-call nudging.
 */

import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'

export type IconName =
  | 'home' | 'calendar' | 'chart' | 'person'
  | 'mic' | 'send' | 'chevron' | 'bell'
  | 'shield' | 'check' | 'phone' | 'chat'
  | 'close' | 'clock' | 'muted' | 'speaker' | 'plus'

export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName
  size?: number
  color?: string
}) {
  const box = { width: size, height: size, alignItems: 'center', justifyContent: 'center' } as const
  return <View style={box}>{glyph(name, size, color)}</View>
}

function glyph(name: IconName, s: number, c: string) {
  const line = (w: number, h: number, extra?: object) => ({
    width: w,
    height: h,
    backgroundColor: c,
    borderRadius: Math.min(w, h) / 2,
    ...extra,
  })

  switch (name) {
    case 'home':
      // Roof as a rotated square, body as a rounded box beneath it.
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: s * 0.62,
              height: s * 0.62,
              borderTopWidth: s * 0.13,
              borderLeftWidth: s * 0.13,
              borderColor: c,
              transform: [{ rotate: '45deg' }],
              marginTop: -s * 0.1,
              borderTopLeftRadius: s * 0.1,
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: s * 0.16,
              width: s * 0.52,
              height: s * 0.34,
              borderWidth: s * 0.11,
              borderColor: c,
              borderTopWidth: 0,
              borderBottomLeftRadius: s * 0.06,
              borderBottomRightRadius: s * 0.06,
            }}
          />
        </View>
      )

    case 'calendar':
      return (
        <View
          style={{
            width: s * 0.8,
            height: s * 0.76,
            borderWidth: s * 0.1,
            borderColor: c,
            borderRadius: s * 0.14,
          }}
        >
          <View
            style={{
              height: s * 0.14,
              backgroundColor: c,
              marginHorizontal: -1,
              marginTop: -1,
            }}
          />
          <View style={{ flexDirection: 'row', gap: s * 0.08, padding: s * 0.1 }}>
            <View style={line(s * 0.12, s * 0.12)} />
            <View style={line(s * 0.12, s * 0.12)} />
          </View>
        </View>
      )

    case 'chart':
      // Three columns of increasing height — a trend, not a specific value.
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: s * 0.1, height: s * 0.7 }}>
          <View style={line(s * 0.16, s * 0.32)} />
          <View style={line(s * 0.16, s * 0.54)} />
          <View style={line(s * 0.16, s * 0.7)} />
        </View>
      )

    case 'person':
      return (
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: s * 0.34,
              height: s * 0.34,
              borderRadius: s * 0.17,
              borderWidth: s * 0.1,
              borderColor: c,
            }}
          />
          <View
            style={{
              marginTop: s * 0.08,
              width: s * 0.62,
              height: s * 0.32,
              borderWidth: s * 0.1,
              borderColor: c,
              borderBottomWidth: 0,
              borderTopLeftRadius: s * 0.31,
              borderTopRightRadius: s * 0.31,
            }}
          />
        </View>
      )

    case 'mic':
      return (
        <View style={{ alignItems: 'center' }}>
          <View style={line(s * 0.3, s * 0.44, { borderRadius: s * 0.15 })} />
          <View
            style={{
              width: s * 0.5,
              height: s * 0.24,
              borderWidth: s * 0.09,
              borderColor: c,
              borderTopWidth: 0,
              borderBottomLeftRadius: s * 0.25,
              borderBottomRightRadius: s * 0.25,
              marginTop: -s * 0.06,
            }}
          />
          <View style={line(s * 0.09, s * 0.12, { marginTop: s * 0.02 })} />
        </View>
      )

    case 'muted':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mic" size={s} color={c} />
          <View
            style={{
              position: 'absolute',
              width: s * 0.96,
              height: s * 0.1,
              backgroundColor: c,
              borderRadius: s * 0.05,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      )

    case 'speaker':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: s * 0.2,
              height: s * 0.3,
              backgroundColor: c,
              borderTopLeftRadius: s * 0.04,
              borderBottomLeftRadius: s * 0.04,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderTopWidth: s * 0.26,
              borderBottomWidth: s * 0.26,
              borderRightWidth: s * 0.26,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              borderRightColor: c,
            }}
          />
          <View style={line(s * 0.08, s * 0.28, { marginLeft: s * 0.08, opacity: 0.9 })} />
          <View style={line(s * 0.08, s * 0.44, { marginLeft: s * 0.06, opacity: 0.7 })} />
        </View>
      )

    case 'send':
      // A chevron pointing up reads more clearly at 20px than a paper plane.
      return (
        <View
          style={{
            width: s * 0.42,
            height: s * 0.42,
            borderTopWidth: s * 0.13,
            borderRightWidth: s * 0.13,
            borderColor: c,
            transform: [{ rotate: '-45deg' }],
            marginBottom: s * 0.06,
          }}
        />
      )

    case 'chevron':
      return (
        <View
          style={{
            width: s * 0.36,
            height: s * 0.36,
            borderTopWidth: s * 0.11,
            borderRightWidth: s * 0.11,
            borderColor: c,
            transform: [{ rotate: '45deg' }],
            marginLeft: -s * 0.06,
          }}
        />
      )

    case 'close':
      return (
        <View style={{ width: s * 0.6, height: s * 0.6, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: s * 0.6, height: s * 0.1, backgroundColor: c, borderRadius: s * 0.05, transform: [{ rotate: '45deg' }] }} />
          <View style={{ position: 'absolute', width: s * 0.6, height: s * 0.1, backgroundColor: c, borderRadius: s * 0.05, transform: [{ rotate: '-45deg' }] }} />
        </View>
      )

    case 'check':
      return (
        <View
          style={{
            width: s * 0.5,
            height: s * 0.26,
            borderLeftWidth: s * 0.12,
            borderBottomWidth: s * 0.12,
            borderColor: c,
            transform: [{ rotate: '-45deg' }],
            marginTop: -s * 0.08,
          }}
        />
      )

    case 'bell':
      return (
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: s * 0.56,
              height: s * 0.5,
              borderWidth: s * 0.09,
              borderColor: c,
              borderTopLeftRadius: s * 0.28,
              borderTopRightRadius: s * 0.28,
              borderBottomWidth: 0,
            }}
          />
          <View style={line(s * 0.7, s * 0.09)} />
          <View style={line(s * 0.16, s * 0.1, { marginTop: s * 0.04 })} />
        </View>
      )

    case 'shield':
      return (
        <View
          style={{
            width: s * 0.58,
            height: s * 0.66,
            borderWidth: s * 0.09,
            borderColor: c,
            borderTopLeftRadius: s * 0.1,
            borderTopRightRadius: s * 0.1,
            borderBottomLeftRadius: s * 0.29,
            borderBottomRightRadius: s * 0.29,
          }}
        />
      )

    case 'phone':
      return (
        <View
          style={{
            width: s * 0.54,
            height: s * 0.54,
            borderWidth: s * 0.11,
            borderColor: c,
            borderRadius: s * 0.16,
            borderRightWidth: 0,
            borderTopWidth: 0,
            transform: [{ rotate: '-45deg' }],
          }}
        />
      )

    case 'chat':
      return (
        <View style={{ alignItems: 'flex-start' }}>
          <View
            style={{
              width: s * 0.72,
              height: s * 0.56,
              borderWidth: s * 0.09,
              borderColor: c,
              borderRadius: s * 0.16,
            }}
          />
          <View
            style={{
              width: s * 0.16,
              height: s * 0.16,
              backgroundColor: c,
              marginLeft: s * 0.14,
              marginTop: -s * 0.03,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      )

    case 'clock':
      return (
        <View
          style={{
            width: s * 0.68,
            height: s * 0.68,
            borderRadius: s * 0.34,
            borderWidth: s * 0.09,
            borderColor: c,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ position: 'absolute', width: s * 0.04, height: s * 0.2, backgroundColor: c, top: s * 0.11, borderRadius: 2 }} />
          <View style={{ position: 'absolute', width: s * 0.16, height: s * 0.04, backgroundColor: c, borderRadius: 2 }} />
        </View>
      )

    case 'plus':
      return (
        <View style={{ width: s * 0.6, height: s * 0.6, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: s * 0.6, height: s * 0.11, backgroundColor: c, borderRadius: 2 }} />
          <View style={{ position: 'absolute', width: s * 0.11, height: s * 0.6, backgroundColor: c, borderRadius: 2 }} />
        </View>
      )
  }
}

export const iconStyles = StyleSheet.create({ noop: {} })
