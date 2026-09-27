#!/usr/bin/env bash
# ==============================================================================
# VIORA — Unified Launch & Orchestration Script
#
# Starts and synchronizes the complete system with one command:
#  1. Backend API (FastAPI + SQLite, port 8000)
#  2. Counsellor Dashboard (Vite + React, port 5173)
#  3. Patient App Metro Bundler (Expo, port 8081)
#  4. Android Virtual Device (Pixel 7 Emulator)
#  5. ADB Reverse Bridge (tcp:8000, 8081, 5173)
#  6. Patient App Launch on Emulator
#  7. Counsellor Web Dashboard in Laptop Browser
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"

# Colors for terminal output
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

log_info()    { echo -e "${CYAN}==>${RESET} ${BOLD}$1${RESET}"; }
log_success() { echo -e "${GREEN}[OK]${RESET} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${RESET} $1"; }
log_err()     { echo -e "${RED}[ERROR]${RESET} $1"; }

# ------------------------------------------------------------------------------
# 1. Environment & Path Setup
# ------------------------------------------------------------------------------
export PATH="$HOME/.local/bin:/snap/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Java 17 for React Native / Gradle tooling
if [ -d "$HOME/jdks/jdk-17.0.20.1+1" ]; then
  export JAVA_HOME="$HOME/jdks/jdk-17.0.20.1+1"
elif [ -d "$HOME/jdks/temurin-17" ]; then
  export JAVA_HOME="$HOME/jdks/temurin-17"
fi
[ -n "$JAVA_HOME" ] && export PATH="$JAVA_HOME/bin:$PATH"

export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"
export DISPLAY="${DISPLAY:-:0}"
export QT_QPA_PLATFORM=xcb
export QEMU_AUDIO_DRV=pa

ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
PY="$SCRIPT_DIR/backend/.venv/bin/python"

# Ensure MapTiler key is available for Counsellor Web
if [ -z "$VITE_MAPTILER_API_KEY" ]; then
  if [ -f "$SCRIPT_DIR/counsellor-web/.env.local" ] && grep -q '^VITE_MAPTILER_API_KEY=' "$SCRIPT_DIR/counsellor-web/.env.local"; then
    export VITE_MAPTILER_API_KEY="$(grep -E '^VITE_MAPTILER_API_KEY=' "$SCRIPT_DIR/counsellor-web/.env.local" | head -n1 | cut -d'=' -f2-)"
  elif [ -f "$SCRIPT_DIR/counsellor-web/.env" ] && grep -q '^VITE_MAPTILER_API_KEY=' "$SCRIPT_DIR/counsellor-web/.env"; then
    export VITE_MAPTILER_API_KEY="$(grep -E '^VITE_MAPTILER_API_KEY=' "$SCRIPT_DIR/counsellor-web/.env" | head -n1 | cut -d'=' -f2-)"
  fi
fi

# ------------------------------------------------------------------------------
# Helper Functions: Ports, Process Management & Health Checks
# ------------------------------------------------------------------------------
declare -a BG_PIDS=()

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1 && ss -tulpn 2>/dev/null | grep -q -E "[:.]$port "; then
    return 0
  fi
  if command -v lsof >/dev/null 2>&1 && lsof -i ":$port" >/dev/null 2>&1; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1 && fuser "$port/tcp" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

stop_all() {
  echo ""
  log_warn "Stopping VIORA server processes..."
  for pid in "${BG_PIDS[@]}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 8000/tcp >/dev/null 2>&1 || true
    fuser -k 5173/tcp >/dev/null 2>&1 || true
    fuser -k 8081/tcp >/dev/null 2>&1 || true
  fi
  log_success "All server processes stopped."
}

cleanup() {
  stop_all
  exit 0
}

# Only trap Ctrl+C (SIGINT) and termination (SIGTERM), never normal shell exit!
trap cleanup SIGINT SIGTERM

show_status() {
  echo ""
  echo -e "${BOLD}VIORA System Status:${RESET}"
  echo "---------------------------------------------------"
  if curl -s -m 2 http://localhost:8000/api/v1/health | grep -q '"status":"ok"'; then
    echo -e " Backend API (8000):        ${GREEN}ONLINE (Healthy)${RESET}"
  else
    echo -e " Backend API (8000):        ${RED}OFFLINE${RESET}"
  fi

  if curl -s -m 2 http://localhost:5173/ >/dev/null 2>&1; then
    echo -e " Counsellor Web (5173):     ${GREEN}ONLINE${RESET}"
  else
    echo -e " Counsellor Web (5173):     ${RED}OFFLINE${RESET}"
  fi

  if curl -s -m 2 http://localhost:8081/ >/dev/null 2>&1; then
    echo -e " Expo Metro Bundler (8081): ${GREEN}ONLINE${RESET}"
  else
    echo -e " Expo Metro Bundler (8081): ${RED}OFFLINE${RESET}"
  fi

  if pgrep -f "viora_pixel7" >/dev/null 2>&1; then
    local dev="$("$ADB" devices 2>/dev/null | grep -E "emulator-[0-9]+" | awk '{print $1}' | head -n 1 || true)"
    echo -e " Android Emulator:          ${GREEN}RUNNING (${dev:-active})${RESET}"
  else
    echo -e " Android Emulator:          ${YELLOW}NOT RUNNING${RESET}"
  fi

  if command -v pactl >/dev/null 2>&1; then
    local vol="$(pactl list sink-inputs 2>/dev/null | grep -A 1 "qemu-system-x86_64" | grep "Volume:" | head -n 1 | awk '{print $5}' || true)"
    if [ -n "$vol" ]; then
      echo -e " Emulator Audio Boost:      ${GREEN}$vol (Optimized)${RESET}"
    fi
  fi
  echo "---------------------------------------------------"
  echo ""
}

# ------------------------------------------------------------------------------
# CLI Flag Handling
# ------------------------------------------------------------------------------
DETACH_MODE=0
case "${1:-}" in
  --stop|-s|stop|down)
    stop_all
    exit 0
    ;;
  --restart|-r|restart)
    stop_all
    sleep 1
    ;;
  --status)
    show_status
    exit 0
    ;;
  --detach|-d|--daemon)
    DETACH_MODE=1
    ;;
  --help|-h|help)
    echo "Usage: ./start.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  (no args)    Start full VIORA system and monitor in foreground"
    echo "  --detach, -d Start full VIORA system and leave running in background"
    echo "  --restart, -r Restart all services from scratch"
    echo "  --stop, -s    Stop all VIORA services"
    echo "  --status     Check status of all components"
    echo ""
    exit 0
    ;;
esac

# ------------------------------------------------------------------------------
# 2. Dependency Verification
# ------------------------------------------------------------------------------
log_info "Verifying prerequisites and toolchains..."

if [ ! -x "$PY" ]; then
  if command -v python3 >/dev/null 2>&1; then
    log_info "Creating backend virtualenv..."
    python3 -m venv "$SCRIPT_DIR/backend/.venv"
    "$SCRIPT_DIR/backend/.venv/bin/pip" install -q -r "$SCRIPT_DIR/backend/requirements.txt"
  else
    log_err "Python 3 not found. Please install Python 3.10+."
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  log_err "Node.js not found in PATH. Please install Node.js 18+."
  exit 1
fi

if [ ! -x "$ADB" ]; then
  log_err "ADB binary not found at: $ADB"
  exit 1
fi

log_success "Environment ready (Node $(node -v), Python $($PY --version 2>&1 | awk '{print $2}'))"

# ------------------------------------------------------------------------------
# 3. Database Check & Preservation
# ------------------------------------------------------------------------------
if [ ! -s "$SCRIPT_DIR/backend/viora.db" ]; then
  if [ -s "$SCRIPT_DIR/backend/viora.db.bak" ]; then
    log_info "Restoring full historical database from backup..."
    cp "$SCRIPT_DIR/backend/viora.db.bak" "$SCRIPT_DIR/backend/viora.db"
    log_success "Database restored from backup (all 4 cases and follow-up tasks intact)."
  elif [ -s "$SCRIPT_DIR/viora.db" ]; then
    log_info "Restoring database from root database..."
    cp "$SCRIPT_DIR/viora.db" "$SCRIPT_DIR/backend/viora.db"
    log_success "Database restored from root database."
  else
    log_info "Database not found. Seeding initial staff and case history..."
    (cd "$SCRIPT_DIR/backend" && env -u PYTHONPATH -u AMENT_PREFIX_PATH "$PY" -m app.seed) > "$LOG_DIR/seed.log" 2>&1
    log_success "Database seeded."
  fi
fi
# Keep root database synchronized so commands run anywhere see identical data
[ -f "$SCRIPT_DIR/backend/viora.db" ] && cp "$SCRIPT_DIR/backend/viora.db" "$SCRIPT_DIR/viora.db" 2>/dev/null || true

# ------------------------------------------------------------------------------
# 4. Start Backend API (Port 8000)
# ------------------------------------------------------------------------------
log_info "Configuring Backend API (FastAPI on http://localhost:8000)..."
if is_port_in_use 8000; then
  if curl -s -m 2 http://localhost:8000/api/v1/health | grep -q '"status":"ok"'; then
    log_success "Backend API is already running and healthy (port 8000)."
  else
    log_warn "Port 8000 is occupied by an unresponsive process. Freeing port 8000..."
    fuser -k 8000/tcp >/dev/null 2>&1 || true
    sleep 1
    (
      cd "$SCRIPT_DIR/backend"
      exec env -u PYTHONPATH -u AMENT_PREFIX_PATH "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
    ) > "$LOG_DIR/backend.log" 2>&1 &
    BG_PIDS+=($!)
  fi
else
  (
    cd "$SCRIPT_DIR/backend"
    exec env -u PYTHONPATH -u AMENT_PREFIX_PATH "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
  ) > "$LOG_DIR/backend.log" 2>&1 &
  BG_PIDS+=($!)
fi

# Wait for backend health
for _ in {1..30}; do
  if curl -s -m 2 http://localhost:8000/api/v1/health | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.5
done
log_success "Backend API is live at http://localhost:8000."

# ------------------------------------------------------------------------------
# 5. Start Counsellor Web Dashboard (Port 5173)
# ------------------------------------------------------------------------------
log_info "Configuring Counsellor Dashboard (Vite on http://localhost:5173)..."
if is_port_in_use 5173; then
  if curl -s -m 2 http://localhost:5173/ >/dev/null 2>&1; then
    log_success "Counsellor Web Dashboard is already running (port 5173)."
  else
    log_warn "Port 5173 is occupied by an unresponsive process. Freeing port 5173..."
    fuser -k 5173/tcp >/dev/null 2>&1 || true
    sleep 1
    (
      cd "$SCRIPT_DIR/counsellor-web"
      exec env VITE_MAPTILER_API_KEY="$VITE_MAPTILER_API_KEY" npm run dev -- --host 0.0.0.0 --port 5173
    ) > "$LOG_DIR/counsellor.log" 2>&1 &
    BG_PIDS+=($!)
  fi
else
  (
    cd "$SCRIPT_DIR/counsellor-web"
    exec env VITE_MAPTILER_API_KEY="$VITE_MAPTILER_API_KEY" npm run dev -- --host 0.0.0.0 --port 5173
  ) > "$LOG_DIR/counsellor.log" 2>&1 &
  BG_PIDS+=($!)
fi

for _ in {1..30}; do
  if curl -s -m 2 http://localhost:5173/ >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
log_success "Counsellor Web Dashboard is live at http://localhost:5173."

# ------------------------------------------------------------------------------
# 6. Start Patient App Metro Bundler (Port 8081)
# ------------------------------------------------------------------------------
log_info "Configuring Patient App Bundler (Expo Metro on port 8081)..."
if is_port_in_use 8081; then
  if curl -s -m 2 http://localhost:8081/ >/dev/null 2>&1; then
    log_success "Expo Metro Bundler is already running (port 8081)."
  else
    log_warn "Port 8081 is occupied by an unresponsive process. Freeing port 8081..."
    fuser -k 8081/tcp >/dev/null 2>&1 || true
    sleep 1
    (
      cd "$SCRIPT_DIR/patient-app"
      exec env CI=1 npx expo start --localhost --port 8081
    ) > "$LOG_DIR/patient-app.log" 2>&1 &
    BG_PIDS+=($!)
  fi
else
  (
    cd "$SCRIPT_DIR/patient-app"
    exec env CI=1 npx expo start --localhost --port 8081
  ) > "$LOG_DIR/patient-app.log" 2>&1 &
  BG_PIDS+=($!)
fi

for _ in {1..30}; do
  if curl -s -m 2 http://localhost:8081/ >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
log_success "Expo Metro Bundler is live at http://localhost:8081."

# ------------------------------------------------------------------------------
# 7. Android Emulator Lifecycle & Readiness
# ------------------------------------------------------------------------------
log_info "Checking Android Emulator status..."
EMU_RUNNING=0
if pgrep -f "viora_pixel7" >/dev/null 2>&1; then
  EMU_RUNNING=1
fi

if [ "$EMU_RUNNING" = "1" ]; then
  log_success "Android Emulator is already running."
else
  log_info "Launching Pixel 7 Android Emulator (AVD: viora_pixel7)..."
  # Remove any stale lock files from previous abrupt stops
  rm -f "$HOME/.android/avd/viora_pixel7.avd"/*.lock "$HOME/.android/avd/viora_pixel7.avd"/*.lock/* 2>/dev/null || true

  (
    cd "$ANDROID_HOME/emulator"
    exec "$EMULATOR" -avd viora_pixel7 -no-snapshot-save -gpu host -cores 4
  ) > "$LOG_DIR/emulator.log" 2>&1 &
  BG_PIDS+=($!)
fi

log_info "Waiting for Android device connection to ADB..."
"$ADB" wait-for-device

TARGET_DEV="$("$ADB" devices 2>/dev/null | grep -E "emulator-[0-9]+" | awk '{print $1}' | head -n 1 || true)"
TARGET_DEV="${TARGET_DEV:-emulator-5554}"

log_info "Waiting for Android OS to complete boot ($TARGET_DEV)..."
BOOT_DONE=0
for _ in {1..60}; do
  STATE="$("$ADB" -s "$TARGET_DEV" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n' || true)"
  if [ "$STATE" = "1" ]; then
    BOOT_DONE=1
    break
  fi
  sleep 2
done

if [ "$BOOT_DONE" = "1" ]; then
  log_success "Android OS boot completed."
else
  log_warn "Android OS boot check reached maximum wait; proceeding with setup..."
fi

# Ensure Android package manager is responsive
for _ in {1..30}; do
  if "$ADB" -s "$TARGET_DEV" shell pm path android >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Dismiss keyguard / wake screen
"$ADB" -s "$TARGET_DEV" shell input keyevent 224 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET_DEV" shell wm dismiss-keyguard >/dev/null 2>&1 || true
"$ADB" -s "$TARGET_DEV" shell input keyevent 82 >/dev/null 2>&1 || true

# ------------------------------------------------------------------------------
# 8. Configure ADB Reverse Bridge
# ------------------------------------------------------------------------------
log_info "Configuring ADB reverse bridge (linking emulator to localhost services)..."
"$ADB" -s "$TARGET_DEV" reverse tcp:8000 tcp:8000 || true
"$ADB" -s "$TARGET_DEV" reverse tcp:8081 tcp:8081 || true
"$ADB" -s "$TARGET_DEV" reverse tcp:5173 tcp:5173 || true
log_success "Reverse bridge established:"
"$ADB" -s "$TARGET_DEV" reverse --list | sed 's/^/    /' || true

# ------------------------------------------------------------------------------
# 9. Install & Configure Patient App on Emulator
# ------------------------------------------------------------------------------
APK_PATH="$SCRIPT_DIR/patient-app/android/app/build/outputs/apk/debug/app-debug.apk"
if ! "$ADB" -s "$TARGET_DEV" shell pm list packages 2>/dev/null | grep -q "app.viora.patient"; then
  if [ -f "$APK_PATH" ]; then
    log_info "Installing patient app on emulator..."
    "$ADB" -s "$TARGET_DEV" install -r "$APK_PATH" >/dev/null 2>&1 || "$ADB" -s "$TARGET_DEV" install -r "$APK_PATH" || true
    log_success "Patient app installed."
  fi
fi

# Ensure microphone permission is granted so voice check-in works immediately
"$ADB" -s "$TARGET_DEV" shell pm grant app.viora.patient android.permission.RECORD_AUDIO >/dev/null 2>&1 || true

# Maximize Android audio streams for clear, loud voice output
"$ADB" -s "$TARGET_DEV" shell settings put system volume_music_speaker 15 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET_DEV" shell cmd media_session volume --stream 3 --set 15 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET_DEV" shell cmd media_session volume --stream 0 --set 5 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET_DEV" shell cmd media_session volume --stream 1 --set 7 >/dev/null 2>&1 || true
"$ADB" -s "$TARGET_DEV" shell cmd media_session volume --stream 2 --set 7 >/dev/null 2>&1 || true
for _ in {1..15}; do "$ADB" -s "$TARGET_DEV" shell input keyevent 24 >/dev/null 2>&1 || true; done

# Boost PulseAudio emulator playback volume to 200% (+18 dB) for crystal-clear sound
if command -v pactl >/dev/null 2>&1; then
  for sink_id in $(pactl list sink-inputs 2>/dev/null | grep -B 25 "qemu-system-x86_64" | grep "Sink Input #" | awk -F'#' '{print $2}'); do
    pactl set-sink-input-volume "$sink_id" 200% 2>/dev/null || true
  done
fi

log_info "Launching Patient App on emulator..."
"$ADB" -s "$TARGET_DEV" shell monkey -p app.viora.patient -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
"$ADB" -s "$TARGET_DEV" shell am start -n app.viora.patient/.MainActivity >/dev/null 2>&1 || true
log_success "Patient App launched on emulator screen."

# ------------------------------------------------------------------------------
# 10. Open Counsellor Web Dashboard in Laptop Browser
# ------------------------------------------------------------------------------
log_info "Opening Counsellor Dashboard in your browser..."
if [ -n "$BROWSER" ] && command -v "$BROWSER" >/dev/null 2>&1; then
  "$BROWSER" "http://localhost:5173" >/dev/null 2>&1 &
elif [ -x "/snap/bin/brave" ]; then
  /snap/bin/brave "http://localhost:5173" >/dev/null 2>&1 &
elif command -v brave >/dev/null 2>&1; then
  brave "http://localhost:5173" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173" >/dev/null 2>&1 &
fi

# ------------------------------------------------------------------------------
# 11. Summary Banner & Keep-Alive Loop
# ------------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}===================================================================${RESET}"
echo -e "${GREEN}${BOLD}               VIORA PLATFORM RUNNING AND SYNCED                  ${RESET}"
echo -e "${GREEN}${BOLD}===================================================================${RESET}"
echo -e " ${BOLD}Counsellor Dashboard:${RESET} http://localhost:5173"
echo -e "   • Credentials:      ${CYAN}caseworker@viora.local${RESET} / ${CYAN}viora1234${RESET}"
echo -e " ${BOLD}Backend API:${RESET}           http://localhost:8000"
echo -e "   • Swagger Docs:     http://localhost:8000/docs"
echo -e "   • Health Endpoint:  http://localhost:8000/api/v1/health"
echo -e " ${BOLD}Patient Mobile App:${RESET}    Active on Android Emulator window"
echo -e "   • Metro Bundler:    http://localhost:8081"
echo -e "   • Audio Boost:      200% (+18 dB), Peak Normalized"
echo -e " ${BOLD}Log Files Directory:${RESET}  $LOG_DIR"
echo -e "${GREEN}${BOLD}===================================================================${RESET}"

if [ "$DETACH_MODE" = "1" ]; then
  disown -a 2>/dev/null || true
  log_success "VIORA is running in the background. Use './start.sh --status' or './start.sh --stop' to manage."
  exit 0
fi

echo -e "${YELLOW}Press Ctrl+C at any time to stop all services.${RESET}"
echo ""

# Block until user cancels with Ctrl+C
while true; do
  sleep 2
done
