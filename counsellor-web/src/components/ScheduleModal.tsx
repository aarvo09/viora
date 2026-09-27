import { useState, useId } from 'react'
import { api } from '../api/client'
import type { FollowUp, ScheduleCallRequest } from '../api/types'

interface ScheduleModalProps {
  caseId: number
  patientName: string
  uid: string
  safeContactStart?: string | null
  safeContactEnd?: string | null
  preferredChannel?: string | null
  isOpen: boolean
  onClose: () => void
  onSuccess: (followUp: FollowUp) => void
}

const REASONS = [
  'Routine check-in',
  'Increased distress',
  'Missed check-in',
  'Post-intervention reassessment',
  'Counsellor requested',
  'Risk reassessment',
  'Other',
]

export function ScheduleModal({
  caseId,
  patientName,
  uid,
  safeContactStart,
  safeContactEnd,
  preferredChannel,
  isOpen,
  onClose,
  onSuccess,
}: ScheduleModalProps) {
  if (!isOpen) return null

  const modalId = useId()

  // Default to tomorrow 6:30 PM in local time
  const now = new Date()
  const defaultDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  defaultDate.setHours(18, 30, 0, 0)

  const pad = (n: number) => n.toString().padStart(2, '0')
  const toDateInputStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const toTimeInputStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const [followUpType, setFollowUpType] = useState<'AI' | 'COUNSELLOR'>('AI')
  const [dateStr, setDateStr] = useState(toDateInputStr(defaultDate))
  const [timeStr, setTimeStr] = useState(toTimeInputStr(defaultDate))
  const [channel, setChannel] = useState<'VOICE' | 'TEXT'>(
    (preferredChannel === 'TEXT' ? 'TEXT' : 'VOICE')
  )
  const [reason, setReason] = useState('Increased distress')
  const [customReason, setCustomReason] = useState('')
  const [note, setNote] = useState('')
  const [overrideSafeWindow, setOverrideSafeWindow] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<FollowUp | null>(null)

  // Safe window parsing
  const safeStart = safeContactStart?.slice(0, 5) || '10:00'
  const safeEnd = safeContactEnd?.slice(0, 5) || '21:00'

  function checkSafeWindow(t: string): boolean {
    if (!t) return true
    const [h, m] = t.split(':').map(Number)
    const mins = h * 60 + m
    const [sh, sm] = safeStart.split(':').map(Number)
    const startMins = sh * 60 + sm
    const [eh, em] = safeEnd.split(':').map(Number)
    const endMins = eh * 60 + em

    if (startMins <= endMins) {
      return mins >= startMins && mins <= endMins
    }
    return mins >= startMins || mins <= endMins
  }

  function checkQuietHours(t: string): boolean {
    if (!t) return false
    const [h] = t.split(':').map(Number)
    // 21:00 (9 PM) to 08:00 (8 AM)
    return h >= 21 || h < 8
  }

  const isInsideSafeWindow = checkSafeWindow(timeStr)
  const isQuietHours = checkQuietHours(timeStr)

  function applyPreset(preset: 'plus1min' | 'plus1hour' | 'tomorrow10am' | 'tomorrow630pm') {
    const d = new Date()
    if (preset === 'plus1min') {
      // 75 seconds from now so it comes due in ~1 minute
      d.setTime(d.getTime() + 75 * 1000)
    } else if (preset === 'plus1hour') {
      d.setTime(d.getTime() + 60 * 60 * 1000)
    } else if (preset === 'tomorrow10am') {
      d.setDate(d.getDate() + 1)
      d.setHours(10, 0, 0, 0)
    } else if (preset === 'tomorrow630pm') {
      d.setDate(d.getDate() + 1)
      d.setHours(18, 30, 0, 0)
    }
    setDateStr(toDateInputStr(d))
    setTimeStr(toTimeInputStr(d))
    setErrorMsg(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg(null)

    if (!dateStr || !timeStr) {
      setErrorMsg('Please specify both a date and a time.')
      return
    }

    const scheduledDate = new Date(`${dateStr}T${timeStr}:00`)
    if (isNaN(scheduledDate.getTime())) {
      setErrorMsg('Please enter a valid date and time format.')
      return
    }

    if (scheduledDate.getTime() <= Date.now()) {
      setErrorMsg('Scheduled time must be in the future.')
      return
    }

    if (!isInsideSafeWindow && !overrideSafeWindow) {
      setErrorMsg(
        `Selected time is outside ${patientName}'s safe contact window (${safeStart} – ${safeEnd} IST). Please choose a time in the window or confirm clinician override.`
      )
      return
    }

    if (followUpType === 'AI' && isQuietHours && !overrideSafeWindow) {
      setErrorMsg(
        'Automated AI check-ins are restricted during quiet hours (9:00 PM – 8:00 AM IST).'
      )
      return
    }

    const actualReason = reason === 'Other' ? (customReason.trim() || 'Other reason') : reason

    setIsSubmitting(true)

    try {
      const payload: ScheduleCallRequest = {
        scheduled_for: scheduledDate.toISOString(),
        channel,
        follow_up_type: followUpType,
        reason: actualReason,
        note: note.trim() || undefined,
      }

      const res = await api.scheduleFollowUp(caseId, payload)
      setSuccessInfo(res)
      setTimeout(() => {
        onSuccess(res)
        onClose()
      }, 1500)
    } catch (err: any) {
      const msg = err?.message || "Couldn't schedule the follow-up. Please try again."
      setErrorMsg(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-inverse-surface/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog" 
        aria-modal="true" 
        aria-labelledby={`${modalId}-title`}
      >
        {/* Modal Header */}
        <div className="px-space-lg pt-space-lg pb-space-md border-b border-surface-container flex items-start justify-between bg-surface-container-low/40">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[22px]">calendar_add_on</span>
            </div>
            <div>
              <h2 id={`${modalId}-title`} className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Schedule Follow-up
              </h2>
              <span className="font-body-sm text-body-sm text-secondary block mt-0.5">
                Case for <strong className="text-on-surface font-medium">{patientName}</strong> · #{uid}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-secondary hover:bg-surface-container hover:text-on-surface transition-colors"
            title="Close dialog"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Success Confirmation State */}
        {successInfo ? (
          <div className="p-space-xl flex flex-col items-center justify-center text-center gap-space-md">
            <div className="w-16 h-16 rounded-full bg-risk-low-tint text-risk-low flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[36px]">check_circle</span>
            </div>
            <div>
              <h3 className="font-headline-lg text-headline-lg text-on-surface font-bold">
                Follow-up Scheduled
              </h3>
              <p className="font-body-md text-body-md text-secondary mt-1">
                {successInfo.source === 'AI' ? 'VIORA AI Follow-up' : 'Counsellor Follow-up'}
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container text-primary font-label-md text-label-md font-semibold mt-3">
                <span className="material-symbols-outlined text-[18px]">event</span>
                <span>{new Date(successInfo.scheduled_for).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span>·</span>
                <span className="capitalize">{successInfo.channel.toLowerCase()}</span>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto p-space-lg gap-space-lg">
            {errorMsg && (
              <div className="p-space-md rounded-xl bg-error-container/40 border border-error/30 text-on-error-container flex items-start gap-space-sm text-body-sm">
                <span className="material-symbols-outlined text-error text-[20px] flex-shrink-0 mt-0.5">error</span>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* 1. Follow-up Type Selector */}
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                Follow-up Type
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                {/* AI-Led */}
                <label 
                  className={`p-space-md rounded-xl border flex flex-col gap-space-xs cursor-pointer transition-all ${
                    followUpType === 'AI' 
                      ? 'bg-primary-tint/30 border-primary ring-2 ring-primary/20' 
                      : 'bg-surface-container-lowest border-surface-container hover:bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-space-xs font-headline-sm text-headline-sm text-on-surface font-semibold">
                      <input 
                        type="radio" 
                        name="followUpType" 
                        value="AI" 
                        checked={followUpType === 'AI'} 
                        onChange={() => setFollowUpType('AI')}
                        className="text-primary accent-primary" 
                      />
                      <span>VIORA AI Follow-up</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-primary-container text-on-primary text-[11px] font-semibold">
                      AUTOMATED
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-secondary pl-5">
                    VIORA will conduct an automated check-in at the scheduled time.
                  </p>
                </label>

                {/* Counsellor-Led */}
                <label 
                  className={`p-space-md rounded-xl border flex flex-col gap-space-xs cursor-pointer transition-all ${
                    followUpType === 'COUNSELLOR' 
                      ? 'bg-primary-tint/30 border-primary ring-2 ring-primary/20' 
                      : 'bg-surface-container-lowest border-surface-container hover:bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-space-xs font-headline-sm text-headline-sm text-on-surface font-semibold">
                      <input 
                        type="radio" 
                        name="followUpType" 
                        value="COUNSELLOR" 
                        checked={followUpType === 'COUNSELLOR'} 
                        onChange={() => setFollowUpType('COUNSELLOR')}
                        className="text-primary accent-primary" 
                      />
                      <span>Counsellor Follow-up</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-secondary text-inverse-on-surface text-[11px] font-semibold">
                      CLINICIAN
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-secondary pl-5">
                    A live counsellor will follow up directly with the patient.
                  </p>
                </label>
              </div>
            </div>

            {/* 2. Date & Time Selection */}
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center justify-between">
                <label className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                  Scheduled Time (Asia/Kolkata · IST)
                </label>
                {/* Presets */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyPreset('plus1min')}
                    className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-container text-primary hover:bg-primary hover:text-on-primary transition-colors"
                    title="Set to ~1 minute in the future for live scheduler verification"
                  >
                    +1 min (Test)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('plus1hour')}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-surface-container text-secondary hover:bg-surface-container-high transition-colors"
                  >
                    +1h
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('tomorrow630pm')}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-surface-container text-secondary hover:bg-surface-container-high transition-colors"
                  >
                    Tomorrow 6:30 PM
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-space-sm top-1/2 -translate-y-1/2 text-secondary text-[20px]">
                    calendar_today
                  </span>
                  <input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="w-full pl-10 pr-3 py-space-xs rounded-lg border border-surface-container bg-surface-container-lowest font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                    required
                  />
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-space-sm top-1/2 -translate-y-1/2 text-secondary text-[20px]">
                    schedule
                  </span>
                  <input
                    type="time"
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                    className="w-full pl-10 pr-3 py-space-xs rounded-lg border border-surface-container bg-surface-container-lowest font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              {/* Safe Contact & Quiet Hours Feedback */}
              <div className="mt-1 p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1 text-body-sm">
                <div className="flex items-center justify-between text-secondary">
                  <span>Patient safe contact window:</span>
                  <strong className="text-on-surface font-semibold">{safeStart} – {safeEnd} IST</strong>
                </div>

                {!isInsideSafeWindow && (
                  <div className="text-error font-medium flex items-center gap-1 mt-1">
                    <span className="material-symbols-outlined text-[16px]">warning</span>
                    <span>This time is outside the patient's preferred contact window.</span>
                  </div>
                )}

                {isQuietHours && (
                  <div className="text-risk-high font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">bedtime</span>
                    <span>This time falls within night quiet hours (9:00 PM – 8:00 AM).</span>
                  </div>
                )}

                {(!isInsideSafeWindow || isQuietHours) && (
                  <label className="flex items-center gap-2 mt-1.5 text-xs text-on-surface cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideSafeWindow}
                      onChange={(e) => setOverrideSafeWindow(e.target.checked)}
                      className="rounded text-primary accent-primary"
                    />
                    <span>Clinician Override: Patient explicitly confirmed availability at this hour.</span>
                  </label>
                )}
              </div>
            </div>

            {/* 3. Channel Selection */}
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                Interaction Channel
              </label>
              <div className="flex gap-space-sm">
                <button
                  type="button"
                  onClick={() => setChannel('VOICE')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-space-md rounded-lg font-label-md text-label-md border transition-all ${
                    channel === 'VOICE'
                      ? 'bg-primary-container text-on-primary border-primary shadow-sm font-semibold'
                      : 'bg-surface-container-lowest text-on-surface border-surface-container hover:bg-surface-container-low'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">mic</span>
                  <span>Voice Call (Audio)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChannel('TEXT')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-space-md rounded-lg font-label-md text-label-md border transition-all ${
                    channel === 'TEXT'
                      ? 'bg-primary-container text-on-primary border-primary shadow-sm font-semibold'
                      : 'bg-surface-container-lowest text-on-surface border-surface-container hover:bg-surface-container-low'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">chat</span>
                  <span>Text Chat</span>
                </button>
              </div>
            </div>

            {/* 4. Reason */}
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                Reason for Follow-up
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full p-space-xs px-space-sm rounded-lg border border-surface-container bg-surface-container-lowest font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              {reason === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify custom reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="mt-1 w-full p-space-xs px-space-sm rounded-lg border border-surface-container bg-surface-container-lowest font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary"
                  required
                />
              )}
            </div>

            {/* 5. Optional Directive Note */}
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-semibold">
                Caseworker Directive / Note (Optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Specific guidance, context or prompts for this check-in..."
                className="w-full p-space-sm rounded-lg border border-surface-container bg-surface-container-lowest font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Actions */}
            <div className="pt-space-md border-t border-surface-container flex items-center justify-end gap-space-sm">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-space-md py-space-xs rounded-lg border border-surface-container bg-surface-container-lowest text-on-surface font-label-md text-label-md hover:bg-surface-container-low transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-space-lg py-space-xs rounded-lg bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-colors shadow-sm disabled:opacity-50 font-semibold"
              >
                {isSubmitting && <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin"></span>}
                <span>Schedule Follow-up</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
