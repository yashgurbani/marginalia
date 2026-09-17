# Pro collaboration and ticket ownership

Governing ethos: "Marginalia is a margin beside whatever you are reading."

SPEC-FINAL.md governs all writers, including Pro. BUILD-PLAN-24H.md defines build tickets T00–T20; earlier numbered decision tickets are not implementation completion evidence. All FEATURE-INVENTORY rows stay in scope.

## Per-ticket handoff

Each ticket owner supplies Pro with repository, branch, exact commit, ticket ID, owned paths, dependencies, desired behavior, acceptance checks and stop condition. Use GPT-6 Pro on the authenticated Chat surface; verify visible model label before submitting. Read the consult-chatgpt skill. Use a fresh dedicated conversation for the ticket and record its URL in the ticket receipt. Never operate another task's browser tab.

Use Pro substantially for design judgment, difficult technical questions, implementation through its GitHub connector, and review. Do not assume GitHub write capability from chat prose: ask Pro to read the branch and report the observed commit first. For implementation, give Pro exclusive ownership of a disjoint path set on its own codex/pro-<ticket> branch from the published integration commit. Pause overlapping local edits until its commit is reviewed and integrated. A reported change without a Git commit/diff is advice, not delivered code. Never send credentials, local databases, browser profiles or unrelated files.

Each Codex ticket task may use bounded Luna max/Sol high subagents within its owned paths. The chief alone assigns adjacent tickets and integrates branches. No scope cuts or changes to consent, source immutability, notes priority or full transform coverage without flagging them to the chief/user. Minor improvements proceed autonomously. Unknown provider outcomes are never automatically retried.

## Git and receipts

Integration branch: codex/marginalia-v2. Ticket tasks currently share the user's requested checkout with strictly disjoint paths; do not switch/reset this shared branch. Stage only owned paths. Coordinate commits and pushes with chief. Pro writes only separate remote branches, never the integration branch while local ticket writers are active.

Each task owns wayfinder/build-receipts/Txx.md. Record claim, exact files, Pro URL and observed access, implementation commit if any, acceptance evidence, remaining limitations, and completion/blocker. Do not edit the global checkpoint/map concurrently. The chief updates them from receipts. Stop after this ticket; send the chief task your result.

No task may describe a capability as shipped based only on a mock, fixture, consultant assertion or passing unit test. Verify the relevant entry point and report what remains untested.
