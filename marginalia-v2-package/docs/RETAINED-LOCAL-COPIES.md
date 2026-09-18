# Retained local copies

Marginalia's phrase “stored on your computer” covers several distinct copies. The reader-facing inventory in `ui/retained-copies.ts` is the concise disclosure; this document records the implementation boundary behind it.

| Copy | Location category | Remove behavior | Export behavior |
| --- | --- | --- | --- |
| Source versions | Local helper SQLite database | Thread removal is a tombstone. Source records remain. Search text is deleted once no active thread refers to that version. | A thread export includes linked source versions. |
| Note versions | Local helper SQLite database | Note or thread removal retains current/history records and deletes applicable FTS rows. | Current notes and note-version history are in the thread export. |
| Reply versions and views | Local helper SQLite database | Reply or thread removal retains version/view records and deletes applicable FTS rows. | Replies, views, and available thread-scoped history are in the thread export. |
| Full-text search copies | SQLite FTS5 table in the local helper database | Applicable source, note, and reply rows are deleted on logical removal and rebuilt on restore. | Not separately exported; linked records are exported. |
| Pending work and conflicts | Browser IndexedDB, with failed writes also retained in memory for the open document | Retry or resolve explicitly. No global erase control exists yet. | Margin export includes source-bound journal state, drafts, and question history. Export memory-only work before closing. |
| Saved-reply cache and recovery history | Browser IndexedDB | Helper removal does not currently clear this cache. No cache-wide erase control exists yet. | The selected thread can export saved replies, local views, and recovery history. |
| Pre-upgrade backups | Local backup storage beside the helper database | Routine snapshots rotate; unresolved failed-upgrade recovery material remains until explicit recovery resolution. Thread removal does not rewrite backups. | Not part of a thread export. |
| Downloaded exports | A location selected by you | Marginalia cannot remove a file after download. | Each download is another retained copy that you manage. |

“Remove” is an application-level logical operation. Marginalia does not claim secure physical erasure: SQLite, the browser storage engine, the filesystem, or the storage device may retain old bytes outside the records that the application can address. The UI does not display database paths, backup paths, pairing tokens, or credentials.

The focused erasure regression in `tests/store.test.ts` verifies that source, note-version, and reply-version records remain after a thread tombstone, while their separate FTS copies are gone and are recreated only by an explicit restore.
