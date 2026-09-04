# TICKET T-04 — Worker snapshot store

Status: open  
Model / effort: Sol, Medium — clear technical and integration work  
Outcome: Add a Cloudflare Worker `/snapshot?url=` path that returns an honest, sanitized snapshot for an allowed page origin.

## OWNS

- `worker/snapshot.js` — Worker handler and Readability boundary.
- `worker/wrangler.toml` — Worker configuration only.
- `src/ingest.js` — additive snapshot ingestion and hash handling.
- `src/render.js` — additive URL/open state and honest failure display.
- `.scratch/agora/results/T-04-worker-snapshot-store/` — report and evidence.

Do not edit source-layer semantics, tools, fixtures, tests, or deployment state outside the Worker configuration. Do not add a provider key.

## Depends on

`T-03-export-to-vault-copy-as-question`. The original issue is independently blocked only by Gate 1, but the deferral order schedules it here.

## Acceptance check

Run the two existing test pages and require `ALL PASS`. Deploy the Worker only in an authorized preview. From the page origin, request one known article and confirm a normalized text snapshot, content hash, and CORS allowlist. Test a paywall, non-article, fetch error, and changed content. Each displays an honest state and a changed snapshot hash. Test a disallowed origin and confirm rejection.

## Stop condition

Stop before deployment if no authorized Worker account or preview exists. Stop if CORS would allow arbitrary origins, if raw credentials are needed, or if Readability requires a new unapproved dependency. Preserve a local design digest.

## Size estimate

Large, about 3–6 hours plus authorized preview verification.
