#!/usr/bin/env bash
# Allow a teammate's public IP through the Azure Postgres firewall.  Usage: scripts/azure/add-ip.sh dana 203.0.113.7
set -euo pipefail
NAME="${1:?name}"; IP="${2:?public ip (they can find it at https://api.ipify.org)}"
RG="${AZ_RG:-argus-rg}"
SERVER="${AZ_PG_SERVER:-argus-pg-$(az account show --query id -o tsv | cut -c1-6)}"
az postgres flexible-server firewall-rule create -g "$RG" -n "$SERVER" -r "dev-$NAME" --start-ip-address "$IP" --end-ip-address "$IP" -o none
echo "✓ $NAME ($IP) can now reach $SERVER"
