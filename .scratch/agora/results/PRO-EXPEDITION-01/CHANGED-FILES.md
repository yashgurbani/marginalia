# Changed files

## Application source

| Path | Change | Boundary reason | SHA-256 of final local bytes |
|---|---|---|---|
| `src/figure.js` | added | Packet-owned SVG and KaTeX helper | `a866f240e127b07aa38b636f610066b191b020a4a417558e6b739a4a4ee29105` |
| `src/vault.js` | added | Packet-owned local vault/index/search helper | `9d72299c3afc2337a200a4e8e49256e882f88ac3c06059703cae0eacfa13c2ad` |
| `src/graph.js` | added | Packet-owned graph data, fallback, and optional renderer | `4e88aa823c8ac8294542add9dbd2d73addbe6e3a27e1a05d480cae71e5db3711` |
| `src/render.js` | modified | Additive imports and wiring allowed by packet | `734deacab0c1605182c815423813d0d6e401a450755accf5b8c5a5d377ffb907` |
| `src/tools.js` | modified | Additive vault/figure/connection wiring allowed by packet | `06f005bc73db99f9fe8e5ddb659cb90fe844b169d75ba9c54e31479f71f90232` |

Baseline Git blob SHA for `src/render.js`: `458f10f96598979050e93ad350fc418fb3fb4568`.  
Baseline Git blob SHA for `src/tools.js`: `d1981b173fc9c5ab1d3413e7bd79110107df1fd0`.

## Durable expedition artifacts

All other additions are under `.scratch/agora/results/PRO-EXPEDITION-01/` and contain reports, validation records, and local diagnostic harnesses. They do not participate in application runtime.

## Confirmed untouched

`src/state.js`, `src/ingest.js`, `src/knowledge.js`, `src/style.css`, `index.html`, `tests/**`, `fixtures/**`, docs outside the result subtree, deployment files, and `main` were not edited by this expedition.
