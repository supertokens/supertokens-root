#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

COMPOSE_PROJECT="supertokens-mcp"
MCP_IMAGE="java-mcp-server"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  build         Build (or rebuild) the MCP server Docker image
  up            Start test databases (PostgreSQL, etc.)
  down          Stop test databases (data persists)
  reset         Stop test databases and wipe all data
  status        Show container status and connectivity info
  logs [svc]    Tail logs (default: all services)
  help          Show this message

Typical workflow:
  ./manage.sh build       # one-time (or after changing Dockerfile/server.mjs)
  ./manage.sh up          # start test databases
  # ... use Claude Desktop / Cowork — compile, test, lint tools are available
  ./manage.sh down        # done for the day
EOF
}

cmd_build() {
  echo "▸ Building MCP server image: $MCP_IMAGE"
  docker build -t "$MCP_IMAGE" "$SCRIPT_DIR"
  echo "✅ Image built. Update claude_desktop_config.json if this is your first build."
}

cmd_up() {
  echo "▸ Starting test infrastructure…"
  docker compose up -d
  echo ""
  cmd_status
}

cmd_down() {
  echo "▸ Stopping test infrastructure…"
  docker compose down
  echo "✅ Stopped. Data volumes preserved (use 'reset' to wipe)."
}

cmd_reset() {
  echo "▸ Stopping test infrastructure and removing volumes…"
  docker compose down -v
  echo "✅ Stopped. All data wiped — databases will reinitialize on next 'up'."
}

cmd_status() {
  echo "─── Container status ───"
  docker compose ps
  echo ""

  # Show the network name the MCP container should join
  local network
  network=$(docker network ls --filter "name=${COMPOSE_PROJECT}" --format '{{.Name}}' | head -1)
  if [ -n "$network" ]; then
    echo "─── Network ───"
    echo "Docker network: $network"
    echo ""
    echo "Add this to your MCP server args in claude_desktop_config.json:"
    echo "  \"--network=$network\""
    echo ""
  fi

  echo "─── Connection strings for gradle.properties / env vars ───"
  echo "PostgreSQL:  jdbc:postgresql://pg:5432/supertokens_test  (user: test / pass: test)"
  echo "  From host: jdbc:postgresql://localhost:5432/supertokens_test"
  # echo "MySQL:       jdbc:mysql://mysql:3306/supertokens_test  (user: test / pass: test)"
  # echo "  From host: jdbc:mysql://localhost:3306/supertokens_test"
}

cmd_logs() {
  local svc="${1:-}"
  if [ -n "$svc" ]; then
    docker compose logs -f "$svc"
  else
    docker compose logs -f
  fi
}

# ── Dispatch ─────────────────────────────────────────────────────────
case "${1:-help}" in
  build)  cmd_build  ;;
  up)     cmd_up     ;;
  down)   cmd_down   ;;
  reset)  cmd_reset  ;;
  status) cmd_status ;;
  logs)   cmd_logs "${2:-}" ;;
  help)   usage      ;;
  *)      echo "Unknown command: $1"; usage; exit 1 ;;
esac
