# ARGUS — Astronaut Readiness Guidance & Unified Surveillance

## 1. Canonical Specifications (Single Source of Truth)
Before writing, editing, or refactoring any code, read the relevant files in `/specs`:
- **Architecture & Stack:** `specs/00-architecture.md`
- **Data Models, Thresholds & AI JSON:** `specs/01-data-schema.md`
- **UI Layout, Bio-Map SVG & Demo Controls:** `specs/02-ui-dashboard.md`
- **Challenge Requirements & Traceability:** `specs/03-requirements.md`
- **AI Backend (providers, endpoints, deterministic models):** `specs/04-ai-backend.md`
- **Active Sprint & File Ownership:** `specs/tasks.md`

## 2. Spec-Driven Development Protocol
1. **Spec First:** Never invent new telemetry fields, status thresholds, or component props in code without updating the corresponding file in `/specs` first.
2. **Plan Before Coding:** State which spec sections apply and which files will change before modifying code.
3. **Claim Tasks:** Mark your active task as `[IN PROGRESS]` in `specs/tasks.md` before editing files, and `[DONE]` once verified.
4. **Deterministic Triage + AI Guidance:** Keep Green/Yellow/Red threshold evaluation deterministic in TypeScript. Use the LLM layer strictly for plain-language explanations, step-by-step guided self-exams, and vision triage.

## 3. Shared Technical Standards
- **Frontend:** React 18+ (TypeScript, Vite), Tailwind CSS, Lucide Icons, Recharts.
- **Visual Language:** Dark spacecraft HUD (`bg-slate-950`, `cyan-400` primary accents, `#22c55e` Green, `#eab308` Yellow, `#ef4444` Red).
- **Spaceflight Context:** Every health indicator must map to NASA's Human Research Program hazards (`0g_transit`, `1_6g_moon`, `3_8g_mars`) and include plain-language instructions for non-physician crew.

## 4. Authoritative Reference Sources
Consult [`SOURCES.md`](./SOURCES.md) for official NASA Human Research Program (HRP) and Canadian Space Agency (CSA) reference links when grounding health indicators, radiation monitoring, hazards, risks, and spaceflight clinical guidance in future tasks.

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
- **Isolated work goes in git worktrees.** A tool may create worktrees inside its ignored local folder (e.g. `.claude/worktrees/<name>`) or in a sibling folder outside the repo. Branch from the commit that contains the latest work, and claim the task in `specs/tasks.md` as usual.
