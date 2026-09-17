# 14-repo-and-licence

label: wayfinder:grilling
mode: HITL
status: closed
blocked_by: (none)

## Question

Monorepo layout (daemon, extension, webapp, skills, contracts), licence for each part (the Sep 4 code is MIT; PaperCraft is Apache-2.0), and what is published first.

## Resolution

Resolved. Monorepo in the existing yashgurbani/marginalia repo: /daemon, /extension, /webapp, /skills, /contracts, /reader (the Sep 4 build, kept), /docs. MIT for the whole repo (existing code is MIT; PaperCraft dependency is Apache-2.0, compatible). Publish everything from day one; the repo's docs/BUILD-PLAN.md ("MCP Apps host round trip") is superseded by this package and should be replaced by HANDOFF-ASTRA.md.
