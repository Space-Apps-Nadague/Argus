# ARGUS WhatsApp Group Bot (`go` + `whatsmeow`)

Minimalist Go bot that joins your WhatsApp group as a user and responds when mentioned via **`@argus`** (or via WhatsApp's native `@mention` of the bot's account).

## Capabilities
- `@argus <question>` — Answers questions about ARGUS, specs, and recent group conversation using Gemini (`GEMINI_API_KEY` from `.env`).
- `@argus issues` — Lists open GitHub issues via `gh-pm-issue.mjs`.
- `@argus tasks` — Lists actionable SWE `agent-task` issues via `gh-swe-pr.mjs`.
- `@argus pm audit` / `@argus pm audit live` — Runs `run-pm-audit.mjs` (`--dry-run` by default).
- `@argus pm <prompt>` — Runs the PM subagent grounded in `specs/03-requirements.md` and open issues.
- `@argus swe <issue# | prompt>` — Runs the SWE subagent (fetches issue details and produces a spec-first plan, or executes `ARGUS_SWE_CMD` if configured).
- `@argus swe worktree <issue#>` — Creates an isolated `.worktrees/issue-<n>` worktree.

## Setup
1. Ensure `.env` at the repo root has `GEMINI_API_KEY` (and `GH_PROJECT_TOKEN` / `GITHUB_TOKEN` or macOS Keychain git credentials for GitHub issues).
2. Run the bot:
   ```bash
   cd tools/whatsapp-bot
   go run .
   ```
3. On first run, scan the QR code in your terminal via **WhatsApp → Linked Devices → Link a Device**.
   Your session is saved in `tools/whatsapp-bot/whatsapp.db` (gitignored).
4. Mention `@argus help` in your target WhatsApp group. The terminal will log `[Trigger in group 120363...@g.us]`.
5. Lock the bot to that group by adding to `.env`:
   ```env
   WHATSAPP_GROUP_JID=120363...@g.us
   ```

### Run in Docker (Recommended on Mac)
1. Pair once interactively so you can scan the QR code in your terminal (session persists in the `whatsapp-session` volume):
   ```bash
   docker compose --profile whatsapp run --rm whatsapp-bot
   ```
2. After scanning and seeing `Connected to WhatsApp.`, press `Ctrl+C`, then run it in the background:
   ```bash
   docker compose --profile whatsapp up -d whatsapp-bot
   docker compose --profile whatsapp logs -f whatsapp-bot
   ```
3. Or build & run directly with `docker`:
   ```bash
   docker build -t argus-wa-bot ./tools/whatsapp-bot
   docker run -it --rm --env-file .env -v "$PWD:/workspace" -v argus-wa-data:/data argus-wa-bot
   ```

## Optional Subagent Hooks
To delegate `@argus pm <prompt>` or `@argus swe <prompt>` to an external headless CLI (receiving `$ARGUS_PROMPT` in its environment), set in `.env`:
```env
ARGUS_PM_CMD=...
ARGUS_SWE_CMD=...
```
