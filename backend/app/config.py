"""VIORA backend configuration.

All secrets are server-side only. Nothing in this file may ever be shipped to
the patient app or the counsellor web bundle. See docs/CONTRACT.md rule 6.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- app ---
    APP_NAME: str = "VIORA"
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    LOG_LEVEL: str = "INFO"

    # --- database ---
    # SQLite for this build; WAL mode is enabled in core/database.py to reduce
    # writer-lock contention between the patient app, dashboard and scheduler.
    # Swapping to Postgres is a change to this URL only.
    DATABASE_URL: str = "sqlite:///./viora.db"

    # --- Sarvam (SERVER-SIDE ONLY) ---
    # Every model id is overridable from .env: the vendor ships new versions on
    # its own schedule, and a model rename must never need a code change.
    #
    # These defaults were verified against the installed sarvamai SDK's own type
    # literals (see tests/test_sarvam_contract.py, which fails if a default
    # drifts out of what the SDK accepts). The earlier guesses — saarika:v2 and
    # sarvam-m — are NOT accepted by this SDK version.
    SARVAM_API_KEY: Optional[str] = None
    SARVAM_CHAT_MODEL: str = "sarvam-105b-conversations"
    SARVAM_STT_MODEL: str = "saaras:v3"
    SARVAM_TTS_MODEL: str = "bulbul:v3"
    # Female voice, calm and warm. Pace 1.0 is the vendor's natural rate:
    # deliberately slowing speech to sound "therapeutic" reads as condescending.
    SARVAM_TTS_SPEAKER: str = "anushka"
    SARVAM_TTS_PACE: float = 1.0
    SARVAM_TIMEOUT_SECONDS: float = 30.0

    # --- auth ---
    # MUST be overridden in .env for anything but local development. Padded to
    # 32 bytes because HS256 keys shorter than the SHA-256 block are weak
    # (RFC 7518 §3.2) — PyJWT warns on every encode otherwise, and a warning
    # nobody can act on trains people to ignore warnings that matter.
    JWT_SECRET: str = "dev-only-insecure-change-me-0000"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 12 * 60

    # --- CORS ---
    # Explicit origins only. Never "*" — the contract forbids it, and "*" with
    # credentials is invalid per the CORS spec anyway.
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # --- privacy ---
    # Audio is discarded after transcription unless a user explicitly opts in.
    AUDIO_RETENTION_DEFAULT: bool = False

    # --- follow-up policy (days), keyed by risk band. Contract §6. ---
    FOLLOWUP_DAYS_LOW: int = 14
    FOLLOWUP_DAYS_MODERATE: int = 7
    FOLLOWUP_DAYS_HIGH: int = 3
    FOLLOWUP_DAYS_CRITICAL: int = 1
    FOLLOWUP_DAYS_URGENT: int = 1
    FOLLOWUP_POLICY_VERSION: str = "1.0.0"

    # --- follow-up scheduler ---
    # In-process sweep that moves SCHEDULED → DUE → MISSED. Disable it in tests
    # or when running a one-off command; nothing else depends on it being on.
    SCHEDULER_ENABLED: bool = True
    SCHEDULER_INTERVAL_SECONDS: int = 300

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )


settings = Settings()
