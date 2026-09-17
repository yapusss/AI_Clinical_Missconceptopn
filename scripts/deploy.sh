#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/app

docker compose down --remove-orphans || true
docker rm -f backend frontend postgres valkey 2>/dev/null || true
docker compose up -d --build

if ! docker compose exec -T postgres psql -U appuser -d appdb -tAc "SELECT to_regclass('public.users')" </dev/null 2>/dev/null | grep -q '^users$'; then
  echo "users table missing - importing V2 schema"
  docker cp V2_Full_Script.sql postgres:/tmp/V2_Full_Script.sql
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U appuser -d appdb -f /tmp/V2_Full_Script.sql </dev/null
else
  echo "users table present - skipping V2 import"
fi

docker compose exec -T backend python manage.py migrate </dev/null
docker compose exec -T backend python manage.py seed_demo_user </dev/null

docker compose exec -T backend python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/admin/login/', timeout=5).status == 200 else 1)" </dev/null
docker compose exec -T frontend wget -q -O /dev/null --timeout=5 http://localhost:3000/ </dev/null

docker image prune -f || true
echo "DEPLOY OK"