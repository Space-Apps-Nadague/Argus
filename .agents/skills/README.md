# Agent Skills

Vendor-neutral skills for any coding agent (or human) working on ARGUS. Each folder holds a `SKILL.md` in the open [Agent Skills](https://agentskills.io) format: YAML frontmatter with `name` and `description`, then Markdown instructions. `AGENTS.md` §5 says when to use each one.

| Skill | Use it when |
|---|---|
| [`frontend-design`](frontend-design/SKILL.md) | Before building or reshaping any UI: picking a direction, typography, layout, motion |
| [`design-system`](design-system/SKILL.md) | Adding or changing components or tokens, or auditing for hard-coded styles |
| [`ux-copy`](ux-copy/SKILL.md) | Writing labels, buttons, tooltips, errors, empty states; cutting text-heavy UI |
| [`accessibility-review`](accessibility-review/SKILL.md) | Before marking a UI task `[DONE]`; whenever you add tabs, popovers, modals, forms |
| [`design-critique`](design-critique/SKILL.md) | After a UI change, on the rendered app, to prioritize what to fix |

Adapted from Anthropic's Apache-2.0 skills. See each folder's `NOTICE` and `LICENSE`.
