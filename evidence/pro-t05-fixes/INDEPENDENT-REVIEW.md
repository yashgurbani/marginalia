# T05 fixes — independent review

## Scope and decision

- Target: `d216063b8f99b93c1ff82eccd79ebf65eca5bb12` (`d216063`)
- Comparison/base: `3b6f61f` (`git diff 3b6f61f...d216063`)
- Review scope: the narrow reconciliation claimed in the native report matrix, not a restart of the full T05 review
- Production changes by this review: none
- Verification: targeted reads, `git diff --check`, and the two focused margin suites only

**Bounded acceptance:** this target is demonstrably more than a pure `c5` restore. The Final-Pro capture/section preservation and the saved-thread fallback guard are present in the committed target. I do not accept the target as fully integrated or as proof of the entire native matrix, because three concrete blockers remain below. The uncommitted Sol edits visible in the working tree were not treated as part of `d216063` and are not included in this report commit.

## Claim checks

### 1. Final-Pro capture and section preservation — accepted at source level

`marginalia-v2-package/ui/margin.ts:92-97` in `d216063` clones the incoming capture and uses `options.sections ?? capture.sections`, cloning the selected section list before UI ordering. This preserves the recorded `capture.sections` default and keeps UI ordering separate from the source capture used for attachment.

This is a code-level acceptance of the narrow claim. A dedicated test that mutates the host-owned capture/sections after mount is not present; the native browser durability claim therefore remains open.

### 2. Source-bound question storage — partial; continuity blocker

The committed target changes the question key at `ui/margin.ts:139-143` to:

```text
question:<tabKey>:<capture.url>[:<draftScope>]
```

That key is source-bound, and export history at `ui/margin.ts:900` still filters retained questions by `q.capture?.url === capture.url`. However, the parent code used `question:` plus the existing `draftKey`, whose durable shape was `question:draft:<tabKey>:<capture.url>[:<draftScope>]`. `d216063` has no legacy read or migration path. Existing persisted question drafts written by the parent can therefore become invisible after this target is installed.

**Blocker Q1:** source isolation is implemented, but backward-readable source-bound question storage is not proven and is likely broken for already-persisted drafts. The current working tree contains an uncommitted Sol edit that restores `question:` + `draftKey`; that edit is not part of `d216063` and is not being committed here. Exact missing evidence for acceptance is either a committed legacy-key fallback/migration or a test proving old and new persisted question records both hydrate correctly.

### 3. Saved-thread handling — fallback accepted; local reply identity remains blocked

The committed `threadsNow` guard at `ui/margin.ts:146-157` does the intended narrow work: a `savedThread` snapshot is not reintroduced when the local journal already has the thread ID or when pending, conflict, or resolution history names that ID. `ui/margin-model.ts:6-8` then limits displayed threads to the current source URL and non-deleted records. The recovery evidence also has passing focused cases for deliberate absence and source-bound orphan export.

The remote saved-reply path checks `bundle.source.id` against the current thread source version at `ui/margin.ts:617-620`. The local path does not provide the same guarantee: `readReplies` calls `persistence.replies.list(thread.id)` at `ui/margin.ts:629`, and `ui/persistence.ts:329-340` filters only by `record.version.threadId`. Before mounting at `ui/margin.ts:642-657`, there is no check that `saved.source.id === thread.sourceVersionId` (or an equivalent current-source identity).

**Blocker T1:** a cached reply attached to an older source version can be mounted after the same thread's current source identity changes. The existing equal-revision test uses a matching `source` ID and does not exercise this mismatch. The fallback/absence guard is accepted; the matrix's broader “source/reply loads validate current source IDs” claim is only partial.

## Targeted verification

`node --experimental-strip-types --test tests/margin-entry.test.ts tests/margin-recovery.test.ts` under Node `v24.14.1` / npm `11.11.0` produced **30 passed, 1 failed** in both runs (once at the committed target, and again after the uncommitted Sol working-tree delta was visible).

The reproducible failure is:

```text
tests/margin-entry.test.ts:23
reading-position editor is connected, anchored and single-map across save failure, collapse and suspend
Error: Missing button: Retry saving
```

The failure occurs after the controlled `journal` quota error and before the test can retry the retained note. The current working tree adds a `draftSaveFailed` latch and a clean-settings assertion, but the same focused failure remains. `git diff --check 3b6f61f...d216063` is clean.

**Blocker R1:** the focused retry/recovery behavior is not currently green, so the native matrix's “entry/recovery tests pass” wording is not independently reproducible in this checkout. This is a concrete T05 integration hold even though the other 30 focused tests passed.

## Evidence limits and remaining native gates

`marginalia-v2-package/docs/evidence/pro-t05-fixes/NATIVE-INTEGRATION-REVIEW.md:33-50` records the reconciliation matrix, but its header still says `Bounded fixes commit: pending (this change)` and does not bind the matrix counts to `d216063`. Its own acceptance section (`:54-55`) leaves the following unverified:

- real localhost Origin/Fetch-Metadata enforcement and Show/Renew/Pair/List/Forget/401 behavior;
- re-pair, offline, quota, reload/restart durability and extension-panel transport;
- keyboard, screen-reader, and actual 200%-zoom behavior; and
- the real note → exact consent → provisional → committed reply → explicit follow-up/cancel/unknown journey, including T06's send boundary and T20 runtime/renderer acceptance.

The report also says the supplied browser harness could not be reproduced with the installed TypeScript 5.9 API under Node 24, so its earlier Node 22/Chromium results are historical rather than native acceptance. No live provider, extension transport, or cross-owner runtime evidence was added by this review.

## Final disposition

Accept the target narrowly as a non-pure-`c5` source reconciliation for:

- freezing the original capture and retaining recorded sections; and
- preventing a library fallback snapshot from resurrecting a deliberate local absence or overriding pending/conflict/resolution history.

Hold overall T05 acceptance on **Q1** (persisted-question key continuity), **T1** (local cached-reply source-version validation), and **R1** (the reproducible focused retry failure). The native browser, transport, accessibility, T06, and T20 gates remain explicitly unverified rather than inferred as passed.
