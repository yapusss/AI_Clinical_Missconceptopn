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
# (non-fatal by design). State the container's view on every deploy. Retried: this
# runs seconds after `docker compose up -d`, and the first attempt used to fail
# against a backend container that was still starting — the error went to /dev/null
# and the deploy log simply omitted the line, which reads exactly like "key set".
cfg_probe=''
for i in $(seq 1 12); do
  cfg_probe=$(docker compose exec -T backend python manage.py shell -c "from django.conf import settings as s; from api.llm import get_active_model_identifier as g; print('llm:', 'key set' if s.LLM_API_KEY and s.LLM_API_KEY != 'local-llama-cpp' else 'KEY MISSING', '| base:', s.LLM_BASE_URL, '| env model:', s.LLM_MODEL, '| ACTIVE model (what the pipeline uses):', g(), '| headers:', ','.join(sorted(s.LLM_EXTRA_HEADERS)) or 'none'); print('embeddings:', 'key set' if s.EMBEDDINGS_API_KEY else 'KEY MISSING', '| model:', s.EMBEDDINGS_MODEL, '| dims:', s.EMBEDDINGS_DIMENSIONS)" </dev/null 2>&1) && break
  echo "waiting for backend to report its provider config ($i/12)..."
  sleep 5
done
echo "${cfg_probe:-PROBE FAILED - backend did not answer; check 'docker compose logs backend'}"

# Schema state, the same way as the provider config: "DEPLOY OK" with an unapplied
# migration is how a feature ships without its column (a cancelled run can leave the
# migration table and the code out of step, and the next deploy then reports
# "No migrations to apply").
docker compose exec -T backend python manage.py migrate --check </dev/null 2>&1 | tail -2 \
  && echo "migrations: all applied" \
  || echo "migrations: CHECK FAILED - unapplied migrations exist (see above)"
docker compose exec -T postgres psql -U appuser -d appdb -tAc \
  "SELECT 'llm_analyses.lecturer_note column: '||count(*) FROM information_schema.columns WHERE table_name='llm_analyses' AND column_name='lecturer_note';" \
  </dev/null 2>/dev/null || true

# A live inference call, not just settings: "key set, model right" says nothing about
# whether this host can actually reach the provider, and the difference between config
# and connectivity has already cost one debugging session. One tiny JSON call (~20
# tokens) per deploy; the failure text lands in the deploy log instead of prod only.
# Falls through a short candidate list, so one deploy also answers "which model can this
# host actually reach" — OpenCode Go has answered 400 "Model is unavailable" here while
# the same model worked from a dev machine moments earlier.
llm_smoke=''
for i in $(seq 1 2); do
  llm_smoke=$(docker compose exec -T backend python manage.py shell 2>&1 <<'PY'
from django.conf import settings as s
from api.llm import _call_llm_json, get_active_model_identifier
active = get_active_model_identifier()
env_model = s.LLM_MODEL
candidates = []
for m in (active, env_model, 'deepseek-v4-pro', 'glm-5.3'):
    if m and m not in candidates:
        candidates.append(m)
results = {}
for m in candidates:
    try:
        d = _call_llm_json('Balas hanya JSON.', 'Balas JSON: {"ok": true}', m)
        results[m] = 'OK'
        print('llm smoke:', m, 'OK ->', d)
    except Exception as e:
        results[m] = 'FAILED'
        print('llm smoke:', m, 'FAILED ->', type(e).__name__, str(e)[:160])
print('llm smoke summary: active=%s active_ok=%d env=%s env_ok=%d' % (
    active, 1 if results.get(active) == 'OK' else 0,
    env_model, 1 if results.get(env_model) == 'OK' else 0))
PY
) && break
  echo "llm smoke attempt $i/2 did not run; retrying in 5s"
  sleep 5
done
echo "${llm_smoke:-llm smoke: DID NOT RUN - check 'docker compose logs backend'}" | tail -6

# Reconcile a stale DB pin. `get_active_model_identifier()` prefers the admin-approved
# model in ai_runtime_settings over LLM_MODEL, so changing the env alone leaves the
# pipeline asking for a model the new provider does not serve — production sat like that
# requesting `openai/gpt-oss-20b` from OpenCode Go and answering every analysis with
# 400 'Model is unavailable'. Only acts when the pinned model is *unreachable* and the
# deployed one works, and says so, so an admin's deliberate choice is never overridden.
smoke_summary=$(printf '%s\n' "$llm_smoke" | grep -a 'llm smoke summary' | tail -1)
active_ok=$(printf '%s' "$smoke_summary" | sed -n 's/.*active_ok=\([01]\).*/\1/p')
env_ok=$(printf '%s' "$smoke_summary" | sed -n 's/.*env_ok=\([01]\).*/\1/p')
env_model=$(printf '%s' "$smoke_summary" | sed -n 's/.*env=\([^ ]*\) env_ok.*/\1/p')
if [ "${active_ok:-1}" = "0" ] && [ "${env_ok:-0}" = "1" ] && [ -n "${env_model:-}" ]; then
  echo "llm: DB-pinned model is unreachable but the deployed model works - activating $env_model"
  docker compose exec -T backend python manage.py set_active_model "$env_model" </dev/null 2>&1 | tail -3 || true
  docker compose exec -T backend python manage.py shell </dev/null <<'PY' 2>&1 | tail -2
from api.llm import _call_llm_json, get_active_model_identifier
m = get_active_model_identifier()
try:
    print('llm smoke after reconcile:', m, 'OK ->', _call_llm_json('Balas hanya JSON.', 'Balas JSON: {"ok": true}', m))
except Exception as e:
    print('llm smoke after reconcile:', m, 'FAILED ->', type(e).__name__, str(e)[:160])
PY
else
  echo "llm: ACTIVE model usable (active_ok=${active_ok:-?} env_ok=${env_ok:-?}) - nothing to reconcile"
fi
docker compose exec -T postgres psql -U appuser -d appdb -tAc "SELECT 'knowledge_chunks: '||count(*)||' rows / '||count(embedding)||' embedded' FROM knowledge_chunks;" </dev/null 2>/dev/null || true

# Workers: NO LONGER started here. Since migration 0029 the backend supervises the
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
  if [ "${worker_rows:-0}" -ge 4 ]; then
    echo "workers: ${worker_rows} fresh heartbeats"
    break
  fi
  echo "waiting for worker heartbeats ($i/24)..."
  sleep 5
done
if [ "${worker_rows:-0}" -lt 4 ]; then
  echo "workers: WARNING - fewer than 4 fresh heartbeats (expected analysis, materials, ingest, supervisor)"
  echo "         check AUTO_WORKER / the LLM key / EMBEDDINGS_API_KEY, and: docker compose logs backend"
  docker compose exec -T postgres psql -U appuser -d appdb -c \
    "SELECT worker_name, pid, loop_count, now() - last_seen_at AS age, detail_json->>'last_error' AS err, detail_json->>'skipped' AS skipped FROM worker_heartbeats ORDER BY worker_name" </dev/null 2>/dev/null || true
fi

docker image prune -f || true
echo "DEPLOY OK"
