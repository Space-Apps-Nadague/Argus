# ARGUS — Astronaut Readiness Guidance & Unified Surveillance

## 1. Canonical Specifications (Single Source of Truth)
Before writing, editing, or refactoring any code, read the relevant files in `/specs`:
- **Architecture & Stack:** `specs/00-architecture.md`
- **Data Models, Thresholds & AI JSON:** `specs/01-data-schema.md`
- **UI Layout, Bio-Map SVG & Demo Controls:** `specs/02-ui-dashboard.md`
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