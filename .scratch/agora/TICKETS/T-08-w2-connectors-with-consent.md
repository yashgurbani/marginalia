# TICKET T-08 — W2 connectors with consent digest

Status: open  
Model / effort: Terra, High — security and architecture judgment  
Outcome: Define browser-side Drive, Zotero, and newsletter connector consent and egress rules.

## OWNS

- `.scratch/agora/results/T-08-w2-connectors-with-consent/REPORT.md`
- `.scratch/agora/results/T-08-w2-connectors-with-consent/digest.md`

Research only. Do not edit source or code-adjacent files.

## Depends on

`T-07-w1-library-and-snapshot-store`.

## Acceptance check

Return a digest that answers which FeynmanILE `providers.md` and Noether IRE `providers.rs` consent patterns apply, what raw bytes can remain local, what text can reach an agent, how static-origin Drive and Zotero OAuth behave, and how fail-closed and HITL rules work. Cite verified public documentation with access dates. Include a recommended next ticket and no-code confirmation.

## Stop condition

Stop when the egress boundary and consent decision are explicit. Do not implement OAuth, a daemon, or a connector prototype.

## Size estimate

Medium, about 2–4 hours.
