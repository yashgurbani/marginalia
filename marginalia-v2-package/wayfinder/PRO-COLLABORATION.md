# Pro collaboration and ticket ownership

Governing ethos: "Marginalia is a margin beside whatever you are reading."

SPEC-FINAL.md governs all writers, including Pro. BUILD-PLAN-24H.md defines build tickets T00–T20; earlier numbered decision tickets are not implementation completion evidence. All FEATURE-INVENTORY rows stay in scope.

## Per-ticket handoff

Each ticket owner supplies Pro with repository, branch, exact commit, ticket ID, owned paths, dependencies, desired behavior, acceptance checks and stop condition. Use GPT-6 Pro on the authenticated Chat surface; verify visible model label before submitting. Read the consult-chatgpt skill. Use a fresh dedicated conversation for the ticket and record its URL in the ticket receipt. Never operate another task's browser tab.

Use Pro substantially for design judgment, difficult technical questions, implementation through its GitHub connector, and review. Do not assume GitHub write capability from chat prose: ask Pro to read the branch and report the observed commit first. For implementation, give Pro exclusive ownership of a disjoint path set on its own codex/pro-<ticket> branch from the published integration commit. Pause overlapping local edits until its commit is reviewed and integrated. A reported change without a Git commit/diff is advice, not delivered code. Never send credentials, local databases, browser profiles or unrelated files.

Each Codex ticket task may use bounded Luna max/Sol medium subagents within its owned paths. The chief alone assigns adjacent tickets and integrates branches. No scope cuts or changes to consent, source immutability, notes priority or full transform coverage without flagging them to the chief/user. Minor improvements proceed autonomously. Unknown provider outcomes are never automatically retried.

## Git and receipts

Integration branch: codex/marginalia-v2. Ticket tasks currently share the user's requested checkout with strictly disjoint paths; do not switch/reset this shared branch. Stage only owned paths. Coordinate commits and pushes with chief. Pro writes only separate remote branches, never the integration branch while local ticket writers are active.

Each task owns wayfinder/build-receipts/Txx.md. Record claim, exact files, Pro URL and observed access, implementation commit if any, acceptance evidence, remaining limitations, and completion/blocker. Do not edit the global checkpoint/map concurrently. The chief updates them from receipts. Stop after this ticket; send the chief task your result.

No task may describe a capability as shipped based only on a mock, fixture, consultant assertion or passing unit test. Verify the relevant entry point and report what remains untested.

## Verified fresh-chat access

Open a dedicated fresh Chat page, refresh and allow hydration. If the composer says Extra High, open it, choose Latest in Select model, then move Power to maximum Pro (5 of 5). Close the menu and verify the composer explicitly says 6 Pro before sending. The workspace-credit banner is not evidence of Pro exhaustion in this user's workspace. Latest/Sol/5.5 submenu does not list every power mode. Every ticket owner uses its own conversation and records URL/model, with GitHub branch/commit/path ownership in each handoff. Do not use stalled Branch in new chat as the default route.

## Current execution direction

User update, 17 September 2026: defer all testing until later. Do not author or run new tests, builds/typechecks as verification, or browser QA. Continue implementation and Pro source review. Retain historical evidence tied to its snapshot; later changes remain unverified. This overrides earlier TDD dispatch instructions. Chief maintains BUILD-STATUS.md; technical work uses Sol Medium and bounded bulk work Luna Max, with the designated Astra Medium design owner retained.


## Implementation worker transport

The user authorized the installed Codex MCP Router for bounded task/subtask work. Read C:\Users\reader\.codex\skills\codex-mcp-router\SKILL.md. Existing config: C:\Users\reader\.codex\config.toml [mcp_servers.codex]. Launcher: C:\Users\reader\yasb-personal\scripts\Start-Active-Codex-Mcp.ps1. Router: C:\Users\reader\yasb-personal\scripts\Codex-Mcp-Router.mjs. Prefer registered codex/codex-reply tools with explicit Sol Medium or Luna Max, cwd and file ownership. Preserve threadId and reports; never duplicate a live worker. Carry the current testing deferral into every dispatch. This is a development worker route, not Marginalia's product authentication or sandbox implementation.

Router selection correction: future connections use automatic usage-based complementary routing, not a fixed gs account. The official selector was restored with -Action Complementary. Existing connections keep their mode until reconnect; do not retry a cached Transport closed or change account settings. The production selector dry run currently chooses robi, with three drained/unhealthy candidates excluded; this is selection evidence, not a new model-authentication result.
