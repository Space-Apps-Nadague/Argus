## What & why
<!-- One or two sentences. Link the issue: Closes #<n> -->

## Specs updated first
- [ ] `specs/…` sections changed: <!-- e.g. 05 §3.4 -->

## Sources used
<!-- Required by AGENTS.md §7. Every external fact, threshold, dataset or parameter. Write "none" if this PR uses no sources. -->

| Source ID | Where it is used (file / spec section / DB table) |
|---|---|
| SRC-… | |

- [ ] New sources are added to `SOURCES.md` and their **Used in** cells are updated
- [ ] `npm run check:sources` passes

## Checks
- [ ] `npm test`
- [ ] `npm run build` and `npm run typecheck:server`
- [ ] DB changes: migration generated with `npm run db:generate` and committed
