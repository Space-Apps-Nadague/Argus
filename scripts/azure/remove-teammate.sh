#!/usr/bin/env bash
# Revoke a teammate's database login and firewall rule.  Usage: scripts/azure/remove-teammate.sh <name>
set -euo pipefail
NAME="$(echo "${1:?name}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_')"
RG="${AZ_RG:-argus-rg}"; SERVER="${AZ_PG_SERVER:-argus-pg-a405de}"
ADMIN_ENV="${ARGUS_PG_ADMIN_ENV:-$HOME/.config/argus/pg-admin.env}"
az postgres flexible-server firewall-rule delete -g "$RG" -s "$SERVER" -n "dev-$NAME" --yes -o none || true
(
  set -a; . "$ADMIN_ENV"; set +a
  enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
  ADMIN_URL="postgres://$(enc "$PGUSER"):$(enc "$PGPASSWORD")@$PGHOST:${PGPORT:-5432}/argus?sslmode=require"
  for ROLE in "dev_$NAME" "ro_$NAME"; do
    DATABASE_URL="$ADMIN_URL" npx tsx scripts/db-sql.ts "DO \$\$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='$ROLE') THEN EXECUTE 'DROP ROLE $ROLE'; END IF; END \$\$" >/dev/null
  done
)
rm -f "teammate.$NAME.env.local"
echo "✓ access removed for $NAME"
