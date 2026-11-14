#!/usr/bin/env bash
# ARGUS — give one teammate their own login to the team database (docs/DATABASE.md "Sharing access").
#
#   scripts/azure/add-teammate.sh <name> <their-public-ip> [--readonly]
#
# Creates DB login dev_<name> (or ro_<name> with --readonly) with a random password:
#   - app logins act as argus_app (they can run the app and migrations; tables stay owned by argus_app)
#   - read-only logins act as argus_analyst (notebooks)
# opens the Azure firewall for their IP, and writes their connection string to teammate.<name>.env.local
# (gitignored). Send that file privately; nothing is printed. Remove access: scripts/azure/remove-teammate.sh.
# Needs: `az login`, and the server admin credentials in ~/.config/argus/pg-admin.env.
set -euo pipefail
NAME="$(echo "${1:?name}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_')"
IP="${2:?public IP (they can see it at https://api.ipify.org)}"
MODE="${3:-}"
RG="${AZ_RG:-argus-rg}"
SERVER="${AZ_PG_SERVER:-argus-pg-a405de}"
ADMIN_ENV="${ARGUS_PG_ADMIN_ENV:-$HOME/.config/argus/pg-admin.env}"

if [ "$MODE" = "--readonly" ]; then ROLE="ro_$NAME"; GROUP="argus_analyst"; else ROLE="dev_$NAME"; GROUP="argus_app"; fi
PW="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"

az postgres flexible-server firewall-rule create -g "$RG" -s "$SERVER" -n "dev-$NAME" --start-ip-address "$IP" --end-ip-address "$IP" -o none

(
  set -a; . "$ADMIN_ENV"; set +a
  enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
  ADMIN_URL="postgres://$(enc "$PGUSER"):$(enc "$PGPASSWORD")@$PGHOST:${PGPORT:-5432}/argus?sslmode=require"
  run() { DATABASE_URL="$ADMIN_URL" npx tsx scripts/db-sql.ts "$1" >/dev/null; }
  run "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='$ROLE') THEN CREATE ROLE $ROLE LOGIN PASSWORD '$PW'; ELSE ALTER ROLE $ROLE PASSWORD '$PW'; END IF; END \$\$"
  run "GRANT $GROUP TO $ROLE"
  run "ALTER ROLE $ROLE SET role TO '$GROUP'"
  umask 077
  cat > "teammate.$NAME.env.local" <<ENV
# ARGUS team database — personal login for $NAME ($ROLE). Keep private; do not commit or post in chat channels.
# Put this line in your .env (repo root), then: npm run db:migrate && npm run dev:all
$( [ "$MODE" = "--readonly" ] && echo "ANALYST_DATABASE_URL" || echo "DATABASE_URL" )=postgres://$ROLE:$PW@$PGHOST:5432/argus?sslmode=require
ENV
)
echo "✓ $ROLE created, firewall opened for $IP. Send teammate.$NAME.env.local to $NAME privately (e.g. a one-time password-manager share)."
