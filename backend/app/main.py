"""VIORA backend entrypoint."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import counsellor, patient
from app.config import settings
from app.core.database import SessionLocal, init_db
from app.schemas import HealthResponse
from app.services import sarvam, scheduler, scoring

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger(__name__)


async def _scheduler_loop() -> None:
    """Advance follow-up states on an interval.

    In-process rather than a separate worker: at this scale a second process is
    more operational surface than it is worth, and the sweep is a handful of
    UPDATEs. If this grows, the seam to extract is `scheduler.sweep`.

    Runs in a threadpool because the sweep is synchronous SQLAlchemy — calling it
    directly would block the event loop and stall the API.
    """
    while True:
        try:
            await asyncio.sleep(settings.SCHEDULER_INTERVAL_SECONDS)
            db = SessionLocal()
            try:
                result = await asyncio.to_thread(scheduler.sweep, db)
            finally:
                db.close()
            if result.changed:
                logger.info(
                    "follow-up sweep: %s due, %s missed",
                    result.became_due, result.became_missed,
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a sweep failure must not kill the loop
            logger.exception("follow-up sweep failed; continuing")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logger.info(
        "VIORA backend ready (env=%s, voice=%s)",
        settings.APP_ENV,
        "configured" if sarvam.is_configured() else "NOT CONFIGURED",
    )
    if not sarvam.is_configured():
        logger.warning("SARVAM_API_KEY is unset — conversation and voice will degrade gracefully")

    # Sweep once at boot so a restart immediately reflects anything that came due
    # while the process was down.
    db = SessionLocal()
    try:
        scheduler.sweep(db)
    except Exception:  # noqa: BLE001
        logger.exception("initial follow-up sweep failed")
    finally:
        db.close()

    task: asyncio.Task | None = None
    if settings.SCHEDULER_ENABLED:
        task = asyncio.create_task(_scheduler_loop())
        logger.info(
            "follow-up scheduler running every %ss", settings.SCHEDULER_INTERVAL_SECONDS
        )

    yield

    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description=(
        "Conversational well-being and early-intervention platform. "
        "Patient app and counsellor dashboard are two views of one case."
    ),
    lifespan=lifespan,
)

# Explicit origins only — never "*", which is both unsafe and invalid alongside
# credentials. Add your laptop's LAN IP in .env when opening the dashboard from
# another machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patient.router)
app.include_router(counsellor.router)


@app.get("/api/v1/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        app=settings.APP_NAME,
        env=settings.APP_ENV,
        voice_available=sarvam.is_configured(),
        scoring_version=scoring.VERSION,
    )
