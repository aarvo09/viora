/* Case view — Clinical Decision Support Workspace.
 *
 * Implements Stitch UI/UX for the Counsellor Decision Workspace.
 * 62% Left Column: Telemetry strip, Longitudinal curve, Trajectory Quadrant, Explainable AI factors, Clinical Matrix, Version Audit.
 * 38% Right Column: Audio player & Transcript, Recommended Cadence, Human Review Decision Station (#decision-station), Telemetry Timeline.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type {
  CaseDetail,
  FollowUp,
  InteractionSummary,
  Report,
  ReviewOutcome,
  TelemetryPoint,
  Transcript,
} from '../api/types'
import { ScheduleModal } from '../components/ScheduleModal'
import { TrajectoryQuadrant } from '../components/TrajectoryQuadrant'
import {
  BaselineConfidenceTag,
  Delta,
  DirectionTag,
  Empty,
  ErrorNote,
  RiskBadge,
  SeverityDot,
  Spinner,
  severityLabel,
} from '../components/primitives'

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function relative(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function fmtInterval(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`
  const days = Math.floor(hours / 24)
  const rest = Math.round(hours - days * 24)
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

function CadenceExplanation({ followUp }: { followUp: FollowUp }) {
  if (followUp.source === 'COUNSELLOR') {
    return <span className="font-body-sm text-secondary">Time chosen by a counsellor, not predicted.</span>
  }
  if (followUp.cadence_hours == null) return null

  const base = followUp.cadence_base_hours
  return (
    <div className="flex flex-col gap-space-2xs mt-space-2xs">
      <span className="font-label-sm text-secondary uppercase tracking-wider">
        Why this date — predicted {fmtInterval(followUp.cadence_hours)}
        {base != null && base !== followUp.cadence_hours ? ` (band default ${fmtInterval(base)})` : ''}
      </span>
      {followUp.cadence_factors.length === 0 ? (
        <span className="font-body-sm text-secondary">
          Nothing in this check-in moved the interval from the band default.
        </span>
      ) : (
        <ul className="flex flex-col gap-1 mt-1">
          {followUp.cadence_factors.map((factor) => {
            const tightened = factor.multiplier < 1
            return (
              <li key={factor.code} className="flex items-center gap-2 font-body-sm text-on-surface">
                <span
                  className="px-2 py-0.5 rounded-full font-label-sm font-semibold"
                  style={{
                    backgroundColor: tightened ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: tightened ? '#DC2626' : '#059669',
                  }}
                >
                  {tightened ? 'sooner' : 'later'} ×{factor.multiplier}
                </span>
                <span className="text-secondary">{factor.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function CaseView() {
  const { id } = useParams<{ id: string }>()
  const caseId = Number(id)

  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [interactions, setInteractions] = useState<InteractionSummary[]>([])
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [openReport, setOpenReport] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [selectedOutcome, setSelectedOutcome] = useState<ReviewOutcome>('INTERVENTION_REQUIRED')
  const [notes, setNotes] = useState(
    'Spoke with triage team. Reaching out to patient regarding safe environment and adjusting evening check-in cadence.'
  )
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [activeSpeechSeq, setActiveSpeechSeq] = useState<number | null>(null)
  const [audioPlaybackSec, setAudioPlaybackSec] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0)
  const audioCacheRef = useRef<Map<string, string[]>>(new Map())
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioIntervalRef = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  isPlayingRef.current = isPlayingAudio

  const [activeGraphTab, setActiveGraphTab] = useState<'distress' | 'threat' | 'both'>('both')
  const [isSchedulingOpen, setIsSchedulingOpen] = useState(false)
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [allFollowUps, setAllFollowUps] = useState<FollowUp[]>([])

  const load = useCallback(() => {
    Promise.all([
      api.case(caseId),
      api.telemetry(caseId),
      api.reports(caseId),
      api.interactions(caseId),
      api.followUps(caseId).catch(() => [] as FollowUp[]),
    ])
      .then(([d, t, r, i, f]) => {
        setDetail(d)
        setTelemetry(t)
        setReports(r)
        setInteractions(i)
        setAllFollowUps(f)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load case'))
  }, [caseId])

  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    const timer = setInterval(load, 6000)
    return () => {
      window.removeEventListener('focus', load)
      clearInterval(timer)
    }
  }, [load])

  async function handleCancelFollowUp(followUpId: number) {
    if (!window.confirm('Cancel this scheduled follow-up?')) return
    setFollowUpLoading(true)
    try {
      await api.cancelFollowUp(caseId, followUpId)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel follow-up')
    } finally {
      setFollowUpLoading(false)
    }
  }

  async function handleCompleteFollowUp(followUpId: number) {
    setFollowUpLoading(true)
    try {
      await api.completeFollowUp(caseId, followUpId)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete follow-up')
    } finally {
      setFollowUpLoading(false)
    }
  }

  async function submitDecision() {
    if (!detail) return
    setSaving(true)
    try {
      await api.review(caseId, {
        outcome: selectedOutcome,
        notes: notes.trim() || undefined,
        alert_id: detail.open_alerts[0]?.id,
        intervention_type:
          selectedOutcome === 'INTERVENTION_REQUIRED' || selectedOutcome === 'ESCALATE'
            ? 'PSYCH_SUPPORT'
            : undefined,
      })
      setSaved(selectedOutcome)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record decision')
    } finally {
      setSaving(false)
    }
  }

  const isHistorical = selectedVersion != null && selectedVersion !== detail?.latest_report?.report_version
  const report = isHistorical
    ? (reports.find((r) => r.report_version === selectedVersion) ?? detail?.latest_report)
    : detail?.latest_report

  const currentInteractionId =
    report?.interaction_id ??
    (report?.report_version
      ? interactions.find((i) => i.interaction_id === report?.interaction_id)?.interaction_id
      : null) ??
    interactions[0]?.interaction_id

  // Dynamic transcript loading whenever version/report/case changes
  useEffect(() => {
    if (currentInteractionId) {
      api.transcript(currentInteractionId).then(setTranscript).catch(() => setTranscript(null))
    } else {
      setTranscript(null)
    }
  }, [currentInteractionId])

  // Total duration estimated by character length (~16 chars per second)
  const totalDurationSec = Math.max(
    12,
    Math.round((transcript?.messages.reduce((acc, m) => acc + m.content.length, 0) ?? 80) / 16)
  )

  // Pre-fetch / synthesize neural audio for a message using Sarvam TTS API
  const getAudioForMessage = useCallback(
    async (content: string, role: string, language = 'hi'): Promise<string[]> => {
      const cacheKey = `${role}:${language}:${content.trim()}`
      if (audioCacheRef.current.has(cacheKey)) {
        return audioCacheRef.current.get(cacheKey)!
      }

      try {
        const res = await api.synthesizeText(content, language)
        if (res?.sentences && res.sentences.length > 0) {
          const dataUrls = res.sentences
            .map((s) => s.audio_b64)
            .filter((b64): b64 is string => Boolean(b64 && b64.length > 0))
            .map((b64) => (b64.startsWith('data:') ? b64 : `data:audio/wav;base64,${b64}`))

          if (dataUrls.length > 0) {
            audioCacheRef.current.set(cacheKey, dataUrls)
            return dataUrls
          }
        }
      } catch (err) {
        console.warn('TTS synthesis failed, falling back:', err)
      }
      return []
    },
    []
  )

  // Pre-fetch transcript audio in background when transcript loads for instant zero-latency replay
  useEffect(() => {
    if (!transcript || transcript.messages.length === 0) return
    const lang = transcript.language || 'hi'
    transcript.messages.forEach((m) => {
      getAudioForMessage(m.content, m.role, lang).catch(() => {})
    })
  }, [transcript, getAudioForMessage])

  const playAudioChunk = useCallback(
    (dataUrl: string, speed: number): Promise<void> => {
      return new Promise((resolve) => {
        if (currentAudioRef.current) {
          try {
            currentAudioRef.current.pause()
            currentAudioRef.current.currentTime = 0
          } catch {}
          currentAudioRef.current = null
        }

        const audio = new Audio(dataUrl)
        currentAudioRef.current = audio
        audio.playbackRate = speed

        const cleanup = () => {
          if (currentAudioRef.current === audio) {
            currentAudioRef.current = null
          }
          resolve()
        }

        audio.onended = cleanup
        audio.onerror = (e) => {
          console.warn('Audio playback error:', e)
          cleanup()
        }

        const playPromise = audio.play()
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('Audio play() failed or interrupted:', err)
            cleanup()
          })
        }
      })
    },
    []
  )

  const playSpeechUtteranceFallback = useCallback(
    (content: string, role: string, lang: string, speed: number): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          setTimeout(resolve, Math.max(1500, (content.length * 60) / speed))
          return
        }
        try {
          const utterance = new SpeechSynthesisUtterance(content)
          utterance.rate = speed
          utterance.pitch = role === 'VIORA' ? 1.15 : 0.95
          utterance.lang = lang?.startsWith('hi') ? 'hi-IN' : 'en-IN'

          utterance.onend = () => resolve()
          utterance.onerror = () => resolve()

          const maxMs = Math.max(2000, (content.length * 80) / speed)
          const timer = setTimeout(() => resolve(), maxMs)
          utterance.addEventListener('end', () => clearTimeout(timer))
          utterance.addEventListener('error', () => clearTimeout(timer))

          window.speechSynthesis.speak(utterance)
        } catch {
          resolve()
        }
      })
    },
    []
  )

  const stopAudio = useCallback(() => {
    isPlayingRef.current = false
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause()
        currentAudioRef.current.currentTime = 0
      } catch {}
      currentAudioRef.current = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
      } catch {}
    }
    setIsPlayingAudio(false)
    setActiveSpeechSeq(null)
    if (audioIntervalRef.current) {
      clearInterval(audioIntervalRef.current)
      audioIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopAudio()
  }, [stopAudio, currentInteractionId])

  const playTranscript = useCallback(async () => {
    if (!transcript || transcript.messages.length === 0) return
    if (isPlayingAudio) {
      stopAudio()
      return
    }

    stopAudio()
    isPlayingRef.current = true
    setIsPlayingAudio(true)
    setAudioPlaybackSec(0)

    if (audioIntervalRef.current) clearInterval(audioIntervalRef.current)
    audioIntervalRef.current = window.setInterval(() => {
      setAudioPlaybackSec((prev) => (prev >= totalDurationSec ? totalDurationSec : prev + 1))
    }, 1000)

    const msgs = transcript.messages
    const lang = transcript.language || 'hi'

    for (let i = 0; i < msgs.length; i++) {
      if (!isPlayingRef.current) break
      const msg = msgs[i]
      setActiveSpeechSeq(msg.seq)

      const dataUrls = await getAudioForMessage(msg.content, msg.role, lang)
      if (!isPlayingRef.current) break

      if (dataUrls.length > 0) {
        for (const dataUrl of dataUrls) {
          if (!isPlayingRef.current) break
          await playAudioChunk(dataUrl, playbackSpeed)
        }
      } else {
        await playSpeechUtteranceFallback(msg.content, msg.role, lang, playbackSpeed)
      }

      if (i < msgs.length - 1 && isPlayingRef.current) {
        await new Promise((r) => setTimeout(r, 350))
      }
    }

    stopAudio()
  }, [
    transcript,
    isPlayingAudio,
    stopAudio,
    totalDurationSec,
    getAudioForMessage,
    playbackSpeed,
    playAudioChunk,
    playSpeechUtteranceFallback,
  ])

  const playSingleMessage = useCallback(
    async (msg: { seq: number; content: string; role: string }) => {
      if (isPlayingAudio && activeSpeechSeq === msg.seq) {
        stopAudio()
        return
      }

      stopAudio()
      isPlayingRef.current = true
      setIsPlayingAudio(true)
      setActiveSpeechSeq(msg.seq)

      const lang = transcript?.language || 'hi'
      const dataUrls = await getAudioForMessage(msg.content, msg.role, lang)

      if (!isPlayingRef.current) return

      if (dataUrls.length > 0) {
        for (const dataUrl of dataUrls) {
          if (!isPlayingRef.current) break
          await playAudioChunk(dataUrl, playbackSpeed)
        }
      } else {
        await playSpeechUtteranceFallback(msg.content, msg.role, lang, playbackSpeed)
      }

      if (isPlayingRef.current) {
        setIsPlayingAudio(false)
        setActiveSpeechSeq(null)
      }
    },
    [
      isPlayingAudio,
      activeSpeechSeq,
      stopAudio,
      transcript?.language,
      getAudioForMessage,
      playAudioChunk,
      playbackSpeed,
      playSpeechUtteranceFallback,
    ]
  )

  const toggleSpeed = useCallback(() => {
    const nextSpeed = playbackSpeed === 1.0 ? 1.25 : playbackSpeed === 1.25 ? 1.5 : 1.0
    setPlaybackSpeed(nextSpeed)
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.playbackRate = nextSpeed
      } catch {}
    }
  }, [playbackSpeed])

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0')
    const s = Math.floor(sec % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  if (error) return <ErrorNote message={error} />
  if (!detail) return <Spinner label="Loading case workspace" />

  const prediction = detail.latest_prediction
  const needsReview =
    detail.open_alerts.length > 0 ||
    report?.risk_level === 'HIGH' ||
    report?.risk_level === 'CRITICAL' ||
    report?.risk_level === 'URGENT'

  const chartData = telemetry.map((p) => ({
    name: `v${p.report_version}`,
    Threat: p.threat_score,
    Distress: p.distress_score,
    Baseline: p.baseline_score,
  }))

  const initials = detail.display_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* ------------------------------------------------ Top Navigation Breadcrumbs */}
      <div className="flex flex-col gap-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs text-on-surface-variant">
            <Link
              to="/cases"
              className="flex items-center gap-space-xs font-label-md text-label-md text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              <span>Back to Cases</span>
            </Link>
            <span className="text-outline-variant">/</span>
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">
              Inpatient &amp; Outpatient Telemetry
            </span>
            <span className="text-outline-variant">/</span>
            <span className="font-data-mono text-data-mono font-medium text-on-surface">
              {detail.uid}
            </span>
          </div>
          <div className="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm">
            <span className="w-2 h-2 rounded-full bg-surface-tint animate-pulse" />
            <span>
              Telemetry Synchronized:{' '}
              <strong>{report ? fmtDateTime(report.created_at) : 'Active'}</strong>
            </span>
          </div>
        </div>

        {/* ------------------------------------------------ Case Header Hero Band */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-space-md border border-outline-variant/30">
          <div className="flex flex-col md:flex-row md:items-center gap-space-md">
            {/* Patient Identity Pip */}
            <div className="w-14 h-14 rounded-xl bg-surface-container-high flex items-center justify-center font-headline-xl text-headline-xl text-primary font-bold shadow-inner">
              {initials}
            </div>
            <div className="flex flex-col gap-space-2xs">
              <div className="flex flex-wrap items-center gap-space-xs">
                <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">
                  {detail.display_name}
                </h1>
                <span className="bg-surface-container px-space-xs py-space-2xs rounded font-data-mono text-data-mono text-on-surface-variant">
                  {detail.uid}
                </span>
                <span className="text-outline-variant font-label-sm text-label-sm">•</span>
                <span className="font-body-md text-body-md text-secondary">
                  Ref: {detail.case_ref}
                </span>
                {detail.legal_stage && (
                  <>
                    <span className="text-outline-variant font-label-sm text-label-sm">•</span>
                    <span className="font-body-md text-body-md text-secondary">
                      {detail.legal_stage}
                    </span>
                  </>
                )}
                <span className="text-outline-variant font-label-sm text-label-sm">•</span>
                <span className="font-body-md text-body-md text-on-surface-variant font-medium">
                  Safe window: {detail.safe_contact_start}–{detail.safe_contact_end}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-space-xs mt-space-2xs">
                <RiskBadge level={report?.risk_level ?? null} size="md" />
                <DirectionTag direction={prediction?.direction ?? null} size="md" />
                {reports.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-outline-variant/40 text-on-surface font-label-sm text-label-sm">
                    <span className="material-symbols-outlined text-[16px] text-primary">history</span>
                    <label htmlFor="report-version-select" className="text-secondary text-xs font-medium">Viewing:</label>
                    <select
                      id="report-version-select"
                      value={report?.report_version ?? ''}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setSelectedVersion(v === detail.latest_report?.report_version ? null : v)
                      }}
                      className="bg-transparent font-bold text-primary cursor-pointer outline-none text-xs"
                    >
                      {reports.map((r) => (
                        <option key={r.id} value={r.report_version} className="text-on-surface bg-surface-container-lowest font-normal">
                          v{r.report_version} {r.report_version === detail.latest_report?.report_version ? '(Latest)' : ''} — {fmtDateTime(r.created_at)} ({r.risk_level})
                        </option>
                      ))}
                    </select>
                    {report && (
                      <span className="text-secondary font-label-sm text-label-sm text-xs ml-0.5">
                        · {relative(report.created_at)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Group */}
          <div className="flex flex-wrap items-center gap-space-xs">
            <button
              className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors"
              type="button"
              onClick={() => setIsSchedulingOpen(true)}
            >
              <span className="material-symbols-outlined text-[18px]">calendar_add_on</span>
              <span>Schedule Follow-up</span>
            </button>
            <button
              className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all shadow-sm"
              type="button"
              onClick={() => {
                const el = document.getElementById('decision-station')
                if (el) el.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <span className="material-symbols-outlined text-[18px]">fact_check</span>
              <span>Complete Human Review</span>
            </button>
          </div>
        </div>

        {/* ------------------------------------------------ Historical Report Inspection Banner */}
        {isHistorical && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-space-md flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-space-sm">
              <span className="material-symbols-outlined text-amber-600 text-[24px]">history</span>
              <div>
                <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Viewing Historical Assessment v{report?.report_version}
                </span>
                <p className="font-body-sm text-body-sm text-secondary">
                  Assessment recorded {report ? fmtDateTime(report.created_at) : ''} • Risk Level:{' '}
                  <strong className="text-on-surface font-bold">{report?.risk_level}</strong> • Distress: {report?.distress_score.toFixed(0)} • Threat: {report?.threat_score.toFixed(0)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedVersion(null)}
              className="flex items-center gap-space-2xs px-space-md py-space-xs rounded-lg bg-surface-container-lowest hover:bg-surface-container text-primary font-label-md text-label-md font-semibold border border-outline-variant/40 shadow-sm transition-all"
            >
              <span>Return to Latest (v{detail.latest_report?.report_version})</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        )}

        {/* ------------------------------------------------ Urgent Human Review Alert Banner */}
        {needsReview && (
          <div className="bg-error-container/40 border border-error/30 rounded-xl p-space-md flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md shadow-sm">
            <div className="flex items-start gap-space-md">
              <div className="w-9 h-9 rounded-lg bg-error text-on-error flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <span className="material-symbols-outlined text-[22px]">gpp_maybe</span>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-space-xs">
                  <span className="font-headline-sm text-headline-sm text-on-error-container font-bold tracking-tight">
                    URGENT HUMAN REVIEW REQUIRED
                  </span>
                  {detail.open_alerts.length > 0 && (
                    <span className="px-2 py-0.5 rounded font-data-mono text-data-mono bg-error text-on-error text-xs uppercase font-semibold">
                      Alert #{detail.open_alerts[0].id}
                    </span>
                  )}
                </div>
                <p className="font-body-md text-body-md text-on-surface mt-space-2xs max-w-4xl">
                  {detail.open_alerts[0]?.factors[0]?.label ||
                    'A safety-related threat indicator or acute distress divergence was detected during the latest check-in. Immediate clinical review is recommended.'}
                </p>
              </div>
            </div>
            <button
              className="shrink-0 flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-error text-on-error font-label-md text-label-md hover:opacity-90 transition-colors shadow-sm"
              type="button"
              onClick={() => {
                const el = document.getElementById('decision-station')
                if (el) el.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <span>Open Review Form</span>
              <span className="material-symbols-outlined text-[18px]">south</span>
            </button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ 62% Left / 38% Right Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        {/* ============================================== LEFT COLUMN (62%) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-space-lg">
          {/* 1. Executive Telemetry Strip */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex items-center justify-between pb-space-xs">
              <div>
                <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider block font-semibold">
                  Clinical Trajectory Summary
                </span>
                <h2 className="font-headline-lg text-headline-lg text-on-surface font-bold">
                  {report ? `Latest Well-being Report (v${report.report_version})` : 'Telemetry Ingestion'}
                </h2>
              </div>
              <span className="font-data-mono text-data-mono text-on-surface-variant bg-surface-container-low px-space-sm py-space-2xs rounded-lg">
                {report ? `Generated ${fmtDateTime(report.created_at)}` : 'Standby'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
              {/* Metric 1: Current Distress */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-secondary">Current Distress</span>
                <div className="flex items-baseline gap-space-2xs my-space-2xs">
                  <span className="font-data-metric text-data-metric text-error font-bold">
                    {report ? report.distress_score.toFixed(0) : '—'}
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">/ 100</span>
                </div>
                {report && (
                  <div className="inline-flex items-center gap-1 font-label-sm text-label-sm font-semibold">
                    <Delta value={report.score_change} />
                    <span className="text-secondary text-xs">vs prev</span>
                  </div>
                )}
              </div>

              {/* Metric 2: Baseline */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-secondary">Personal Baseline</span>
                <div className="flex items-baseline gap-space-2xs my-space-2xs">
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">
                    {report ? report.baseline_score.toFixed(0) : '—'}
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">/ 100</span>
                </div>
                {report && <BaselineConfidenceTag confidence={report.baseline_confidence} />}
              </div>

              {/* Metric 3: Threat Score */}
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-secondary">Threat Indicator</span>
                <div className="flex items-baseline gap-space-2xs my-space-2xs">
                  <span className="font-data-metric text-data-metric font-bold" style={{ color: 'var(--axis-threat)' }}>
                    {report ? report.threat_score.toFixed(0) : '—'}
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">/ 100</span>
                </div>
                {report && (
                  <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">
                    {report.threat_score > 50 ? 'Immediate Danger' : 'No Acute Threat'}
                  </span>
                )}
              </div>

              {/* Metric 4: Risk Level */}
              <div className="bg-error-container/20 rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-on-error-container font-medium">
                  Overall Risk
                </span>
                <div className="my-space-2xs">
                  <span className="font-data-metric text-data-metric text-error font-bold">
                    {report?.risk_level ?? 'LOW'}
                  </span>
                </div>
                {prediction && (
                  <span className="font-label-sm text-label-sm text-on-error-container">
                    Escalation: {prediction.escalation_risk.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>

            {report && (
              <div className="bg-surface-container-low rounded-lg p-space-sm flex items-start gap-space-sm">
                <span className="material-symbols-outlined text-surface-tint text-[20px] mt-0.5">info</span>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  <strong>Clinical Trajectory Note:</strong>{' '}
                  {report.distress_score > report.baseline_score ? (
                    <>
                      Current distress exceeds personal baseline by{' '}
                      <strong>+{(report.distress_score - report.baseline_score).toFixed(1)} points</strong>.
                      Trajectory direction is <strong>{prediction?.direction ?? report.trend}</strong>.
                    </>
                  ) : (
                    <>Distress remains within calibrated personal baseline range.</>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* 2. Longitudinal Well-being Telemetry Graph */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
              <div className="flex items-center gap-space-xs bg-surface-container rounded-lg p-space-2xs">
                <button
                  type="button"
                  className={`px-space-sm py-space-2xs rounded font-label-sm text-label-sm font-semibold transition-colors ${
                    activeGraphTab === 'both'
                      ? 'bg-surface-container-lowest text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  onClick={() => setActiveGraphTab('both')}
                >
                  Dual Axis (Distress &amp; Threat)
                </button>
                <button
                  type="button"
                  className={`px-space-sm py-space-2xs rounded font-label-sm text-label-sm font-semibold transition-colors ${
                    activeGraphTab === 'distress'
                      ? 'bg-surface-container-lowest text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  onClick={() => setActiveGraphTab('distress')}
                >
                  Distress Only
                </button>
                <button
                  type="button"
                  className={`px-space-sm py-space-2xs rounded font-label-sm text-label-sm font-semibold transition-colors ${
                    activeGraphTab === 'threat'
                      ? 'bg-surface-container-lowest text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  onClick={() => setActiveGraphTab('threat')}
                >
                  Threat Only
                </button>
              </div>
              <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-secondary">
                <span className="material-symbols-outlined text-[18px]">calendar_month</span>
                <span>{telemetry.length} Historical Check-ins</span>
              </div>
            </div>

            {/* Graph */}
            <div className="w-full h-72 pt-space-xs">
              {telemetry.length === 0 ? (
                <Empty>No longitudinal telemetry recorded yet.</Empty>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: -20 }}>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#94A3B8"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: '#CBD5E1' }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#94A3B8"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        fontSize: 12,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                      }}
                    />
                    {(activeGraphTab === 'both' || activeGraphTab === 'threat') && (
                      <Line
                        type="monotone"
                        dataKey="Threat"
                        stroke="#BA1A1A"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#BA1A1A' }}
                        activeDot={{ r: 6 }}
                      />
                    )}
                    {(activeGraphTab === 'both' || activeGraphTab === 'distress') && (
                      <Line
                        type="monotone"
                        dataKey="Distress"
                        stroke="#4F46E5"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#4F46E5' }}
                        activeDot={{ r: 6 }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="Baseline"
                      stroke="#64748B"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="flex items-center justify-between text-xs font-data-mono text-outline pt-space-2xs border-t border-outline-variant/30">
              <div className="flex items-center gap-space-md">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-1 bg-primary rounded-full inline-block" />
                  Distress Curve
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-1 bg-error rounded-full inline-block" />
                  Threat Curve
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-outline-variant border-t border-dashed border-outline inline-block" />
                  Calibrated Baseline
                </span>
              </div>
              <span className="text-secondary text-[11px]">Safety Review Threshold: 60.0</span>
            </div>
          </div>

          {/* 3. Predictive Risk Assessment & Trajectory Quadrant Station */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="w-3 h-3 rounded-full bg-primary" />
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Predictive Risk Assessment &amp; Quadrant
                </h3>
              </div>
              <span className="px-space-sm py-space-2xs rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold">
                VIORA Dual-Axis Engine
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-secondary">Escalation Probability</span>
                <div className="flex items-baseline gap-space-2xs my-space-xs">
                  <span className="font-data-metric text-data-metric text-error font-bold">
                    {prediction ? prediction.escalation_risk.toFixed(0) : '—'}
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">/ 100</span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {prediction?.horizon ? `Horizon: ${prediction.horizon}` : 'Evaluated over next 2 check-ins'}
                </p>
              </div>

              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-secondary">Trajectory Direction</span>
                <div className="my-space-xs flex items-center gap-space-xs font-headline-sm text-headline-sm font-bold">
                  <DirectionTag direction={prediction?.direction ?? null} size="md" />
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {report?.trend ? `Trend vector: ${report.trend}` : 'Multi-step divergence index'}
                </p>
              </div>

              <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col justify-between">
                <span className="font-label-sm text-label-sm text-secondary">Supervision Level</span>
                <div className="my-space-xs">
                  <span className="font-label-md text-label-md font-bold text-on-surface block leading-tight">
                    {needsReview ? 'DIRECT CLINICIAN SUPERVISION' : 'ROUTINE MONITORING'}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {needsReview ? 'Mandates clinical determination & sign-off' : 'Standard automated cadence'}
                </p>
              </div>
            </div>

            {/* Trajectory Quadrant Graphic */}
            <div className="p-space-sm bg-surface-container-low/40 rounded-xl border border-outline-variant/30">
              <span className="font-label-sm text-secondary uppercase tracking-wider block mb-space-xs font-semibold">
                Dual-Axis Trajectory Quadrant (Distress vs Threat)
              </span>
              <TrajectoryQuadrant points={telemetry} />
            </div>
          </div>

          {/* 4. Explainable AI: Clinical Attribution Factors */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div>
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-surface-tint text-[22px]">auto_awesome</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Explainable AI — Clinical Attribution Factors
                </h3>
              </div>
              <p className="font-body-md text-body-md text-secondary mt-space-2xs">
                Key rule-derived drivers identified by VIORA without clinical black-box opacity:
              </p>
            </div>

            {!report || report.factors.length === 0 ? (
              <Empty>No contributing factors recorded for this check-in.</Empty>
            ) : (
              <div className="flex flex-col gap-space-xs">
                {report.factors.map((f) => {
                  const isSerious = f.severity === 'SERIOUS'
                  const isConcern = f.severity === 'CONCERN'
                  return (
                    <div
                      key={f.code}
                      className="p-space-md rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors flex items-start justify-between gap-space-md border border-outline-variant/20"
                    >
                      <div className="flex items-start gap-space-md">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{
                            backgroundColor: isSerious
                              ? 'rgba(239, 68, 68, 0.15)'
                              : isConcern
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(79, 70, 229, 0.15)',
                            color: isSerious ? '#DC2626' : isConcern ? '#D97706' : '#4F46E5',
                          }}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {isSerious ? 'crisis_alert' : isConcern ? 'warning' : 'info'}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-label-md text-label-md text-on-surface font-semibold">
                            {f.label}
                          </span>
                          {f.evidence && (
                            <span className="font-body-sm text-body-sm text-on-surface-variant mt-1 italic border-l-2 border-primary/40 pl-2">
                              "{f.evidence}"
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className="px-space-sm py-0.5 rounded-full font-label-sm text-label-sm font-semibold shrink-0"
                        style={{
                          backgroundColor: isSerious
                            ? 'rgba(239, 68, 68, 0.15)'
                            : isConcern
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(79, 70, 229, 0.15)',
                          color: isSerious ? '#DC2626' : isConcern ? '#D97706' : '#4F46E5',
                        }}
                      >
                        {severityLabel(f.severity)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 5. Key Clinical Indicators Matrix & Biomarkers */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Extracted Clinical Biomarkers &amp; Semantic Matrix
              </h3>
              <span className="font-data-mono text-data-mono text-on-surface-variant text-xs">
                NLP &amp; Acoustic Inference
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
              <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
                <span className="font-body-sm text-body-sm text-secondary">General Distress</span>
                <span className="px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm font-semibold">
                  {report && report.distress_score > 60 ? 'Severe' : report && report.distress_score > 35 ? 'Moderate' : 'Low'}
                </span>
              </div>
              <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
                <span className="font-body-sm text-body-sm text-secondary">Safety Threat Indicator</span>
                <span className={`px-2.5 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${
                  report && report.threat_score > 40 ? 'bg-error text-on-error' : 'bg-surface-container text-secondary'
                }`}>
                  {report && report.threat_score > 40 ? 'Present (Tier 1)' : 'None Detected'}
                </span>
              </div>
              <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
                <span className="font-body-sm text-body-sm text-secondary">Sleep Quality &amp; Rhythm</span>
                <span className="px-2.5 py-0.5 rounded-full bg-surface-variant text-on-surface font-label-sm text-label-sm font-semibold">
                  {report?.factors.some((f) => f.code.toLowerCase().includes('sleep')) ? 'Disrupted' : 'Normal'}
                </span>
              </div>
              <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
                <span className="font-body-sm text-body-sm text-secondary">Hopelessness / Ideation</span>
                <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-secondary font-label-sm text-label-sm font-semibold">
                  {report?.factors.some((f) => f.code.toLowerCase().includes('hopeless')) ? 'Detected' : 'None Detected'}
                </span>
              </div>
            </div>
          </div>

          {/* 6. Longitudinal Report & Version History */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Longitudinal Report &amp; Version History
                </h3>
                <span className="font-body-sm text-body-sm text-secondary">
                  Complete audit chain across all clinical ingest versions ({reports.length} versions)
                </span>
              </div>
              <span className="material-symbols-outlined text-outline">history</span>
            </div>

            <div className="flex flex-col gap-space-xs">
              {reports.map((r, idx) => {
                const isActive = (report?.report_version === r.report_version)
                return (
                  <Fragment key={r.id}>
                    <div
                      className={`p-space-sm rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-primary/10 border border-primary/30'
                          : idx === 0
                          ? 'bg-surface-container-high/60'
                          : 'bg-surface-container-low hover:bg-surface-container'
                      }`}
                      onClick={() => setOpenReport(openReport === r.id ? null : r.id)}
                    >
                      <div className="flex items-center gap-space-sm">
                        <span className="font-data-mono text-data-mono font-bold text-primary">
                          v{r.report_version}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.5 rounded bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider">
                            Active
                          </span>
                        )}
                        <span className="font-body-sm text-body-sm text-on-surface font-semibold">
                          {fmtDateTime(r.created_at)}
                        </span>
                        <span className="text-secondary font-body-sm text-body-sm">
                          Distress: <strong className="text-error">{r.distress_score.toFixed(0)}</strong> | Threat:{' '}
                          <strong>{r.threat_score.toFixed(0)}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-space-xs">
                        <RiskBadge level={r.risk_level} size="sm" />
                        {!isActive ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedVersion(r.report_version === detail.latest_report?.report_version ? null : r.report_version)
                            }}
                            className="px-2 py-1 rounded bg-surface-container hover:bg-primary/20 text-primary font-label-sm text-label-sm font-semibold transition-colors cursor-pointer ml-1"
                          >
                            Load in View
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-primary px-2 py-1">Active</span>
                        )}
                        <span className="font-label-sm text-label-sm text-primary underline ml-2">
                          {openReport === r.id ? 'Hide' : 'Inspect'}
                        </span>
                      </div>
                    </div>
                  {openReport === r.id && (
                    <div className="p-space-md rounded-lg bg-surface-container-low/80 border border-outline-variant/30 ml-space-md">
                      <span className="font-label-sm text-secondary uppercase tracking-wider block mb-1">
                        Report v{r.report_version} Summary &amp; Factors
                      </span>
                      {r.conversation_summary && (
                        <p className="font-body-sm text-on-surface mb-2">{r.conversation_summary}</p>
                      )}
                      <div className="flex flex-col gap-1">
                        {r.factors.map((f) => (
                          <div key={f.code} className="flex items-center gap-2 text-xs">
                            <SeverityDot severity={f.severity} />
                            <span className="font-semibold">{f.label}</span>
                            {f.evidence && <span className="text-secondary italic">"{f.evidence}"</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Fragment>
              )
            })}
            </div>
          </div>
        </div>

        {/* ============================================== RIGHT COLUMN (38%) */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-space-lg">
          {/* 1. Latest Interaction Summary & Interactive Transcript */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-[20px]">mic</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  {isHistorical ? `Interaction (Report v${report?.report_version})` : 'Latest Interaction'}
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm font-semibold">
                {transcript?.channel === 'TEXT' ? 'Text Check-in' : 'Voice Check-in'}
              </span>
            </div>

            <div className="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-space-2xs text-on-surface-variant font-body-sm text-body-sm">
              <div className="flex items-center justify-between">
                <span>
                  Turns: <strong>{transcript?.messages.length ?? interactions[0]?.turn_count ?? '—'}</strong>
                </span>
                <span>
                  Language:{' '}
                  <strong>
                    {transcript?.language === 'hi' || detail.preferred_language === 'hi' ? 'Hindi / Hinglish' : (transcript?.language || detail.preferred_language)}
                  </strong>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Timestamp: {transcript?.started_at ? fmtDateTime(transcript.started_at) : (report ? fmtDateTime(report.created_at) : 'Today')}</span>
                <span>
                  Status: <strong>{interactions.find(i => i.interaction_id === currentInteractionId)?.status ?? 'COMPLETED'}</strong>
                </span>
              </div>
            </div>

            {report?.conversation_summary && (
              <div className="p-space-sm rounded-lg bg-surface-container-high/40">
                <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider block">
                  Clinical NLP Summary {isHistorical ? `(v${report.report_version})` : ''}
                </span>
                <p className="font-body-sm text-body-sm text-on-surface mt-1">
                  {report.conversation_summary}
                </p>
              </div>
            )}

            {/* Audio Snippet Visualizer & Interactive Player */}
            <div className="p-space-sm rounded-lg bg-surface-container flex items-center gap-space-sm border border-outline-variant/30">
              <button
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all shadow-sm ${
                  isPlayingAudio
                    ? 'bg-error text-on-error hover:opacity-90 animate-pulse'
                    : 'bg-primary text-on-primary hover:bg-primary-container'
                }`}
                type="button"
                onClick={playTranscript}
                title={isPlayingAudio ? 'Pause audio' : 'Play conversation audio'}
              >
                <span className="material-symbols-outlined text-[22px]">
                  {isPlayingAudio ? 'pause' : 'play_arrow'}
                </span>
              </button>
              <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs font-data-mono text-secondary">
                  <span className={isPlayingAudio ? 'text-primary font-bold' : ''}>
                    {formatTime(audioPlaybackSec)}
                  </span>
                  <span>{formatTime(totalDurationSec)}</span>
                </div>
                {/* Waveform Bars */}
                <div className="flex items-center gap-1 h-6">
                  {[4, 8, 16, 12, 20, 14, 8, 18, 12, 22, 16, 10, 6].map((h, idx) => (
                    <span
                      key={idx}
                      className={`w-1 rounded-full transition-all duration-150 ${
                        isPlayingAudio
                          ? 'bg-primary animate-pulse'
                          : 'bg-outline-variant'
                      }`}
                      style={{
                        height: isPlayingAudio
                          ? `${Math.max(6, (h * ((idx % 3) + 1) * 0.7) % 24)}px`
                          : `${Math.min(h, 10)}px`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleSpeed}
                className="px-2 py-1 rounded bg-surface-container-lowest hover:bg-surface-container-high font-data-mono text-xs text-on-surface border border-outline-variant/30 cursor-pointer"
                title="Change playback speed"
              >
                {playbackSpeed.toFixed(1)}x
              </button>
            </div>

            {/* Transcript Stream */}
            <div className="flex flex-col gap-space-sm max-h-80 overflow-y-auto pr-space-2xs">
              {!transcript || transcript.messages.length === 0 ? (
                <div className="p-space-md text-center text-secondary text-xs bg-surface-container-low rounded-lg">
                  {report ? `No transcript recorded for Report v${report.report_version}` : 'No transcript recorded'}
                </div>
              ) : (
                transcript.messages.map((m) => {
                  const isUser = m.role === 'USER'
                  const isSpeakingThis = activeSpeechSeq === m.seq
                  return (
                    <div
                      key={m.seq}
                      className={`flex flex-col gap-1 p-space-sm rounded-lg transition-all border ${
                        isSpeakingThis
                          ? 'bg-primary/15 border-primary ring-2 ring-primary/40 shadow-sm'
                          : isUser
                          ? 'bg-surface-container-low border-transparent'
                          : 'bg-surface-container border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-label-sm text-label-sm font-semibold ${
                              isUser ? 'text-primary' : 'text-surface-tint'
                            }`}
                          >
                            {isUser ? detail.display_name : 'VIORA Clinical AI'}
                          </span>
                          {isSpeakingThis && (
                            <span className="px-1.5 py-0.2 rounded bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider animate-pulse">
                              Playing
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-data-mono text-data-mono text-xs text-outline">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => playSingleMessage(m)}
                            className={`p-0.5 rounded transition-colors ${
                              isSpeakingThis ? 'text-primary font-bold' : 'text-secondary hover:text-primary'
                            }`}
                            title={isSpeakingThis ? 'Stop audio' : 'Listen to this message'}
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {isSpeakingThis ? 'stop_circle' : 'volume_up'}
                            </span>
                          </button>
                        </div>
                      </div>
                      <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{m.content}</p>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 2. Recommended Next Step & Follow-up Panel */}
          <div
            id="follow-up-cadence"
            className="bg-surface-container-high/50 rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md border border-outline-variant/30"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-space-sm">
                <div className="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">notifications_active</span>
                </div>
                <div>
                  <h4 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                    Follow-up &amp; Cadence
                  </h4>
                  <span className="font-label-sm text-label-sm text-primary font-semibold block mt-0.5">
                    {needsReview ? 'Urgent Clinician Review (Tier 1)' : 'Standard Routine Follow-up'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSchedulingOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-xs font-semibold hover:opacity-90 shadow-sm transition-opacity"
              >
                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                <span>Schedule</span>
              </button>
            </div>

            {detail.next_follow_up ? (
              <div className="bg-surface-container-lowest rounded-lg p-space-md flex flex-col gap-space-sm shadow-sm border border-outline-variant/20">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                    Next Active Touchpoint
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Source / Type badge */}
                    {detail.next_follow_up.source === 'AI' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-container/40 text-secondary border border-secondary/30 font-label-sm text-xs font-semibold">
                        <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                        VIORA AI
                      </span>
                    ) : detail.next_follow_up.source === 'COUNSELLOR' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary-container/40 text-primary border border-primary/30 font-label-sm text-xs font-semibold">
                        <span className="material-symbols-outlined text-[14px]">support_agent</span>
                        Counsellor
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-xs font-semibold">
                        <span className="material-symbols-outlined text-[14px]">auto_schedule</span>
                        Predicted Cadence
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full font-label-sm text-xs font-semibold ${
                        detail.next_follow_up.status === 'DUE'
                          ? 'bg-error/15 text-error font-bold animate-pulse'
                          : 'bg-surface-container text-on-surface'
                      }`}
                    >
                      {detail.next_follow_up.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-space-xs font-headline-sm text-sm font-bold text-on-surface">
                  <span className="material-symbols-outlined text-primary text-[20px]">calendar_month</span>
                  <span>{fmtDateTime(detail.next_follow_up.scheduled_for)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-on-surface-variant bg-surface-container/50 px-2 py-1 rounded">
                    <span className="material-symbols-outlined text-[16px]">
                      {detail.next_follow_up.channel === 'VOICE' ? 'call' : 'chat'}
                    </span>
                    <span>Channel: {detail.next_follow_up.channel}</span>
                  </div>
                  <div className="flex items-center gap-1 text-on-surface-variant bg-surface-container/50 px-2 py-1 rounded truncate">
                    <span className="material-symbols-outlined text-[16px]">category</span>
                    <span className="truncate">{detail.next_follow_up.reason || 'General check-in'}</span>
                  </div>
                </div>

                <CadenceExplanation followUp={detail.next_follow_up} />

                {/* Follow-up actions: Reschedule / Complete / Cancel */}
                <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/20">
                  <button
                    type="button"
                    onClick={() => setIsSchedulingOpen(true)}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit_calendar</span>
                    <span>Reschedule</span>
                  </button>
                  <button
                    type="button"
                    disabled={followUpLoading}
                    onClick={() => handleCompleteFollowUp(detail.next_follow_up!.id)}
                    className="py-1.5 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-label-sm text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">done_all</span>
                    <span>Complete</span>
                  </button>
                  <button
                    type="button"
                    disabled={followUpLoading}
                    onClick={() => handleCancelFollowUp(detail.next_follow_up!.id)}
                    className="py-1.5 px-3 rounded-lg bg-error-container/20 hover:bg-error-container/40 text-error font-label-sm text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-surface-container-lowest rounded-lg p-space-md flex flex-col items-center justify-center gap-space-xs text-center border border-dashed border-outline-variant/50">
                <span className="material-symbols-outlined text-outline-variant text-[32px]">event_busy</span>
                <span className="font-body-sm text-secondary">No active scheduled follow-up for this case.</span>
                <button
                  type="button"
                  onClick={() => setIsSchedulingOpen(true)}
                  className="mt-1 px-space-md py-1.5 rounded-lg bg-primary-container text-on-primary font-label-sm text-xs font-semibold hover:bg-primary transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">calendar_add_on</span>
                  <span>Schedule Follow-up</span>
                </button>
              </div>
            )}

            {/* Prior touchpoints & history */}
            {allFollowUps.filter((f) => !detail.next_follow_up || f.id !== detail.next_follow_up.id).length > 0 && (
              <details className="text-xs text-secondary group pt-1">
                <summary className="cursor-pointer font-semibold flex items-center gap-1 text-on-surface-variant hover:text-primary select-none">
                  <span className="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">chevron_right</span>
                  <span>Prior touchpoints &amp; history ({allFollowUps.filter((f) => !detail.next_follow_up || f.id !== detail.next_follow_up.id).length})</span>
                </summary>
                <div className="mt-2 flex flex-col gap-1.5 pl-3 border-l-2 border-outline-variant/30">
                  {allFollowUps
                    .filter((f) => !detail.next_follow_up || f.id !== detail.next_follow_up.id)
                    .slice(0, 5)
                    .map((f) => (
                      <div key={f.id} className="flex items-center justify-between text-on-surface py-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              f.status === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : f.status === 'CANCELLED'
                                ? 'bg-outline/20 text-outline'
                                : 'bg-primary-container text-on-primary'
                            }`}
                          >
                            {f.status}
                          </span>
                          <span className="font-medium text-xs">
                            {f.source === 'AI' ? '🤖 AI' : f.source === 'COUNSELLOR' ? '👤 Counsellor' : '⚙️ Cadence'}
                          </span>
                          <span className="text-secondary text-[11px]">{fmtDateTime(f.scheduled_for)}</span>
                        </div>
                        <span className="text-outline truncate max-w-[120px] text-[11px]">{f.reason}</span>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>

          {/* 3. Human Review Decision Station */}
          <div
            id="decision-station"
            className="bg-surface-container-lowest rounded-xl p-space-lg shadow-md flex flex-col gap-space-md border-2 border-primary/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="w-3 h-3 rounded-full bg-primary" />
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Human Review Decision Station
                </h3>
              </div>
              <span className="font-label-sm text-label-sm text-secondary font-medium">Dr. Sharma</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Sign-off on algorithmic evaluation and record mandatory clinical direction in accordance with medical compliance:
            </p>

            {saved && (
              <div className="p-space-sm rounded-lg bg-primary-container/20 text-primary font-label-md text-label-md flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-[20px]">verified</span>
                <span>Decision recorded: {saved}</span>
              </div>
            )}

            {/* Decision Radios */}
            <div className="flex flex-col gap-space-2xs">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                Clinical Determination
              </span>
              <label
                className={`flex items-center gap-space-sm p-space-sm rounded-lg cursor-pointer transition-colors ${
                  selectedOutcome === 'INTERVENTION_REQUIRED'
                    ? 'bg-primary-container/15 border border-primary/40'
                    : 'bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <input
                  type="radio"
                  name="clinical-decision"
                  value="INTERVENTION_REQUIRED"
                  checked={selectedOutcome === 'INTERVENTION_REQUIRED'}
                  onChange={() => setSelectedOutcome('INTERVENTION_REQUIRED')}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-on-surface font-semibold">
                    Intervention Required
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">
                    Direct outreach and modified safety care plan
                  </span>
                </div>
              </label>

              <label
                className={`flex items-center gap-space-sm p-space-sm rounded-lg cursor-pointer transition-colors ${
                  selectedOutcome === 'CONTINUE_MONITORING'
                    ? 'bg-primary-container/15 border border-primary/40'
                    : 'bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <input
                  type="radio"
                  name="clinical-decision"
                  value="CONTINUE_MONITORING"
                  checked={selectedOutcome === 'CONTINUE_MONITORING'}
                  onChange={() => setSelectedOutcome('CONTINUE_MONITORING')}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-on-surface font-semibold">
                    Continue Monitoring
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">
                    Telemetry cadence stays standard; no crisis escalation
                  </span>
                </div>
              </label>

              <label
                className={`flex items-center gap-space-sm p-space-sm rounded-lg cursor-pointer transition-colors ${
                  selectedOutcome === 'ESCALATE'
                    ? 'bg-error-container/20 border border-error/40'
                    : 'bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <input
                  type="radio"
                  name="clinical-decision"
                  value="ESCALATE"
                  checked={selectedOutcome === 'ESCALATE'}
                  onChange={() => setSelectedOutcome('ESCALATE')}
                  className="w-4 h-4 text-error focus:ring-error"
                />
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-error font-semibold">
                    Escalate to Crisis Unit
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">
                    Trigger emergency dispatch or inpatient hold
                  </span>
                </div>
              </label>

              <label
                className={`flex items-center gap-space-sm p-space-sm rounded-lg cursor-pointer transition-colors ${
                  selectedOutcome === 'CLOSED'
                    ? 'bg-primary-container/15 border border-primary/40'
                    : 'bg-surface-container-low hover:bg-surface-container'
                }`}
              >
                <input
                  type="radio"
                  name="clinical-decision"
                  value="CLOSED"
                  checked={selectedOutcome === 'CLOSED'}
                  onChange={() => setSelectedOutcome('CLOSED')}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <div className="flex flex-col">
                  <span className="font-label-md text-label-md text-on-surface font-semibold">
                    Case Discharge / Closed
                  </span>
                  <span className="font-body-sm text-body-sm text-secondary">
                    Release from active telemetry monitoring
                  </span>
                </div>
              </label>
            </div>

            {/* Action Items Checkboxes */}
            <div className="flex flex-col gap-space-2xs">
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                Prescribed Action Bundle
              </span>
              <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface cursor-pointer">
                <input defaultChecked className="rounded border-outline text-primary focus:ring-primary" type="checkbox" />
                <span>Immediate Counselling Outreach (Within 4 hrs)</span>
              </label>
              <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface cursor-pointer">
                <input defaultChecked className="rounded border-outline text-primary focus:ring-primary" type="checkbox" />
                <span>Safety Protocol Verification &amp; Safe Contact Check</span>
              </label>
              <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface cursor-pointer">
                <input className="rounded border-outline text-primary focus:ring-primary" type="checkbox" />
                <span>Medical / Psychiatric Consultation Referral</span>
              </label>
            </div>

            {/* Clinical Notes */}
            <div className="flex flex-col gap-space-2xs">
              <label className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold" htmlFor="review-notes">
                Clinical Notes &amp; Rationales
              </label>
              <textarea
                id="review-notes"
                rows={3}
                className="w-full p-space-sm bg-surface-container-low rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container border border-outline-variant/30"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Submit Button */}
            <button
              className="w-full py-space-sm px-space-md rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all flex items-center justify-center gap-space-xs shadow-sm font-semibold disabled:opacity-50"
              type="button"
              disabled={saving}
              onClick={submitDecision}
            >
              <span className="material-symbols-outlined text-[18px]">
                {saving ? 'sync' : 'verified'}
              </span>
              <span>
                {saving ? 'Logging to EHR...' : 'Submit Clinical Decision & Log to EHR'}
              </span>
            </button>
          </div>

          {/* 4. Telemetry Ingestion Timeline */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm border border-outline-variant/30">
            <h4 className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
              Telemetry Ingestion Timeline
            </h4>
            <div className="flex flex-col gap-space-xs font-body-sm text-body-sm">
              <div className="flex items-center gap-space-xs">
                <span className="font-data-mono text-data-mono text-xs text-outline">09:34 AM</span>
                <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                <span className="text-on-surface">Voice check-in completed</span>
              </div>
              <div className="flex items-center gap-space-xs">
                <span className="font-data-mono text-data-mono text-xs text-outline">09:35 AM</span>
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-on-surface">Acoustic &amp; NLP analysis generated report</span>
              </div>
              {needsReview && (
                <div className="flex items-center gap-space-xs">
                  <span className="font-data-mono text-data-mono text-xs text-outline">09:36 AM</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" />
                  <span className="text-error font-semibold">Urgent Human Review Flag triggered</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Follow-up Scheduling Modal */}
      <ScheduleModal
        isOpen={isSchedulingOpen}
        onClose={() => setIsSchedulingOpen(false)}
        caseId={caseId}
        patientName={detail.display_name}
        uid={detail.uid}
        safeContactStart={detail.safe_contact_start}
        safeContactEnd={detail.safe_contact_end}
        onSuccess={() => {
          load()
        }}
      />
    </div>
  )
}
