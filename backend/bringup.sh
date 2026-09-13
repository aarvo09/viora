#!/bin/bash
# VIORA backend — bring-up and self-check. Run from anywhere.
#   bash backend/bringup.sh
# Instruction on Python first: we need 3.11–3.13 (3.14 may trip
# dependency wheels). `uv` is used if present — check with `command -v uv`.

set -e
cd "$(dirname "$0")"

PY=python3
command -v uv >/dev/null 2>&1 && PY="uv run --python 3.12"

echo "==> Python: $($PY --version 2>&1)"

echo "==> Installing requirements..."
PIP="python3 -m pip"
command -v uv >/dev/null 2>&1 && PIP="uv pip install --system"
$PY -m pip install --upgrade pip >/dev/null 2>&1 || true
$PY -m pip install -r requirements.txt >/dev/null 2>&1 || $PY -m pip install -r requirements.txt

echo "==> Compile check..."
$PY -m py_compile app/*.py app/core/*.py app/api/*.py app/services/*.py && echo "    compile OK"

echo "==> Unit tests (pure deterministic core)..."
$PY -m pytest tests/ -q 2>&1 | tail -20

echo "==> Seeding database (runs the real assessment pipeline) ..."
$PY -m app.seed

echo ""
echo "==> DONE. Start the server with:"
echo "    cd backend && $PY -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
echo "    Then open http://localhost:8000/docs"
echo ""
echo "    Dashboard login seeded: caseworker@viora.local / viora1234"
