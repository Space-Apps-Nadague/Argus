---
name: design-system
description: Audit, document, or extend a UI design system (tokens, components, patterns). Use when adding or changing UI components, when you find hard-coded colors/spacing/type, or when you need a new component that must fit the existing system.
---

# Design System

Keep the UI consistent by working through tokens and shared components instead of one-off styles. There are three modes: **audit**, **document** and **extend**.

## What a design system contains

**Design tokens** are atomic values defining the visual language:
- Color (brand, semantic/status, neutrals, surfaces)
- Typography (families, scale, weights, line heights)
- Spacing (scale, component padding/gaps)
- Borders (radius, width), shadows/elevation
- Motion (durations, easings, reduced-motion behavior)

Tokens live in one place (e.g. `tailwind.config.js` theme + CSS custom properties) and components reference them by name.

**Components** are reusable elements with defined:
- Variants (primary / secondary / ghost …)
- States (default, hover, focus-visible, active, disabled, loading, error, selected)
- Sizes (sm / md / lg)
- Behavior (interactions, animation)
- Accessibility (role, keyboard, accessible name)

**Patterns** combine components: forms (fields, validation, submit), navigation (tabs, sidebar), data display (tiles, tables, charts, lists), feedback (banners, toasts, modals, inline messages).

## Principles

1. **Consistency over novelty.** Reuse before you create.
2. **Flexible within constraints.** Components compose. They are not rigid one-offs.
3. **If it isn't documented, it doesn't exist.**
4. **Version and migrate.** Breaking changes come with a migration path.

## Mode: audit

1. Search the codebase for hard-coded values: hex colors, `px` sizes, arbitrary Tailwind values (`text-[11px]`, `bg-[#...]`), inline `style` colors.
2. List near-duplicate components (three slightly different "card" or "badge" implementations).
3. Check each shared component has all relevant states, especially `focus-visible` and `disabled`.
4. Report:

```markdown
## Design System Audit
**Components reviewed:** X | **Issues:** X

### Naming consistency
| Issue | Where | Standard to adopt |

### Token coverage
| Category | Tokens defined | Hard-coded instances |
| Color | | |
| Spacing | | |
| Typography | | |

### Component completeness
| Component | States | Variants | Docs | Score /10 |

### Priority actions
1. …
```

## Mode: document

For a component, write (in the code's doc comment or the UI spec):

```markdown
## Component: <Name>
**Purpose:** what it is and when to use it (and when not to)
### Props
| Prop | Type | Default | Description |
### Variants
| Variant | Use when |
### States
| State | Visual | Behavior |
### Accessibility
- Role / accessible name
- Keyboard: Tab, Enter/Space, Esc, arrows
- Screen reader announcement
### Do / Don't
| Do | Don't |
```

## Mode: extend (new component or pattern)

1. **Problem:** what user need the existing components do not cover.
2. **Existing patterns:** list related components and why each is not enough. If one almost fits, extend it with a variant instead of creating a new component.
3. **Proposal:** API/props, variants, states, which tokens it uses (no new raw values unless they become tokens).
4. **Accessibility:** role, keyboard model, announcement.
5. **Open questions** for review.

## Checklist before merging UI changes

- [ ] No new hard-coded colors, font sizes or spacing outside the token files
- [ ] New UI uses shared primitives (card, tile, pill, button) where they exist
- [ ] Every interactive element has hover, `focus-visible` and disabled styles
- [ ] Status/semantic colors come from the semantic tokens and are paired with an icon or text
- [ ] New or changed components are documented (props, states, a11y)
