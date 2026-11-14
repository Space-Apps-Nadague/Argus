---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building a new UI or reshaping an existing one. Use before any UI work to choose an aesthetic direction, typography, layout and motion that fit the subject instead of templated defaults.
---

# Frontend Design

Work like the design lead of a studio known for giving every product a distinct identity. Make deliberate, opinionated choices about palette, typography and layout that are specific to this brief, and take aesthetic risk when it is justified.

## 1. Ground the design in the subject

- Before designing, write down in one line each: the **subject**, the **audience**, and the **primary job** of the screen. If the brief does not say, propose them and confirm with the product owner.
- Distinctive choices come from the subject's industry, materials and vocabulary. A children's toy and an analyst dashboard should look nothing alike. Use the product's real content throughout, not lorem ipsum.
- If the project already defines a visual language (for example a section in `AGENTS.md` or a spec), that language wins. Work inside it and spend your freedom only on the axes it leaves open.

## 2. Design principles

- **Lead with the most characteristic thing.** The first thing people see should be the most telling element of the subject's world (a live visualization, a key number, an interactive moment). The "big number + small label + gradient accent" hero is a default, so use it only if it really is the best option.
- **Typography carries the personality.** One or two families. If two, make them clearly different in role. Pick typefaces on purpose and set a clear type scale (sizes, weights, line heights, tracking).
- **Readable lines.** Keep body text under ~80 characters per line. Serif body text needs slightly more line height than sans-serif.
- **Avoid generated-page tells** unless the brief asks for them: accenting a single word in a headline, ALL-CAPS labels everywhere, unnecessary eyebrow labels above content.
- **Structure is information.** Borders, numbering, dividers and labels must encode something real. Numbered markers (01 / 02 / 03) only make sense for an actual sequence.
- **Motion is earned.** Motion nobody triggered should be rare and purposeful: one orchestrated moment beats scattered fade-ins. Motion that responds to an action (open, expand, confirm) is welcome when it shows what changed. Always respect `prefers-reduced-motion`.
- **Words are design content.** See the `ux-copy` skill. Copy can make a design feel as templated as its visuals.

## 3. Calibrate against generic defaults

Generated UI tends to fall into these looks. Each is valid for some briefs, but they are defaults, not choices:
1. Warm cream background with a high-contrast serif display and a terracotta/clay accent.
2. Near-black background with a single acid-green or vermilion accent.
3. Broadsheet layout: hairline rules, zero radius, dense newspaper columns.
4. The SaaS card kit: everything chopped into identical rounded cards with the same radius and soft grey shadow, plus gradient washes as decoration.
5. Template chrome on every subject: tracked-out ALL-CAPS eyebrows, `A · B · C` meta strings, `WORD — fragment` labels, tinted near-black instead of black, monospace for every small label, `→` appended to every link.

Where the brief pins down a direction, follow it exactly. Where it leaves an axis free, don't spend that freedom on one of these defaults.

## 4. Process: plan → review → build → critique

1. **Plan** a compact token system:
   - *Color:* 4–6 named hex values (base, surface, text, accent, semantic states).
   - *Type:* typefaces and their roles, plus the scale.
   - *Layout:* a one-sentence concept plus an ASCII wireframe. State the alignment rules.
   - *Principles:* 2–4 rules that make this screen unique.
2. **Review the plan against the brief.** If a part reads like what you would produce for any similar screen, revise it and note what changed and why.
3. **Build** following the revised plan. Watch CSS specificity: type selectors and component classes that cancel each other out are a common source of spacing bugs. With utility CSS (e.g. Tailwind), keep tokens in the config, not as scattered arbitrary values.
4. **Critique** while building: render the result, look at it at phone and desktop widths, and fix what you see. Use the `design-critique` and `accessibility-review` skills before calling it done.

## 5. Restraint

- Spend boldness in **one** place. Let one element be memorable and keep everything around it quiet.
- Before finishing, remove one decoration.
- Quality floor, always and without announcing it: responsive down to ~360 px, visible keyboard focus, reduced motion respected, sufficient contrast, harmonious palette.

## 6. Writing inside the design

- Name things by what users understand, not how the system is built.
- Active voice. Buttons say exactly what happens ("Save changes", not "Submit"), and the same action keeps the same name through the whole flow.
- Errors explain what happened and how to fix it, without apologizing or being vague. Empty states invite the next action.
- Sentence case, plain verbs, no filler. Each piece of text does one job.
