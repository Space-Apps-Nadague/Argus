---
name: ux-copy
description: Write or review interface copy (labels, buttons, tooltips, error messages, empty states, confirmations, onboarding). Use when naming a control, shortening text-heavy UI, or wording errors and empty states.
---

# UX Copy

Words in an interface exist to make it easier to understand and use. Treat them as design content, not decoration.

## Before writing, know

- **Context:** which screen, flow or component?
- **User state:** what is the user trying to do, and how are they likely feeling (busy, stressed, exploring)?
- **Tone:** set by the product (e.g. calm, precise, operational).
- **Constraints:** space and character limits, translation, platform conventions.

## Principles

1. **Clear:** say exactly what you mean. No internal jargon. Name things by what users understand, not how the system is built.
2. **Concise:** fewest words that carry the full meaning. Cut "please", "simply", "in order to".
3. **Consistent:** one term per concept everywhere. An action keeps its name through the flow ("Log check-in" → toast "Check-in logged").
4. **Useful:** every word helps the user act or decide.
5. **Human:** sentence case, plain verbs, active voice.

## Reducing text-heavy UI

- Put a **label + value** on the surface and move the explanation into a tooltip/popover or a "More" disclosure.
- Prefer an icon + 1–3 word label over a sentence. Pair icons with text for anything that matters.
- One idea per line. If a card holds a paragraph, ask what decision the reader needs to make and keep only that.
- Show units next to numbers instead of describing them.
- Avoid repeating the same information in a heading, a subtitle and a caption.

## Patterns

**Buttons / CTAs:** start with a verb and name the outcome: "Log check-in", "Queue packet", "Add crew member". Avoid "Submit", "OK" or "Go".

**Error messages:** what happened + how to fix it, specific and without apologizing.
- "Out of range: enter 30–180 bpm."
- "Camera blocked. Allow camera access or upload a photo instead."

**Empty states:** what this is + why it's empty + how to start.
- "No check-ins yet. Log today's readings to start your streak."

**Confirmations:** name the action and consequence; buttons repeat the action.
- "Delete crew member Vega? Their check-ins are removed too." → [Delete crew member] [Keep]

**Tooltips:** one or two short sentences that add something the label can't. Never restate the label.

**Status / success:** brief and factual ("Packet queued for Earth · ETA 14m 22s").

**Loading:** set expectations ("Analyzing image…").

## Voice by situation

- Success: brief, not celebratory.
- Error: calm and actionable.
- Warning: clear about the risk and the next step.
- Critical/safety: direct imperative, no softening ("Stop exercise. Measure SpO₂ now.").

## Review output

```markdown
## UX Copy: <context>
| Element | Current | Proposed | Why |
|---------|---------|----------|-----|

### Terminology
| Concept | Use | Avoid |

### Localization notes
Idioms to avoid, expected text expansion (~30%), units/number formats.
```
