#!/usr/bin/env bash
#
# One-command deploy: Render for the API, Vercel for the dashboard.
#
# The database is an external managed Postgres (Neon or similar). Render's free
# Postgres expires after 30 days, which is the wrong property for a demo a
# reviewer may open weeks later — so the connection string is supplied rather
# than provisioned here.
#
# Usage:
#   RENDER_API_KEY=rnd_xxx \
#   DATABASE_URL=postgresql://... \
#   ./scripts/deploy.sh
#
set -euo pipefail

: "${RENDER_API_KEY:?Set RENDER_API_KEY (Render dashboard → Account Settings → API Keys)}"
: "${DATABASE_URL:?Set DATABASE_URL to a managed Postgres connection string}"

RENDER_OWNER_ID="${RENDER_OWNER_ID:-tea-d9o8dkoae00c73aus9rg}"
REPO_URL="${REPO_URL:-https://github.com/jagadmitul/praella-wms}"
REGION="${REGION:-singapore}"
API_SERVICE_NAME="${API_SERVICE_NAME:-wms-api}"
REDIS_NAME="${REDIS_NAME:-wms-redis}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

api() {
  curl -sS -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' "$@"
}

echo "▸ Preparing the database schema and demo data"
(
  cd apps/api
  DATABASE_URL="$DATABASE_URL" pnpm exec prisma migrate deploy
  DATABASE_URL="$DATABASE_URL" pnpm prisma:seed
)

echo "▸ Resolving Redis connection details"
REDIS_JSON="$(api "https://api.render.com/v1/key-value?name=${REDIS_NAME}&limit=1")"
REDIS_ID="$(printf '%s' "$REDIS_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["keyValue"]["id"] if d else "")')"

if [ -z "$REDIS_ID" ]; then
  echo "  no Redis instance named ${REDIS_NAME}; creating one"
  REDIS_ID="$(api -X POST https://api.render.com/v1/key-value -d "{
    \"name\": \"${REDIS_NAME}\", \"ownerId\": \"${RENDER_OWNER_ID}\",
    \"region\": \"${REGION}\", \"plan\": \"free\", \"maxmemoryPolicy\": \"noeviction\"
  }" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
fi

# The internal connection string is only reachable from inside Render, which is
# exactly what we want for a cache that should never be exposed publicly.
REDIS_CONN="$(api "https://api.render.com/v1/key-value/${REDIS_ID}/connection-info" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["internalConnectionString"])')"
REDIS_HOST="$(printf '%s' "$REDIS_CONN" | sed -E 's#redis://([^:]*:[^@]*@)?([^:/]+).*#\2#')"
REDIS_PORT="$(printf '%s' "$REDIS_CONN" | sed -E 's#.*:([0-9]+)$#\1#')"
echo "  redis at ${REDIS_HOST}:${REDIS_PORT}"

echo "▸ Creating or updating the API service"
EXISTING="$(api "https://api.render.com/v1/services?name=${API_SERVICE_NAME}&limit=1" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["service"]["id"] if d else "")')"

ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(openssl rand -hex 32)}"
REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -hex 32)}"

ENV_VARS=$(python3 - "$DATABASE_URL" "$REDIS_HOST" "$REDIS_PORT" "$ACCESS_SECRET" "$REFRESH_SECRET" <<'PY'
import json, sys
database_url, redis_host, redis_port, access, refresh = sys.argv[1:6]
print(json.dumps([
    {"key": "NODE_ENV", "value": "production"},
    {"key": "PORT", "value": "4300"},
    {"key": "DATABASE_URL", "value": database_url},
    {"key": "REDIS_ENABLED", "value": "true"},
    {"key": "REDIS_HOST", "value": redis_host},
    {"key": "REDIS_PORT", "value": redis_port},
    {"key": "JWT_ACCESS_SECRET", "value": access},
    {"key": "JWT_REFRESH_SECRET", "value": refresh},
    {"key": "QUEUE_PREFIX", "value": "wms-prod"},
    {"key": "LOG_FORMAT", "value": "json"},
    # Replaced with the real dashboard origin once Vercel has deployed.
    {"key": "CORS_ORIGINS", "value": "http://localhost:3300"},
    {"key": "APP_URL", "value": "http://localhost:3300"},
]))
PY
)

if [ -z "$EXISTING" ]; then
  SERVICE_JSON="$(api -X POST https://api.render.com/v1/services -d "{
    \"type\": \"web_service\",
    \"name\": \"${API_SERVICE_NAME}\",
    \"ownerId\": \"${RENDER_OWNER_ID}\",
    \"repo\": \"${REPO_URL}\",
    \"branch\": \"main\",
    \"autoDeploy\": \"yes\",
    \"serviceDetails\": {
      \"region\": \"${REGION}\",
      \"plan\": \"free\",
      \"runtime\": \"image\",
      \"healthCheckPath\": \"/health\",
      \"envSpecificDetails\": {
        \"dockerfilePath\": \"./apps/api/Dockerfile\",
        \"dockerContext\": \".\"
      }
    },
    \"envVars\": ${ENV_VARS}
  }")"
  SERVICE_ID="$(printf '%s' "$SERVICE_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("service",{}).get("id",""))')"
  [ -n "$SERVICE_ID" ] || { echo "Failed to create service:"; printf '%s\n' "$SERVICE_JSON"; exit 1; }
  echo "  created ${SERVICE_ID}"
else
  SERVICE_ID="$EXISTING"
  api -X PUT "https://api.render.com/v1/services/${SERVICE_ID}/env-vars" -d "$ENV_VARS" > /dev/null
  api -X POST "https://api.render.com/v1/services/${SERVICE_ID}/deploys" -d '{"clearCache":"do_not_clear"}' > /dev/null
  echo "  updated and redeployed ${SERVICE_ID}"
fi

API_URL="$(api "https://api.render.com/v1/services/${SERVICE_ID}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["serviceDetails"]["url"])')"
echo "  API will be live at ${API_URL}"

echo "▸ Deploying the dashboard to Vercel"
(
  cd apps/web
  vercel pull --yes --environment=production --token "${VERCEL_TOKEN:-}" > /dev/null 2>&1 || true
  vercel env rm API_BASE_URL production --yes > /dev/null 2>&1 || true
  printf '%s/api/v1' "$API_URL" | vercel env add API_BASE_URL production > /dev/null
  vercel deploy --prod --yes
)

cat <<EOF

▸ Deployed.

  API        ${API_URL}
  Swagger    ${API_URL}/docs
  Health     ${API_URL}/health

Last step — point the API back at the dashboard so CORS and the links inside
invitation emails use the real origin:

  Render dashboard → ${API_SERVICE_NAME} → Environment
    CORS_ORIGINS = https://<your-vercel-domain>
    APP_URL      = https://<your-vercel-domain>

EOF
