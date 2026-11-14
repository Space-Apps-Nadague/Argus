# Contributing to ARGUS — Developer & Agent Handover Guide

Welcome to **ARGUS** (*Astronaut Readiness Guidance & Unified Surveillance*). Because multiple developers and AI coding agents collaborate on this repository, we enforce a strict **Spec-Driven Development (SDD)** protocol.

---

## 1. The Spec-Driven Development Lifecycle

Before making any code change, walk through these five steps:

1. **Read the Canonical Specs (`/specs`):**
   - `specs/00-architecture.md` — Tech stack, package boundaries, and file layout.
   - `specs/01-data-schema.md` — Every TypeScript interface, vital metric ID, `0g` microgravity threshold, and AI JSON schema.
   - `specs/02-ui-dashboard.md` — UI layout proportions, 3D Bio-Twin controls, and user interactions.
2. **Update Specs First:**
   - Need a new vital sign, crisis scenario, or component prop? Document it in `specs/01-data-schema.md` or `specs/02-ui-dashboard.md` **before** editing `.ts` or `.tsx` files.
3. **Claim Your Task on GitHub:**
   - Tasks are [GitHub Issues](https://github.com/Space-Apps-Nadague/Argus/issues) tracked on the GitHub Projects kanban. No task file lives in the repo.
   - Assign yourself to the issue and move its card to `In Progress` so other contributors know which files are being edited. If there is no issue yet, open one and list the files it touches.
4. **Work in a Git Worktree, Keep Agent Folders Out of Git:**
   - Do feature work on its own branch in a git worktree so parallel contributors don't collide in one checkout.
   - Only `.agents/` (shared, vendor-neutral agent material) is tracked. Tool-specific folders such as `.claude/`, `.cursor/`, `.codex/` and `.gemini/` are gitignored and stay local. See `AGENTS.md` §6.
5. **Verify & Document Completion:**
   - Run `npm test` (deterministic triage unit tests) and `npm run build` (TypeScript + Vite production bundle).
   - For UI tasks, follow the agent skills in `.agents/skills/` (`frontend-design`, `design-system`, `ux-copy`) and run `accessibility-review` before closing.
   - Open a PR that says `Closes #<issue>`; merging it closes the issue and moves the card to `Done`.

---

### Source attribution (required)
Every external fact, threshold, dataset or simulation parameter needs an `SRC-xxx` entry in `SOURCES.md`, a `Source: SRC-xxx` citation where it is used, and an updated **Used in** cell. Commits that use sources end with `Sources: SRC-…`, and the PR template's "Sources used" table must be filled in. `npm run check:sources` enforces the IDs. Full rule: `AGENTS.md` §7.

### Database changes
Schema lives in `server/db/schema.ts` (`specs/05-data-platform.md` §3). Change the spec, then the schema, then run `npm run db:generate` and commit the generated SQL in `server/db/migrations/`. Never edit the shared Azure database by hand. Setup and access: `docs/DATABASE.md`.

---

## 2. Architectural Guardrails

### Deterministic Triage vs. Generative AI
- **Never** let an LLM decide whether a vital sign is `green`, `yellow`, or `red`.
- All status colors (`#22c55e` Green, `#eab308` Yellow, `#ef4444` Red) and the `0–100%` **Crew Readiness Score** are computed deterministically by `src/utils/triageEngine.ts` using the exact threshold table in `specs/01-data-schema.md`.
- The Clinical AI layer (`src/services/flightSurgeonAi.ts`) is used **strictly** for:
  1. Synthesizing plain-language explanations for non-physician crew members.
  2. Generating or tailoring step-by-step guided self-exams and countermeasures.
  3. Analyzing visual self-exam images (retinal fundoscopy, optic nerve sheath ultrasound, skin rash imagery).
- Every AI feature **must** have an instant, deterministic offline fallback in `src/data/telemetryScenarios.ts` so the HUD operates reliably without network connectivity or an API key.

### Drift, Forecast & Check-ins Are Informational
- `src/utils/driftAnalytics.ts` (personal-baseline σ, forecast, "Why" links) **never** changes a triage status. Status always comes from `triageEngine.ts` thresholds.
- Check-ins (`src/utils/checkIns.ts`) only overlay values onto the telemetry series. Triage, readiness and guidance then recompute through the normal deterministic pipeline.
- Use the drift accent (`hud-drift`, violet) only for drift and links, never for triage status.

### Tabbed HUD & UI Primitives
- Five tabs (`TabBar.tsx`): Bio-Twin, Trends, Check-in, Flight Surgeon, Crew. New UI goes in the relevant tab, not a new permanent column.
- Build with `src/components/ui/` (`Card`, `StatTile`, `StatusPill`, `ZoneIcon`) and the tokens in `tailwind.config.js` / `src/index.css`. Put long explanations in `InfoTip`.
- Status is always color + icon + word. Inputs need visible 3:1 borders (`hud-input`), and every control needs a visible focus ring (`hud-focus`).

### 3D Bio-Twin (`src/components/BioTwinMap.tsx`)
- Built with `@react-three/fiber` and `@react-three/drei`.
- Supports 4 anatomical view layers (`all`, `dermal`, `skeletal`, `organs`) and 5 clickable anatomical zones (`neuro`, `cardio`, `musculo`, `immune`, `behavioral`).
- Auto-rotates smoothly (off when the OS requests reduced motion) and pauses rotation when the crew member hovers or drags a body region.
- Includes a resilient 2D/SVG holographic fallback inside an Error Boundary in case WebGL context creation is blocked on headless or restricted hardware.

### Visual Language
- Spacecraft HUD dark theme: `bg-slate-950` canvas, `slate-900/80` glass panels, `cyan-400` primary telemetry accents.
- Status colors:
  - Nominal (`green`): `#22c55e`
  - Elevated Drift / Caution (`yellow`): `#eab308`
  - Critical Alert (`red`): `#ef4444`
