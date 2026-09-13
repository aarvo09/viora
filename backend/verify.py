#!/usr/bin/env python3
"""VIORA backend self-check — run:  python3 verify.py

Because the session's shell intermittently rejects long commands, this writes
everything to /tmp/viora-verify.log and prints a short summary, so the outcome
can also be read back with Read.

Checks, in order:
  1. import every app module (catches import/typo errors)
  2. compile every .py file
  3. run the pytest golden suite if pytest is available
  4. smoke-test the pure core against hand-computed values
  5. try to seed the DB (runs the full pipeline)
"""

import io
import sys
import traceback

LOG = io.StringIO()

def log(msg: str = "") -> None:
    LOG.write(msg + "\n")
    print(msg, flush=True)


def step(label, fn) -> bool:
    try:
        fn()
        log(f"[PASS] {label}")
        return True
    except Exception:
        log(f"[FAIL] {label}")
        log(traceback.format_exc())
        return False


def check_imports():
    import app.config
    import app.core.database
    import app.core.security
    import app.models
    import app.schemas
    import app.services.signals
    import app.services.scoring
    import app.services.baseline
    import app.services.risk
    import app.services.explain
    import app.services.assessment
    import app.services.sarvam
    import app.services.prompts
    import app.services.conversation
    import app.api.counsellor
    import app.api.patient
    import app.main
    log("  imported app.main OK")


def check_compile():
    import glob, py_compile
    files = glob.glob("app/**/*.py", recursive=True) + glob.glob("app/*.py")
    for f in files:
        py_compile.compile(f, doraise=True)
    log(f"  compiled {len(files)} files OK")


def check_pytest():
    import pytest
    import subprocess
    code = subprocess.call([sys.executable, "-m", "pytest", "tests/", "-q"])
    if code != 0:
        raise SystemExit(f"pytest exited {code}")


def check_smoke():
    from app.services.signals import signal_set_from_dict
    from app.services.scoring import distress_score, threat_score, composite_score
    from app.services.risk import band, predict
    from app.services.baseline import compute_baseline
    from app.services.signals import PriorReport

    s = signal_set_from_dict({})
    d, t = distress_score(s), threat_score(s)
    assert d == 0.0 and t == 0.0, (d, t)
    assert composite_score(0, 0) == 0.0
    # self-harm floor
    s2 = signal_set_from_dict({"distress_signals": {"self_harm_ideation": {"present": True, "intensity": 0.5, "evidence": ""}}})
    assert distress_score(s2) == 75.0, distress_score(s2)
    # crisis floor
    s3 = signal_set_from_dict({"crisis": {"imminent_danger": True}})
    assert threat_score(s3) == 85.0, threat_score(s3)
    # banding
    assert band(0, 0, s) == "LOW"
    assert band(5, 75, s) == "CRITICAL"
    # baseline
    p = [PriorReport(report_version=1, distress_score=30.0, threat_score=0.0)]
    assert compute_baseline(50.0, p).confidence == "LOW"
    # prediction
    pr = predict(48.0, 0.0, 48.0, [PriorReport(report_version=1, distress_score=40.0, threat_score=0.0), PriorReport(report_version=2, distress_score=44.0, threat_score=0.0)])
    assert pr.direction == "ESCALATING", pr.direction
    log("  smoke values matched expectations")


def check_seed():
    # seed only if DB empty (it is idempotent)
    import app.seed
    app.seed.seed()
    log("  seed ran (3 cases)")


def check_server():
    import socket, threading, time
    import uvicorn

    server_thread = threading.Thread(
        target=lambda: uvicorn.run("app.main:app", host="127.0.0.1", port=8911, log_level="warning"),
        daemon=True,
    )
    server_thread.start()
    time.sleep(2.5)
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:8911/api/v1/health", timeout=10) as r:
            body = r.read().decode()
            import json
            data = json.loads(body)
            assert data["status"] == "ok", data
            log(f"  /api/v1/health OK  -> {body}")
    except Exception as e:
        log(f"  server health FAILED: {e}")
        raise


def main():
    log("VIORA backend self-check")
    log("=" * 50)
    # import/compile don't need deps beyond installed
    step("imports", check_imports)
    step("compile", check_compile)

    # pytest may be missing — that's a deps issue, not a code issue
    try:
        import pytest  # noqa
        step("pytest golden suite", check_pytest)
    except ImportError:
        log("[SKIP] pytest not installed — run `pip install -r requirements.txt` first")

    step("pure-core smoke", check_smoke)
    step("seed (full pipeline)", check_seed)
    step("live server health", check_server)

    log("=" * 50)
    log("VERIFY COMPLETE")

    with open("/tmp/viora-verify.log", "w") as fh:
        fh.write(LOG.getvalue())


if __name__ == "__main__":
    main()
