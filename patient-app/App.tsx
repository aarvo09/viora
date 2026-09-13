/* VIORA patient app — Android-first, calm by design.
 *
 * Flow (with navigation):
 *   Welcome → Profile picker → Tabs (Home | Check-ins | Well-being | Profile)
 *     Home → Check-in choice → Session (text) or Voice Call
 *            → Scheduler (new / reschedule)
 *            → History detail
 *            → Support
 *   Any session → Complete
 *
 * Safety rules encoded here:
 *   * TEXT is the default check-in mode. Voice is an explicit choice.
 *   * One-tap Exit is always available from any conversation.
 *   * Conversation content never appears in a notification.
 *   * Profile data resets fully on profile switch via nav.resetTo.
 *   * The patient never sees a risk band, a score, or anything clinical.
 */

import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { api } from './src/api/client'
import type { PatientProfile } from './src/api/types'

/* Screens */
import { HomeScreen } from './src/screens/HomeScreen'
import { CheckinChoiceScreen } from './src/screens/CheckinChoiceScreen'
import { SessionScreen } from './src/screens/SessionScreen'
import { VoiceCallScreen } from './src/screens/VoiceCallScreen'
import { CompleteScreen } from './src/screens/CompleteScreen'
import { SchedulerScreen } from './src/screens/SchedulerScreen'
import { HistoryDetailScreen } from './src/screens/HistoryDetailScreen'
import { SupportScreen } from './src/screens/SupportScreen'
import { WellbeingScreen } from './src/screens/WellbeingScreen'
import { HistoryScreen } from './src/screens/HistoryScreen'
import { ProfileScreen } from './src/screens/ProfileScreen'

/* Legacy screens still in use */
import { ProfilePicker } from './src/components/ProfilePicker'
import { Welcome } from './src/components/Welcome'

/* Navigation */
import { useNavigator } from './src/nav/useNavigator'
import { TabBar } from './src/nav/TabBar'
import type { Navigator } from './src/nav/useNavigator'
import type { Tab } from './src/nav/routes'

/* Theme */
import { colors } from './src/theme'

export default function App() {
  const [profiles, setProfiles] = useState<PatientProfile[]>([])
  const [current, setCurrent] = useState<PatientProfile | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(true)

  const nav = useNavigator({ name: 'welcome' })

  useEffect(() => {
    let alive = true
    api
      .listPatients()
      .then((p) => alive && setProfiles(p))
      .catch(() => alive && setProfiles([]))
      .finally(() => alive && setLoadingProfiles(false))
    return () => { alive = false }
  }, [])

  const selectProfile = useCallback(
    (p: PatientProfile) => {
      setCurrent(p)
      /* resetTo clears the entire stack so no data from a previous profile is
         reachable via the back button. */
      nav.resetTo({ name: 'tabs', tab: 'home' })
    },
    [nav],
  )

  const switchProfile = useCallback(() => {
    setCurrent(null)
    nav.resetTo({ name: 'pick' })
  }, [nav])

  const route = nav.current

  /* Safety net: if no profile is selected, always show the picker.
     In an effect, not in render — `resetTo` sets state, and calling it during
     render schedules an update mid-render and loops. */
  useEffect(() => {
    if (!current && route.name !== 'welcome' && route.name !== 'pick') {
      nav.resetTo({ name: 'pick' })
    }
  }, [current, route.name, nav])

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {route.name === 'welcome' && (
        <Welcome
          loading={loadingProfiles}
          onDone={() => nav.replace({ name: 'pick' })}
        />
      )}

      {route.name === 'pick' && (
        <ProfilePicker profiles={profiles} onSelect={selectProfile} />
      )}

      {route.name === 'tabs' && current && (
        <>
          <TabContent
            tab={route.tab}
            profile={current}
            nav={nav}
            onStartCheckin={() => nav.push({ name: 'checkinChoice' })}
            onSwitchProfile={switchProfile}
            onProfileUpdated={setCurrent}
          />
          <TabBar
            active={route.tab}
            nav={nav}
            onStartCheckin={() => nav.push({ name: 'checkinChoice' })}
          />
        </>
      )}

      {/* Full-screen routes sit above the tabs layer */}
      {route.name === 'checkinChoice' && current && (
        <CheckinChoiceScreen
          profile={current}
          onText={() => nav.replace({ name: 'session', channel: 'TEXT' })}
          onVoice={() => nav.replace({ name: 'session', channel: 'VOICE' })}
          onBack={() => nav.pop()}
        />
      )}

      {route.name === 'session' && current && route.channel === 'TEXT' && (
        <SessionScreen
          uid={current.uid}
          name={current.display_name}
          language={current.preferred_language}
          onComplete={(version, next, ch) =>
            nav.replace({ name: 'complete', reportVersion: version, nextFollowUp: next, nextChannel: ch })
          }
          onExit={() => nav.pop()}
          onSwitchToVoice={() => nav.replace({ name: 'session', channel: 'VOICE' })}
        />
      )}

      {route.name === 'session' && current && route.channel === 'VOICE' && (
        <VoiceCallScreen
          uid={current.uid}
          name={current.display_name}
          language={current.preferred_language}
          onComplete={(version, next, ch) =>
            nav.replace({ name: 'complete', reportVersion: version, nextFollowUp: next, nextChannel: ch })
          }
          onExit={() => nav.pop()}
          onSwitchToText={() => nav.replace({ name: 'session', channel: 'TEXT' })}
        />
      )}

      {route.name === 'complete' && current && (
        <CompleteScreen
          name={current.display_name}
          uid={current.uid}
          reportVersion={route.reportVersion}
          nextFollowUp={route.nextFollowUp}
          nextChannel={route.nextChannel}
          onDone={() => nav.resetTo({ name: 'tabs', tab: 'home' })}
        />
      )}

      {route.name === 'scheduler' && current && (
        <SchedulerScreen
          uid={current.uid}
          profile={current}
          mode={route.mode}
          onDone={() => nav.pop()}
          onBack={() => nav.pop()}
        />
      )}

      {route.name === 'historyDetail' && current && (
        <HistoryDetailScreen
          uid={current.uid}
          interactionId={route.interactionId}
          onBack={() => nav.pop()}
        />
      )}

      {route.name === 'support' && (
        <SupportScreen onBack={() => nav.pop()} />
      )}
    </View>
  )
}

/* Renders the active tab content without unmounting other tabs unnecessarily. */
function TabContent({
  tab,
  profile,
  nav,
  onStartCheckin,
  onSwitchProfile,
  onProfileUpdated,
}: {
  tab: Tab
  profile: PatientProfile
  nav: Navigator
  onStartCheckin: () => void
  onSwitchProfile: () => void
  onProfileUpdated: (p: PatientProfile) => void
}) {
  switch (tab) {
    case 'home':
      return (
        <HomeScreen
          profile={profile}
          nav={nav}
          onStartCheckin={onStartCheckin}
          onSwitchProfile={onSwitchProfile}
        />
      )
    case 'checkins':
      return <HistoryScreen uid={profile.uid} nav={nav} />
    case 'wellbeing':
      return <WellbeingScreen uid={profile.uid} nav={nav} />
    case 'profile':
      return (
        <ProfileScreen
          profile={profile}
          nav={nav}
          onSwitchProfile={onSwitchProfile}
          onProfileUpdated={onProfileUpdated}
        />
      )
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
})
