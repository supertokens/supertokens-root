#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_TOOLS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEV_TOOLS_DIR")"
MCP_CLIENT="$SCRIPT_DIR/mcp-client.mjs"

POLL_INTERVAL="${POLL_INTERVAL:-30}"
LOG_PID=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options] [-- test-args...]

Starts tests, streams MCP container logs, and waits for completion.

Options:
  --filter <pattern>   Test filter pattern (passed to test command)
  --clean              Clean before testing
  --skip-build         Skip build step
  --poll <seconds>     Poll interval for status checks (default: 30)
  -h, --help           Show this help

Examples:
  $(basename "$0")
  $(basename "$0") --filter "MyTest"
  $(basename "$0") --filter "*Integration*" --clean
  $(basename "$0") --poll 10 --filter "FastTest"
EOF
}

cleanup() {
  if [[ -n "$LOG_PID" ]]; then
    echo ""
    echo "▸ Stopping log stream..."
    # Kill the process group (negative PID) to ensure all child processes are terminated
    kill -TERM -"$LOG_PID" 2>/dev/null || kill -TERM "$LOG_PID" 2>/dev/null || true
    sleep 0.5
    kill -KILL -"$LOG_PID" 2>/dev/null || kill -KILL "$LOG_PID" 2>/dev/null || true
    wait "$LOG_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

# Parse arguments
declare -a TEST_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --filter)
      TEST_ARGS+=(--filter "$2")
      shift 2
      ;;
    --clean)
      TEST_ARGS+=(--clean)
      shift
      ;;
    --skip-build)
      TEST_ARGS+=(--skip-build)
      shift
      ;;
    --poll)
      POLL_INTERVAL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      TEST_ARGS+=("$@")
      break
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

cd "$PROJECT_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Start the tests
# ─────────────────────────────────────────────────────────────────────────────
echo "▸ Starting tests..."
if [[ ${#TEST_ARGS[@]} -gt 0 ]]; then
  echo "  Args: ${TEST_ARGS[*]}"
  TEST_OUTPUT=$("$MCP_CLIENT" test "${TEST_ARGS[@]}" 2>&1) || {
    echo "Failed to start tests:"
    echo "$TEST_OUTPUT"
    exit 1
  }
else
  TEST_OUTPUT=$("$MCP_CLIENT" test 2>&1) || {
    echo "Failed to start tests:"
    echo "$TEST_OUTPUT"
    exit 1
  }
fi

echo "$TEST_OUTPUT"
echo ""

# Extract task ID from output - look for "Task ID: xxx" pattern first
TASK_ID=$(echo "$TEST_OUTPUT" | grep -oE 'Task ID: [a-zA-Z0-9_-]+' | head -1 | sed 's/Task ID: //' || true)

# Try JSON format: "taskId": "xxx"
if [[ -z "$TASK_ID" ]]; then
  TASK_ID=$(echo "$TEST_OUTPUT" | grep -oE '"taskId"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)
fi

# Try UUID format
if [[ -z "$TASK_ID" ]]; then
  TASK_ID=$(echo "$TEST_OUTPUT" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1 || true)
fi

# Try task-N-xxx format
if [[ -z "$TASK_ID" ]]; then
  TASK_ID=$(echo "$TEST_OUTPUT" | grep -oE 'task-[0-9]+-[a-zA-Z0-9]+' | head -1 || true)
fi

if [[ -z "$TASK_ID" ]]; then
  echo "⚠️  Could not extract task ID from output. Tests may have completed synchronously."
  echo "   Check the output above for results."
  exit 0
fi

echo "▸ Task ID: $TASK_ID"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 2. Start streaming logs in the background
# ─────────────────────────────────────────────────────────────────────────────
echo "▸ Streaming MCP container logs (Ctrl+C to stop)..."
echo "─────────────────────────────────────────────────────────────────────────────"

# Start in its own process group so we can kill all child processes
set -m
docker compose logs -n 10 -f mcp 2>&1 &
LOG_PID=$!
set +m

# ─────────────────────────────────────────────────────────────────────────────
# 3. Poll for test completion
# ─────────────────────────────────────────────────────────────────────────────
while true; do
  sleep "$POLL_INTERVAL"

  # Check if log process is still running (container might have stopped)
  if ! kill -0 "$LOG_PID" 2>/dev/null; then
    echo ""
    echo "⚠️  Log streaming stopped unexpectedly"
  fi

  # Get task status
  STATUS_OUTPUT=$("$MCP_CLIENT" status "$TASK_ID" 2>&1) || {
    echo ""
    echo "─────────────────────────────────────────────────────────────────────────────"
    echo "⚠️  Failed to get task status:"
    echo "$STATUS_OUTPUT"
    continue
  }

  # Check if task is still running
  if grep -qiE '"status"\s*:\s*"(completed|failed|cancelled|finished|done|error)"' <<< "$STATUS_OUTPUT"; then
    echo ""
    echo "─────────────────────────────────────────────────────────────────────────────"
    echo "▸ Tests finished!"
    echo ""
    echo "$STATUS_OUTPUT"
    break
  fi

  # Also check for non-JSON status indicators
  if grep -qiE '(completed|finished|done|failed|cancelled|error)[^a-z]' <<< "$STATUS_OUTPUT"; then
    # Make sure it's not "running" or "in progress"
    if ! grep -qiE '(running|in.progress|pending|queued)' <<< "$STATUS_OUTPUT"; then
      echo ""
      echo "─────────────────────────────────────────────────────────────────────────────"
      echo "▸ Tests finished!"
      echo ""
      echo "$STATUS_OUTPUT"
      break
    fi
  fi

  echo ""
  echo "[$(date '+%H:%M:%S')] Still running... (next check in ${POLL_INTERVAL}s)"
done

# ─────────────────────────────────────────────────────────────────────────────
# 4. Show final results
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "▸ Fetching test results..."
"$MCP_CLIENT" results --filter all 2>&1 || true

echo ""
echo "✅ Done"
