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

# Embeddings key + chunk count: retrieval embeds the QUESTION at analysis time, so
# a missing EMBEDDINGS_API_KEY silently yields zero chunks with NULL grounding
# (non-fatal by design). State the container's view on every deploy.
docker compose exec -T backend python -c "from django.conf import settings as s; print('embeddings:', 'key set' if s.EMBEDDINGS_API_KEY else 'KEY MISSING', '| model:', s.EMBEDDINGS_MODEL, '| dims:', s.EMBEDDINGS_DIMENSIONS)" </dev/null 2>/dev/null || true
docker compose exec -T postgres psql -U appuser -d appdb -tAc "SELECT 'knowledge_chunks: '||count(*)||' rows / '||count(embedding)||' embedded' FROM knowledge_chunks;" </dev/null 2>/dev/null || true

# Workers: NO LONGER started here. Since migration 0029 the backend supervises both
# loops itself (api/worker_supervisor.py, spawned from ApiConfig.ready()), so the
# `worker` container this step used to start would be a SECOND analysis worker polling
# the same queue. Claims are idempotent (FOR UPDATE SKIP LOCKED) so it was safe, just
# duplicated — and it only ever ran `analyze_submissions`, so the materials drain ran
# nowhere on the VPS. The LLM-key guard this block implemented now lives in
# should_supervise(), which refuses to spawn without a real key.
#
# Consequence to keep in mind: with AUTO_WORKER=0 (or no LLM key in .env) there are no
# workers at all. The manual escape hatch is still available and profile-gated:
#   docker compose --profile worker up -d worker
echo "worker: supervised by the backend (no separate container)"

# Prove the workers are actually beating. A fresh heartbeat row per worker is the only
# evidence that the loops are alive — "backend healthy, worker dead" was the silent
# state that parked submissions at TERSIMPAN for 19 hours before migration 0029, and
# nothing in this script looked for it. Non-fatal: the deploy log shows the state.
worker_rows=0
for i in $(seq 1 24); do
  worker_rows=$(docker compose exec -T postgres psql -U appuser -d appdb -tAc \
    "SELECT count(*) FROM worker_heartbeats WHERE last_seen_at > now() - interval '60 seconds'" </dev/null 2>/dev/null || echo 0)
  worker_rows=$(echo "${worker_rows:-0}" | tr -d '[:space:]')
  if [ "${worker_rows:-0}" -ge 3 ]; then
    echo "workers: ${worker_rows} fresh heartbeats"
    break
  fi
  echo "waiting for worker heartbeats ($i/24)..."
  sleep 5
done
if [ "${worker_rows:-0}" -lt 3 ]; then
  echo "workers: WARNING - fewer than 3 fresh heartbeats (expected analysis, materials, supervisor)"
  echo "         check AUTO_WORKER / the LLM key, and: docker compose logs backend"
  docker compose exec -T postgres psql -U appuser -d appdb -c \
    "SELECT worker_name, pid, loop_count, now() - last_seen_at AS age, detail_json->>'last_error' AS err FROM worker_heartbeats ORDER BY worker_name" </dev/null 2>/dev/null || true
fi

docker image prune -f || true
echo "DEPLOY OK"
