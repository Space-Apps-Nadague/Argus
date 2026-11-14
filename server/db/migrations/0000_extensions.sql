-- specs/05-data-platform.md §2. On Azure, add CITEXT to the azure.extensions allowlist first (scripts/azure/provision.sh).
CREATE EXTENSION IF NOT EXISTS citext;
