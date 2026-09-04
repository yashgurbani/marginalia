# Lexical search gate

Query: `gold scattering`  
Indexed notes: `physics/rutherford.md`, `physics/coulomb.md`  
Expected winner: `physics/rutherford.md`

Observed:

- `ok:true`;
- ranked local result first at `physics/rutherford.md`;
- fields `path`, `title`, `snippet`, and numeric `score` present;
- top-level `paths` includes `physics/rutherford.md`;
- Activity contains the returned path;
- no-vault call remains `ok:true`, empty `results`, empty `paths`, and `detail:"no vault loaded"`.

Scoring is BM25-like over body tokens with an explicit title boost and deterministic path tie-break.

Command: `node .../diagnostics/tool-contract.mjs`  
Result: `ALL PASS`.
