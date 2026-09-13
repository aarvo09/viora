import { auth } from '../api/client'

export function Settings() {
  const staff = auth.staff()

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col gap-space-xs pb-space-sm border-b border-surface-container">
        <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
          Counsellor & Ward Settings
        </h1>
        <p className="font-body-md text-body-md text-secondary">
          Configure clinical notification thresholds, shift preferences, and unit routing rules.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-lg">
        {/* Clinician Profile */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container flex flex-col gap-space-md">
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[22px]">badge</span>
            <span>Clinician Identity & Role</span>
          </h2>
          <div className="flex items-center gap-space-md p-space-md rounded-xl bg-surface-container-low">
            <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary font-headline-xl text-headline-xl flex items-center justify-center font-bold">
              {(staff?.name || 'Dr. Sharma').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold block">
                {staff?.name || 'Dr. Sharma'}
              </span>
              <span className="font-body-sm text-body-sm text-secondary block mt-0.5">
                {staff?.role || 'Senior Clinical Counsellor'} · Unit Ward 3B
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm text-primary font-semibold mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                Active Duty Session
              </span>
            </div>
          </div>
        </div>

        {/* Triage & Alert Thresholds */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container flex flex-col gap-space-md">
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
            <span>Clinical Threshold Calibration</span>
          </h2>
          <div className="space-y-space-sm text-body-sm">
            <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
              <span className="text-secondary font-medium">Anomaly Alert Ceiling (Distress)</span>
              <span className="font-data-mono font-semibold text-error">60.0 / 100</span>
            </div>
            <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
              <span className="text-secondary font-medium">Safe Contact Window</span>
              <span className="font-data-mono font-semibold text-on-surface">10:00 – 17:00 IST</span>
            </div>
            <div className="flex items-center justify-between p-space-sm rounded-lg bg-surface-container-low">
              <span className="text-secondary font-medium">Telemetry Sampling Interval</span>
              <span className="font-data-mono font-semibold text-primary">Continuous (Live)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
