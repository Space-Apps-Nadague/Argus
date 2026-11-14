---
name: design-critique
description: Give structured, prioritized feedback on a screen or flow, covering first impression, usability, visual hierarchy, consistency and accessibility. Use after building or changing UI (on a rendered screenshot or running app) to decide what to fix first.
---

# Design Critique

Review a design or running UI and produce specific, prioritized, actionable feedback.

## Inputs

- **The design:** a running page, screenshots at desktop and phone widths, or a detailed description. If you can run the app, render it and look at it yourself instead of judging the code alone.
- **Context:** what it is, who it's for, and its stage (exploration, refinement, final polish).
- **Focus (optional):** e.g. "only the navigation" or "mobile".

## Framework

1. **First impression (2 seconds):** what draws the eye first, and is that the right thing? Is the purpose clear immediately?
2. **Usability:** can users complete the main task? Is navigation obvious? Are interactive elements recognizable? Any unnecessary steps?
3. **Visual hierarchy:** clear reading order, right emphasis, effective whitespace, typography creating hierarchy, and no wall of text.
4. **Consistency:** follows the design system (see `design-system`)? Spacing, color and type consistent? Do similar elements behave the same?
5. **Accessibility:** contrast, target sizes, readability, focus, non-color cues (see `accessibility-review` for the full audit).

## How to give feedback

- **Specific:** "The scenario dropdown competes with the readiness score for attention", not "the layout is confusing".
- **Explain why:** link it to a principle or user need.
- **Propose a fix:** don't just name problems.
- **Say what works:** keep the good parts on purpose.
- **Match the stage:** exploration gets direction, final polish gets details.

## Output

```markdown
## Design Critique: <screen>

### Overall impression
1–2 sentences: what works, biggest opportunity.

### Usability
| Finding | Severity | Recommendation |
|---------|----------|----------------|
| … | Critical / Moderate / Minor | … |

### Visual hierarchy
- Draws the eye first: …
- Reading flow: …
- Emphasis: …

### Consistency
| Element | Issue | Recommendation |

### Accessibility
- Contrast: …
- Targets: …
- Readability: …

### What works well
- …

### Priority recommendations
1. Most impactful: why + how
2. …
3. …
```
