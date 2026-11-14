---
name: accessibility-review
description: Run a WCAG 2.2 AA accessibility audit on a page, component or design, covering contrast, keyboard operation, focus, target size, forms, and screen-reader names/roles. Use before marking any UI task done, and whenever you add interactive elements (tabs, popovers, modals, forms, charts).
---

# Accessibility Review

Audit UI against **WCAG 2.2 Level AA** and report prioritized, fixable findings.

## WCAG 2.2 AA quick reference

**Perceivable**
- 1.1.1 Non-text content has a text alternative (icons that carry meaning get `aria-label` or visible text; decorative ones get `aria-hidden="true"`)
- 1.3.1 Structure is conveyed semantically (headings, lists, tables, landmarks, label/input association)
- 1.4.1 Color is not the only way information is conveyed (status = color **plus** icon/text)
- 1.4.3 Text contrast ≥ 4.5:1 (≥ 3:1 for large text: ≥ 24 px, or ≥ 18.66 px bold)
- 1.4.10 Reflow: no two-dimensional scrolling at 320 CSS px width
- 1.4.11 Non-text contrast ≥ 3:1 (input borders, focus rings, chart lines, icons that carry meaning)
- 1.4.13 Content on hover/focus (tooltips/popovers) is dismissible (Esc), hoverable, and persistent

**Operable**
- 2.1.1 Everything works with the keyboard. 2.1.2 No keyboard traps (modals trap focus *inside* but release on close)
- 2.4.3 Logical focus order. 2.4.7 Focus is visible. 2.4.11 Focus is not obscured by sticky headers/overlays
- 2.5.8 Target size ≥ 24×24 CSS px (aim for 44×44 on touch-first UI)
- 2.3.3 / `prefers-reduced-motion`: decorative motion can be disabled

**Understandable**
- 3.2.1 / 3.2.2 No unexpected context change on focus or input
- 3.3.1 Errors are identified in text. 3.3.2 Inputs have labels/instructions. 3.3.3 Error messages suggest a fix

**Robust**
- 4.1.2 Every control exposes name, role, value/state (e.g. `aria-selected`, `aria-expanded`, `aria-invalid`)
- 4.1.3 Status messages (e.g. "Check-in logged") are announced via `role="status"` / `aria-live`

## Common widget patterns (WAI-ARIA Authoring Practices)

- **Tabs:** container `role="tablist"` (with `aria-label`); each tab `role="tab"`, `aria-selected`, `aria-controls`, `id`; panel `role="tabpanel"`, `aria-labelledby`, `tabIndex=0`. Only the active tab is in the tab order (`tabIndex=0`, others `-1`). ←/→ move between tabs, Home/End jump to the first/last.
- **Popover/tooltip:** trigger is a real `<button>` with `aria-label`/`aria-expanded`. Content is reachable by keyboard and closes on Esc.
- **Modal dialog:** `role="dialog"` + `aria-modal="true"` + `aria-labelledby`. Focus moves in on open, stays trapped inside, and returns to the trigger on close. Esc closes.
- **Form field error:** `aria-invalid="true"` + `aria-describedby` pointing at the error text.
- **Charts:** give a text summary (e.g. a caption with the latest value and trend) and don't rely on color alone for series.

## Testing approach

1. Automated scan (axe or Lighthouse) catches roughly 30% of issues.
2. **Keyboard only:** Tab through every screen. Can you reach, operate and see focus on everything? Can you escape every overlay?
3. **Contrast:** check text and UI boundaries against their real background, including translucent/blurred panels.
4. **Zoom to 200% and 320 px width:** does the layout reflow without horizontal page scroll?
5. **Screen reader spot-check** (VoiceOver, NVDA or Orca): are names, roles and states announced correctly?
6. **Reduced motion:** enable it in the OS and confirm decorative animation stops.

## Report format

```markdown
## Accessibility Audit: <screen/component>
**Standard:** WCAG 2.2 AA | **Date:** <date>

### Summary
Issues: X | Critical: X | Major: X | Minor: X

### Findings
| # | Issue | Criterion | Severity | Fix |
|---|-------|-----------|----------|-----|
| 1 | Status shown by color only | 1.4.1 | Critical | Add icon + label |

### Contrast
| Element | FG | BG | Ratio | Required | Pass |

### Keyboard
| Element | Reachable | Enter/Space | Esc | Arrows |

### Priority fixes
1. Critical: blocks someone from completing a task
2. Major: significant friction
3. Minor: polish
```

Severity: **Critical** = blocks a task for some users, **Major** = causes significant difficulty, **Minor** = annoyance or best practice.

Fix critical and major findings before marking the task done. Record minor ones in the task notes.
