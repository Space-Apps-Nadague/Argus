# ARGUS Database — Setup & Team Access

Canonical design: [`specs/05-data-platform.md`](../specs/05-data-platform.md). This page covers how to use it day to day.

## Pick a database (`DATABASE_URL` in `.env`)

| Option | `DATABASE_URL` | Use it for |
|---|---|---|
| **Shared team DB (Azure)** | `postgres://argus_app:…@argus-pg-xxxxxx.postgres.database.azure.com:5432/argus?sslmode=require` | The demo; shared data |
| Embedded, nothing to install | `pglite:./.data/argus` | Solo dev, tests, offline work |
| Docker | `postgres://argus:argus@localhost:5432/argus` after `docker compose up -d postgres` | Local, full Postgres |
| Unset | — | Stateless mode: the HUD shows the offline demo data |

Ask the person who provisioned Azure for the `AZURE_PG_APP_URL` line from their `azure.env.local`. Share it privately, never in git, issues or chat logs.

## First run
```bash
cp .env.example .env              # then fill DATABASE_URL and the ARGUS_* values
npm run db:migrate                # apply committed migrations
npm run db:seed                   # sources, metric catalog, demo crew, sensor kits, admin, demo accounts
npm run dev:all                   # HUD + API
```
- `db:seed` is idempotent, so running it again is safe.
- Demo logins (`valkyrie`, `apex`, `pulse`, `solaris`, `surgeon`) are created only when `ARGUS_DEMO_PASSWORD` is set.

## Sharing access with teammates
Each teammate gets **their own login**, so access can be revoked per person and the audit trail shows who connected. The person with `az` access and the admin file (`~/.config/argus/pg-admin.env`) runs:

```bash
scripts/azure/add-teammate.sh dana 203.0.113.7              # app login (runs the app and migrations)
scripts/azure/add-teammate.sh dana 203.0.113.7 --readonly   # notebooks only
scripts/azure/remove-teammate.sh dana                       # revoke login + firewall rule
```

1. **The teammate sends their public IP**, from https://api.ipify.org.
2. **The script does three things:**
   - creates `dev_<name>` (acts as `argus_app`) or `ro_<name>` (acts as `argus_analyst`, read-only) with a random password;
   - opens the firewall for that IP;
   - writes `teammate.<name>.env.local`, which git ignores.
3. **Send that file privately**, for example as a one-time password-manager share such as Bitwarden Send, or in a direct message that disappears. Never put it in git, an issue, a PR or a group channel.
4. **The teammate pastes its line into their own `.env`**, then runs `npm run db:migrate && npm run dev:all`.

If a teammate's IP changes (new Wi-Fi network, phone hotspot), run `add-teammate.sh` again with the new IP. It keeps the login and issues a new password.

## Getting through the Azure firewall
Azure only accepts connections from listed IPs.
1. Find your public IP at https://api.ipify.org.
2. Send it to whoever has `az` access. They run `scripts/azure/add-ip.sh <your-name> <ip>`.

If your IP changes, for example on a different Wi-Fi network, repeat these steps.

## Changing the schema
1. Update `specs/05-data-platform.md` §3 first (spec-first rule).
2. Edit `server/db/schema.ts`.
3. Run `npm run db:generate`. This writes a new SQL file in `server/db/migrations/`. Commit it.
4. Run `npm run db:migrate` against your local DB, then against Azure once the PR is merged.

Never change the Azure schema by hand. Migrations are the only path.

## Handy commands
| Command | What it does |
|---|---|
| `npm run db:sql -- "select count(*) from observations"` | Ad-hoc query |
| `npm run db:studio` | Drizzle Studio (browse tables) for a `postgres://` URL |
| `rm -rf .data/argus` | Reset the embedded local DB |

## The team server
- **Server:** `argus-pg-a405de.postgres.database.azure.com`
- **Resource group:** `argus-rg`
- **Region:** Israel Central
- **Spec:** PostgreSQL 17, B1ms
- **Budget guard:** spend is capped below the free-trial credit. A budget alert plus an automation stops the server if the cap is reached.

Do not create more servers. The free allowance covers one B1ms.

## Provisioning Azure (only if the server ever has to be recreated)
Prerequisites: the Azure CLI (`az`) and a signed-in session from `az login`.
```bash
scripts/azure/provision.sh        # AZ_LOCATION=..., AZ_BUDGET_EMAIL=... optional
```
It creates:
- resource group `argus-rg`;
- a PostgreSQL 17 Flexible Server on Burstable B1ms with 32 GB, inside the free-account allowance [SRC-061];
- the `citext`, `vector` and `pgcrypto` extension allowlist [SRC-062];
- the `argus` database;
- a firewall rule for your IP;
- roles `argus_app` (the app, runs migrations) and `argus_analyst` (read-only, for notebooks).

Connection strings go to `azure.env.local`, which is gitignored. Backups: 7-day point-in-time restore.

## Roles at a glance
| DB role | Who | Rights |
|---|---|---|
| `argusadmin` | provisioner only | server admin |
| `argus_app` | the ARGUS server, migrations | owns the tables |
| `argus_analyst` | Python notebooks | `SELECT` only |

App-level roles (astronaut / flight surgeon / admin) are separate. They are users in the `users` table and are enforced by the server (spec 05 §6).
