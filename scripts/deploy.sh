#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/app

# LLM provider (Groq) — real values live in /home/ubuntu/app/.env on the VPS
# (chmod 600, rsync-excluded from CI). Defaults below are dev-only fallbacks.
LLM_BASE_URL="${LLM_BASE_URL:-https://api.groq.com/openai/v1}"
LLM_API_KEY="${LLM_API_KEY:-local-llama-cpp}"
LLM_MODEL="${LLM_MODEL:-openai/gpt-oss-20b}"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a && . ./.env && set +a
fi

docker compose down --remove-orphans || true
docker rm -f backend frontend postgres valkey worker 2>/dev/null || true
# Compose reads LLM_* from the shell environment above (compose file uses
# ${VAR:-default} interpolation) — that's how the key reaches the containers.
docker compose up -d --build

if ! docker compose exec -T postgres psql -U appuser -d appdb -tAc "SELECT to_regclass('public.users')" </dev/null 2>/dev/null | grep -q '^users$'; then
  echo "users table missing - importing V2 schema"
  docker cp V2_Full_Script.sql postgres:/tmp/V2_Full_Script.sql
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U appuser -d appdb -f /tmp/V2_Full_Script.sql </dev/null
else
  echo "users table present - skipping V2 import"
fi

docker compose exec -T backend python manage.py migrate </dev/null
docker compose exec -T backend python manage.py seed_demo_data </dev/null

# NOTE: check /admin/login/ (a real view) — /admin/login without trailing
# slash 302-redirects and urllib raised on the redirect, making the loop
# always exit 1 after ~5 minutes on every deploy.
for i in $(seq 1 60); do
  if docker compose exec -T backend python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/admin/login/', timeout=5).status == 200 else 1)" </dev/null 2>/dev/null \
    && docker compose exec -T frontend wget -q -O - --timeout=5 http://127.0.0.1:3000/ </dev/null 2>/dev/null | grep -qi html; then
    echo "Backend OK"
    echo "Frontend OK"
    break
  fi
  echo "waiting for services ($i/60)..."
  sleep 5
done

if ! docker compose exec -T backend python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/admin/login/', timeout=5).status == 200 else 1)" </dev/null 2>/dev/null; then
  echo "Backend health check FAILED"
  docker compose ps
  exit 1
fi
if ! docker compose exec -T frontend wget -q -O - --timeout=5 http://127.0.0.1:3000/ </dev/null 2>/dev/null | grep -qi html; then
  echo "Frontend health check FAILED (no HTML served)"
  docker compose ps
  exit 1
fi

# P4 worker: start only if an LLM key is configured; otherwise skip cleanly.
if [ -n "${LLM_API_KEY:-}" ] && [ "${LLM_API_KEY:-local-llama-cpp}" != "local-llama-cpp" ]; then
  docker compose --profile worker up -d worker && echo "worker: started (model=${LLM_MODEL:-?})" \
    || { echo "worker: FAILED to start"; exit 1; }
else
  echo "worker: SKIPPED - LLM_API_KEY not set (no .env on VPS?)"
fi

docker image prune -f || true
echo "DEPLOY OK"
