---
name: Coverage improvement
about: PR opened by the Copilot coverage agent
---

## Coverage improvement

### What this PR covers
<!-- List which files' coverage improved and by how much -->
| File | Before | After | Δ |
|------|--------|-------|---|
|      |        |       |   |

### Closes
<!-- Link the coverage issue: Closes #NNN -->

### Self-audit results

- [ ] `yarn backendTests` passes
- [ ] Every file listed in the issue improved by ≥ 10 percentage points OR reached ≥ 60% line coverage
- [ ] No test uses `assert.ok(true)` or is an empty stub
- [ ] Test names describe behavior, not implementation
- [ ] No test depends on another test's side effects
- [ ] Presets-mode and kits/variants mode both exercised where relevant
- [ ] Single-config and multi-config generator paths both tested where relevant
- [ ] `yarn lint` passes
- [ ] `CHANGELOG.md` has an entry under `Improvements:`
- [ ] Tests are in `test/unit-tests/backend/` (runnable without VS Code host)

### Coverage delta (paste `c8` text report here)
```
(paste output of: npx c8 report --reporter=text)
```
