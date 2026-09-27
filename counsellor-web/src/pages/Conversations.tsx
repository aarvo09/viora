/* Conversations & Telemetry Transcripts Page.
 *
 * Implements Stitch UI/UX for inspecting voice and text check-in transcripts
 * across active cohort patients with bilingual dialogue stream and safety triggers.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseListItem, Transcript } from '../api/types'
import { Empty, Spinner } from '../components/primitives'

export function Conversations() {
  const [cases, setCases] = useState<CaseListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'VOICE' | 'TEXT'>('ALL')

  useEffect(() => {
    api
      .cases()
      .then((data) => {
        setCases(data)
        if (data.length > 0) {
          setSelectedCaseId(data[0].case_id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedCaseId) return
    setLoadingTranscript(true)
    api
      .interactions(selectedCaseId)
      .then((inter) => {
        if (inter.length > 0) {
          return api.transcript(inter[0].interaction_id)
        }
        return null
      })
      .then(setTranscript)
      .catch(() => setTranscript(null))
      .finally(() => setLoadingTranscript(false))
  }, [selectedCaseId])

  if (loading) return <Spinner label="Loading conversation streams" />

  const filteredCases = cases.filter((c) => {
    const matchesSearch =
      c.display_name.toLowerCase().includes(search.toLowerCase()) ||
      c.uid.toLowerCase().includes(search.toLowerCase()) ||
      c.case_ref.toLowerCase().includes(search.toLowerCase())
    return matchesSearch
  })

  const selectedCase = cases.find((c) => c.case_id === selectedCaseId)

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Context Header */}
      <div className="flex flex-col gap-space-md mb-space-xs">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div>
            <div className="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm mb-space-2xs uppercase tracking-wider font-semibold">
              <span>Telemetry Stream</span>
              <span className="w-1 h-1 rounded-full bg-outline-variant" />
              <span className="text-primary font-medium">Synchronized Real-Time Ingestion</span>
            </div>
            <h1 className="font-headline-xl text-headline-xl text-on-surface font-bold">
              Patient Conversations &amp; Telemetry Transcripts
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Recent AI voice and text check-ins across active cohort
            </p>
          </div>
          <div className="flex items-center gap-space-sm px-space-md py-space-xs bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30">
            <span className="material-symbols-outlined text-primary text-[18px]">graphic_eq</span>
            <span className="font-label-sm text-on-surface-variant">NLP Pipeline v4.2 Active</span>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-space-md bg-surface-container-lowest p-space-xs rounded-xl shadow-sm border border-outline-variant/30">
          <div className="flex items-center gap-space-xs">
            <button
              type="button"
              className={`px-space-md py-space-xs rounded-lg font-label-md text-label-md transition-colors ${
                channelFilter === 'ALL'
                  ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
              onClick={() => setChannelFilter('ALL')}
            >
              All ({cases.length})
            </button>
            <button
              type="button"
              className={`px-space-md py-space-xs rounded-lg font-label-md text-label-md transition-colors ${
                channelFilter === 'VOICE'
                  ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
              onClick={() => setChannelFilter('VOICE')}
            >
              Voice Calls
            </button>
            <button
              type="button"
              className={`px-space-md py-space-xs rounded-lg font-label-md text-label-md transition-colors ${
                channelFilter === 'TEXT'
                  ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
              onClick={() => setChannelFilter('TEXT')}
            >
              Text Check-ins
            </button>
          </div>
          <div className="relative flex items-center w-72">
            <span className="material-symbols-outlined absolute left-space-sm text-on-surface-variant text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search conversations..."
              className="w-full pl-9 pr-space-sm py-1.5 bg-surface-container-low rounded-lg font-body-sm text-on-surface focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Split Stream Layout: Left Patient List / Right Live Transcript */}
      <div className="grid grid-cols-12 gap-space-lg items-start">
        {/* Left List */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-space-xs">
          {filteredCases.map((c) => {
            const isSelected = c.case_id === selectedCaseId
            const initials = c.display_name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()
            return (
              <div
                key={c.case_id}
                onClick={() => setSelectedCaseId(c.case_id)}
                className={`p-space-md rounded-xl cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-surface-container-lowest shadow-md border-primary/50'
                    : 'bg-surface-container-lowest/80 hover:bg-surface-container-lowest shadow-sm border-outline-variant/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-sm">
                    <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center font-bold text-primary text-sm">
                      {initials}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-headline-sm text-sm font-bold text-on-surface">
                        {c.display_name}
                      </span>
                      <span className="font-data-mono text-xs text-secondary">{c.uid}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container text-secondary font-label-sm text-xs">
                    {c.preferred_language === 'hi' ? 'Hindi' : 'English'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
                  <span>Risk: <strong>{c.risk_level ?? 'LOW'}</strong></span>
                  <span>{c.last_check_in ? new Date(c.last_check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Right Transcript Viewer */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-space-md">
          {selectedCase && (
            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30 flex flex-col gap-space-md">
              <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30">
                <div>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                    {selectedCase.display_name} — Telemetry Transcript
                  </h3>
                  <span className="font-body-sm text-secondary text-xs">
                    {selectedCase.uid} • Ref: {selectedCase.case_ref}
                  </span>
                </div>
                <Link
                  to={`/cases/${selectedCase.case_id}`}
                  className="px-space-md py-1.5 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-colors flex items-center gap-1 font-semibold"
                >
                  <span>Open Case Workspace</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              </div>

              {/* Transcript Bubbles */}
              {loadingTranscript ? (
                <Spinner label="Loading conversation transcript..." />
              ) : !transcript || transcript.messages.length === 0 ? (
                <Empty>No transcript recorded for this patient yet.</Empty>
              ) : (
                <div className="flex flex-col gap-space-sm max-h-[600px] overflow-y-auto pr-space-xs">
                  {transcript.messages.map((m) => {
                    const isUser = m.role === 'USER'
                    return (
                      <div
                        key={m.seq}
                        className={`flex flex-col gap-1 p-space-md rounded-xl max-w-[85%] ${
                          isUser
                            ? 'bg-surface-container-low self-start border border-outline-variant/20'
                            : 'bg-primary-container/10 self-end border border-primary/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-space-md">
                          <span
                            className={`font-label-sm text-xs font-bold ${
                              isUser ? 'text-primary' : 'text-surface-tint'
                            }`}
                          >
                            {isUser ? selectedCase.display_name : 'VIORA AI'}
                          </span>
                          <span className="font-data-mono text-[10px] text-outline">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="font-body-sm text-on-surface mt-1">{m.content}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
