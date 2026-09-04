# Agora packets for Marginalia

These packets describe the post-hackathon work that follows the 08:15 handoff. Read the packet before dispatch. The packet is the scope boundary.

## Route

- `PRO-EXPEDITION-01` is one GPT-5.6 Sol Pro expedition through ChatGPT. Use the receipt-guarded `Manage-AgoraProSubmission.ps1` and `Invoke-AgoraChatRuntime.ps1 -Effort Pro` route.
- Use one consolidated Pro request. Do not send a follow-up for status, prose, formatting, or browser recovery.
- Use a follow-up only for a critical failed acceptance gate from the initial packet, after the normal additional-request gate passes.
- Route bounded implementation tickets to the model and effort in each packet: Sol Medium for clear technical work, Terra High for mid-judgment work, and Luna xhigh for deterministic bulk work.
- Route W1–W8 as research-only packets. They return a digest. They do not edit source and do not create code PRs.

## Run order

1. Run `PRO-EXPEDITION-01` on a dedicated branch for the public `yashgurbani/marginalia` repository.
2. Require the Pro PR to target `main`. Never commit to `main` and never direct-push to `main`.
3. Dispatch `T-06-connections-graph-fallback` only when the Pro report proves that the optional graph tab is not complete. Keep it blocked while Pro owns `src/graph.js`.
4. After the Pro PR is integrated, run the implementation tickets in deferral order: T-01, T-02, T-03, T-04, and T-05. Use the dependency fields as the gate.
5. Run W1–W8 in dependency order. Research tickets can write only their result digest.

## Results and boundaries

Every ticket writes its report and trial artifacts under `.scratch/agora/results/<ticket-id>/`. Create that directory before dispatch. Keep scripts, diagnostics, screenshots, metrics, and candidate artifacts there.

Do not write `src/` directly unless the ticket lists the exact source path in its `OWNS` section. The Pro packet is the explicit exception for its five listed source files. A worker must not edit another ticket's source paths, shared contract files, fixtures, tests, or deployment state.

For each implementation ticket, use one chat, one branch, one exact writer boundary, and one `REPORT.md`. Open a PR against `main`. The parent chair integrates the PR after the writer-boundary and baseline checks pass. The parent chair owns integration, deployment, and final acceptance.

For every research ticket, write `REPORT.md` and `digest.md` in the result subtree. Do not edit application code. Include evidence paths or URLs, a recommendation, unresolved questions, and the next decision or ticket.

## Verification

Run the static page without a build step:

```powershell
python -m http.server 4173
```

Open `http://127.0.0.1:4173/tests/render.test.html` and `http://127.0.0.1:4173/tests/tools.test.html`. Each page must print `ALL PASS`. Run the exact feature checks in the ticket as well. A model statement is not test evidence.

Stop a packet when it reaches its stop condition. Preserve the report and the failed gate. Do not enlarge the boundary to repair an unrelated problem.

