# AI knowledge base corpus

Markdown documents the AI Flight Surgeon can look up (`specs/05-data-platform.md` §3.6). `npm run rag:ingest` loads every `*.md` file here (except this README), together with the in-repo emergency checklists and countermeasure library.

Full guide (embedding models, calling it from the AI, API, troubleshooting): [`docs/AI_KNOWLEDGE_BASE.md`](../../../docs/AI_KNOWLEDGE_BASE.md).

## File format

```markdown
---
id: reference/sans-ocular-checks        # optional, defaults to corpus/<file name>
title: SANS ocular self-checks
source_id: SRC-010                      # required: an ID registered in SOURCES.md
kind: clinical_reference                # emergency_checklist | countermeasure | clinical_reference | medication
zones: [neuro]                          # optional: neuro, cardio, musculo, immune, behavioral
url: https://…                          # optional: deep link to the exact section
---

## Section heading

Paragraphs and lists. Each heading starts a new chunk.
```

## Rules

- **Only verified text.** Copy or closely paraphrase the primary source named in `source_id`, and add the file to that source's **Used in** cell in `SOURCES.md`. Text an AI wrote is not a source (AGENTS.md §7).
- **One clinical unit per section.** Keep a checklist, a dose with its contraindications, or a full procedure under one heading. The chunker never splits a list or table, but it may split between paragraphs of a long section.
- Files with a missing or unknown `source_id` are skipped and reported by `npm run rag:ingest`.
