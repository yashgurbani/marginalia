# T19 handback — chief decisions and ownership

Received Opus 5's completed source/design slice on 17 September 2026. The three owned documents are delivered; installer/runtime acceptance remains open. Receipt messaging is the relay because Opus cannot reach the chief task directly.

## Platform scope — explicit user correction

Windows, Linux and macOS are equal target platforms. The user can test Windows/Linux directly and will arrange a Mac. “Windows first” must not be interpreted as Windows-only architecture, implementation or release scope. Portable daemon data/config paths, process launch and cancellation, installer/recovery behavior and Codex app-server operation are required from the outset. Platform-specific confinement evidence must be real; lack of a Mac today is an evidence gap, not permission to omit macOS support.

## Routine product defaults

- Show/renew pairing codes through the helper's own trusted page; never return codes to arbitrary extension/page origins. Bootstrap and CSRF protection must support first pairing without exposing the code remotely.
- Retain saved data on uninstall by default. Explicit data removal offers export first and requires a deliberate confirmation.
- Keep two verified pre-upgrade backups. Preserve an unresolved failed-migration recovery copy separately. Use a consistent SQLite backup operation that accounts for WAL; do not copy only an active database file.
- Public `/health` reports minimal liveness only. Detailed account, runtime/version and diagnostic information requires pairing.
- C12 is T06's server admission responsibility, with T04 extension identity and T01 pairing collaboration. The current acceptance of any syntactically valid extension origin is a source observation; whether it enables an unauthorized action must be analyzed together with the challenge/token protocol. Restrict admission through an explicit usable registration/allowlist flow rather than breaking Firefox or development installs with an unexplained fixed ID.

## C1–C15 routing

| Change | Accountable owner | Disposition |
|---|---|---|
| C1 stable data/web paths | T06 main composition, T19 packaging | Remove dependence on launch working directory; use portable configured locations |
| C2 dedicated runtime home | T06 / T13 | Remove hard-coded D: path; bind configuration, diagnostics and policy evidence to the same runtime |
| C3 correct sign-in evidence | T01 diagnostics + T06 wiring | Assigned to Pro-backed T01 fixes; desktop account status must not imply product readiness |
| C4 helper-page pairing management | T01 + T06 + T19/T11 UI | Real trusted bootstrap/renewal and paired-browser revocation flow still required |
| C5 port configuration/errors | T04 + T06 / T19 | One supported discovery/configuration story and calm bind-failure handling |
| C6 offline Disconnect | T05 | Assigned to Pro-backed UI correction; clearing local connection and remote revocation are distinct outcomes |
| C7 live status/pairing input/copy | T05 + T04 | Use actual state, accessible numeric input and truthful revoked/unpaired distinctions |
| C8 safe migrations/recovery | T07 + T06/T19 startup | Assigned backup/newer-schema handling to store owner; do not test on the user's database |
| C9 sanitized diagnostics copy | T11 + T01 | Versions/states only; no page text, tokens, account identifiers or raw process output |
| C10 export everything | T11 + T07 | Extend real persisted export; preserve recovery data; inert preview |
| C11 library/settings entry | T05 | Mount existing T11 surface with real adapters; a re-export alone is incomplete |
| C12 extension admission | T06 with T04/T01 | Explicit trusted registration/allowlist, evaluated with actual pairing protocol |
| C13 health visibility | T06 | Minimal public liveness; paired detailed diagnostics |
| C14 platform installers | T19 | Still required for all three platforms; separate implementation package after current boundary corrections |
| C15 README/listing | T12 / T19 | Claims must follow demonstrated behavior and actual platform evidence |

Pro fixes use separate owned branches/artifacts; shared integration source remains under chief control. Cross-owner requests are not permission to edit another owner's files. Tests were authorized after consolidation at `2c35157`; the original T19 checklist remains an unexecuted historical artifact until actual checks are recorded.
