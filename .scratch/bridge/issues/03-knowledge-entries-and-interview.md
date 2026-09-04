# 03 — Knowledge entries: `upsert_knowledge`, `get_knowledge`, confirm/reject panel

**What to build:** The agent interviews the reader in chat and records answers with `upsert_knowledge`; entries appear proposed in the Knowledge tab; the reader confirms or rejects by tap. `get_reading_state` includes a knowledge summary.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Validator rejects `source` outside enum and `evidence` < 10 chars with a `next_step`
- [ ] Re-upserting a concept updates the entry and resets status to proposed if level changed
- [ ] Confirmed vs proposed visibly distinct; no red/negative styling for rejected
