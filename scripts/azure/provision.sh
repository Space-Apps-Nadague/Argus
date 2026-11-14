#!/usr/bin/env bash
# ARGUS — provision the shared team database on Azure (specs/05-data-platform.md §2, docs/DATABASE.md)
# Source: SRC-061 (free account: B1MS, 750 h/month, 32 GB), SRC-062 (extension allowlist)
#
# Prerequisite: `az login` (you sign in yourself; this script never asks for credentials).
# Usage:  scripts/azure/provision.sh            # defaults below, override with env vars
#         AZ_LOCATION=northeurope scripts/azure/provision.sh
#
# Writes the connection strings to azure.env.local (gitignored). It never prints passwords.
set -euo pipefail

RG="${AZ_RG:-argus-rg}"
LOCATION="${AZ_LOCATION:-westeurope}"
SERVER="${AZ_PG_SERVER:-argus-pg-$(az account show --query id -o tsv | cut -c1-6)}"
ADMIN_USER="${AZ_PG_ADMIN:-argusadmin}"
DB="argus"
OUT="azure.env.local"
BUDGET_EMAIL="${AZ_BUDGET_EMAIL:-}"

rnd() { node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"; }
MY_IP="$(curl -fsS https://api.ipify.org)"

echo "› Subscription: $(az account show --query name -o tsv)"
echo "› Resource group $RG in $LOCATION, server $SERVER"

az group create -n "$RG" -l "$LOCATION" -o none

if az postgres flexible-server show -g "$RG" -n "$SERVER" -o none 2>/dev/null; then
  echo "› Server already exists; skipping create (admin password unchanged)."
  ADMIN_PW=""
else
  ADMIN_PW="$(rnd)"
  echo "› Creating Flexible Server (Burstable B1ms, PG 17, 32 GB). This takes ~5–10 minutes…"
  az postgres flexible-server create -g "$RG" -n "$SERVER" -l "$LOCATION" \
    --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 17 \
    --admin-user "$ADMIN_USER" --admin-password "$ADMIN_PW" \
    --public-access "$MY_IP" --backup-retention 7 --zonal-resiliency Disabled \
    --tags project=argus purpose=nasa-space-apps -y -o none
fi

echo "› Allowing extensions CITEXT, VECTOR, PGCRYPTO"
az postgres flexible-server parameter set -g "$RG" -s "$SERVER" --name azure.extensions --value CITEXT,VECTOR,PGCRYPTO -o none

echo "› Creating database $DB"
az postgres flexible-server db create -g "$RG" -s "$SERVER" -d "$DB" -o none 2>/dev/null || true

echo "› Firewall rule for this machine ($MY_IP)"
az postgres flexible-server firewall-rule create -g "$RG" -n "$SERVER" -r "setup-$(whoami)" \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" -o none

HOST="$SERVER.postgres.database.azure.com"
if [ -n "$ADMIN_PW" ]; then
  APP_PW="$(rnd)"; ANALYST_PW="$(rnd)"
  ADMIN_URL="postgres://$ADMIN_USER:$ADMIN_PW@$HOST:5432/$DB?sslmode=require"
  echo "› Creating roles argus_app (runs migrations, owns tables) and argus_analyst (read-only)"
  run_sql() { DATABASE_URL="$ADMIN_URL" npx tsx scripts/db-sql.ts "$1" >/dev/null; }
  run_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='argus_app') THEN CREATE ROLE argus_app LOGIN PASSWORD '$APP_PW'; END IF; END \$\$"
  run_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='argus_analyst') THEN CREATE ROLE argus_analyst LOGIN PASSWORD '$ANALYST_PW'; END IF; END \$\$"
  run_sql "CREATE EXTENSION IF NOT EXISTS citext"
  run_sql "GRANT ALL ON DATABASE $DB TO argus_app"
  run_sql "GRANT ALL ON SCHEMA public TO argus_app"
  run_sql "GRANT CONNECT ON DATABASE $DB TO argus_analyst"
  run_sql "GRANT USAGE ON SCHEMA public TO argus_analyst"
  run_sql "ALTER DEFAULT PRIVILEGES FOR ROLE argus_app IN SCHEMA public GRANT SELECT ON TABLES TO argus_analyst"
  umask 077
  cat > "$OUT" <<ENV
# ARGUS Azure connection strings — DO NOT COMMIT (gitignored by *.local). Share privately with teammates.
# Server: $HOST   Resource group: $RG
AZURE_PG_ADMIN_URL=$ADMIN_URL
# Put this one in .env as DATABASE_URL for the app and migrations:
AZURE_PG_APP_URL=postgres://argus_app:$APP_PW@$HOST:5432/$DB?sslmode=require
# Read-only, for notebooks (analysis/):
AZURE_PG_ANALYST_URL=postgres://argus_analyst:$ANALYST_PW@$HOST:5432/$DB?sslmode=require
ENV
  echo "› Wrote $OUT"
fi

if [ -n "$BUDGET_EMAIL" ]; then
  echo "› Budget alert (1 USD/month) to $BUDGET_EMAIL"
  az consumption budget create --budget-name argus-budget --amount 1 --time-grain Monthly \
    --start-date "$(date +%Y-%m-01)" --end-date "$(date -d '+1 year' +%Y-%m-01)" --category Cost -o none \
    || echo "  (budget creation failed; add one in the portal: Cost Management → Budgets)"
fi

echo "✓ Done. Next: copy AZURE_PG_APP_URL into .env as DATABASE_URL, then: npm run db:migrate && npm run db:seed"
echo "  Teammates: scripts/azure/add-ip.sh <name> <their-public-ip>"
