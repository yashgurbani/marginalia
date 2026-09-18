# E01 Integrate the Sol runs in flight

label: wayfinder:task
mode: AFK
status: claimed (astra, 2026-09-18)
blocked_by: (none)
route: Astra low

## Task
Four Sol medium runs were live when this map was charted. Fable merged three before handoff (P4 `6cc7eb8`, P1/P7/P9 `4bf2280`, M14/M18 `b04899a`; head `fdb12dc`, suite 785/780/0/5). Only the installer remains. Original text follows for context, each in its own worktree under `D:/Projects/Marginalia-worktrees/`: `fable-p4-store-indexes` (allen), `fable-p1-p7-p9` (merlin), `fable-m14-m18` (tw), `fable-m13-installer` (robi). Fable integrates whichever finish before the handoff; check `git log --oneline codex/marginalia-v2 | head` and `git worktree list` first. For any still unmerged: read `.local/fable-<name>/report.md` in the worktree, review `git diff`, `git add` source and tests only (never `.local/`), commit on `fable/<name>`, merge into `codex/marginalia-v2`, run `npm test`, `npm run typecheck`, `npm run prepare && npm run extension:typecheck`.

## Acceptance
- All four branches merged or explicitly rejected with a reason in this ticket's resolution.
- Suite green (baseline at charting: 781 tests, 776 pass, 0 fail, 5 skipped) and both typechecks clean.
- Origin `codex/marginalia-v2` pushed.
