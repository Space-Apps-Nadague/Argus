# ARGUS — Astronaut Readiness Guidance & Unified Surveillance

## 1. Canonical Specifications (Single Source of Truth)
Before writing, editing, or refactoring any code, read the relevant files in `/specs`:
- **Architecture & Stack:** `specs/00-architecture.md`
- **Data Models, Thresholds & AI JSON:** `specs/01-data-schema.md`
- **UI Layout, Bio-Map SVG & Demo Controls:** `specs/02-ui-dashboard.md`
- **Challenge Requirements & Traceability:** `specs/03-requirements.md`
- **AI Backend (providers, endpoints, deterministic models):** `specs/04-ai-backend.md`
- **Data Platform (database, users & roles, wearables, analytics, NASA data):** `specs/05-data-platform.md`
- **Tasks, Status & File Ownership:** [GitHub Issues](https://github.com/Space-Apps-Nadague/Argus/issues) and the GitHub Projects kanban (`Backlog` / `Todo` / `Urgent` / `In Progress` / `Done`). There is no task file in the repo.

## 2. Spec-Driven Development Protocol
1. **Spec First:** Never invent new telemetry fields, status thresholds, or component props in code without updating the corresponding file in `/specs` first.
2. **Plan Before Coding:** State which spec sections apply and which files will change before modifying code.
3. **Claim Tasks:** Before editing files, assign yourself to the GitHub issue (open one if none exists, listing the files it touches) and move its card to `In Progress`. Close it from the PR with `Closes #<n>` once `npm test` and `npm run build` pass.
4. **Deterministic Triage + AI Guidance:** Keep Green/Yellow/Red threshold evaluation deterministic in TypeScript. Use the LLM layer strictly for plain-language explanations, step-by-step guided self-exams, and vision triage.

## 3. Shared Technical Standards
- **Frontend:** React 18+ (TypeScript, Vite), Tailwind CSS, Lucide Icons, Recharts.
- **Visual Language:** Dark spacecraft HUD (`bg-slate-950`, `cyan-400` primary accents, `#22c55e` Green, `#eab308` Yellow, `#ef4444` Red).
- **Spaceflight Context:** Every health indicator must map to NASA's Human Research Program hazards (`0g_transit`, `1_6g_moon`, `3_8g_mars`) and include plain-language instructions for non-physician crew.

## 4. Authoritative Reference Sources
Consult [`SOURCES.md`](./SOURCES.md) for official NASA Human Research Program (HRP), Canadian Space Agency (CSA), wearable and dataset references when grounding health indicators, radiation monitoring, hazards, risks, and spaceflight clinical guidance. Every source you use must be recorded there (§7).

## 5. Agent Skills (`.agents/skills/`)
Vendor-neutral skills in the open Agent Skills `SKILL.md` format. Read a skill's `SKILL.md` when its trigger applies. Index: [`.agents/skills/README.md`](./.agents/skills/README.md).
- **`frontend-design`**: read before building or reshaping any UI (direction, typography, layout, motion). The visual language in §3 always wins.
- **`design-system`**: read before adding or changing components or tokens. No new hard-coded colors/sizes outside `tailwind.config.js` / `src/index.css`. Reuse `src/components/ui/` primitives.
- **`ux-copy`**: use for every label, button, tooltip, error and empty state. Keep the HUD low-text and put explanations in `InfoTip`.
- **`accessibility-review`**: run before marking any UI task `[DONE]` (WCAG 2.2 AA: contrast, keyboard, focus, non-color status cues). Fix critical and major findings first.
- **`design-critique`**: run on the rendered app after UI changes to prioritize fixes.

## 6. Agent Folders & Git Conventions
- **`.agents/` is the only tracked agent folder.** Shared, vendor-neutral agent material (skills, prompts, playbooks) goes here so every AI tool and human uses the same files.
- **Tool-specific folders are local-only and gitignored:** `.claude/`, `.cursor/`, `.codex/`, `.gemini/`. Never commit them, and never put shared conventions in them. Don't add tool-specific instruction files (e.g. `CLAUDE.md`); `AGENTS.md` is the single entry point.
- **Isolated work goes in git worktrees.** A tool may create worktrees inside its ignored local folder (e.g. `.claude/worktrees/<name>`) or in a sibling folder outside the repo. Branch from the commit that contains the latest work, and claim the GitHub issue as usual.

## 7. Source Attribution (always collect sources)
Every external fact, threshold, constant, dataset, simulation parameter or algorithm must be traceable to a source and to where it is used.
1. **Register it.** Add the source to [`SOURCES.md`](./SOURCES.md) with the next free `SRC-xxx` ID. IDs are never renumbered or reused.
2. **Cite it where it is used.**
   - Code: `// Source: SRC-007 (NASA-STD-3001 Vol 1 Rev C §4.8)` next to the constant or function.
   - Specs: `[SRC-007]`.
   - Database rows: `source_id = 'SRC-007'`.
   - Datasets: an `ingest_runs` row with the `source_id`.
3. **Record where.** Update the source's **Used in** cell (file, spec section or DB table) in the same change. When usage is removed, remove it from the cell.
4. **Commits** that add or use sources end with a trailer: `Sources: SRC-003, SRC-007`.
5. **PRs** fill in the "Sources used" table in `.github/pull_request_template.md` (ID → where it was used).
6. **Check.** `npm run check:sources`, which also runs inside `npm test`, fails on IDs cited in code or specs that are missing from `SOURCES.md`, and warns about sources with an empty **Used in** cell.
7. **AI-generated facts are not sources.** If an LLM or agent suggested a fact, find and cite the primary source before using it, or label it clearly as an assumption in the spec.

