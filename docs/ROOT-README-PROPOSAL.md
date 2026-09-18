# Proposal: a new root README

This is a proposal, not a change. The root `README.md` is the maintainer's file
and currently holds uncommitted edits, so nothing here has been applied to it.
The repository is also the WebMCP Challenge submission surface and is under
judging, which is the second reason to propose rather than edit.

Apply it, take parts of it, or ignore it.

## Do not land before 2026-09-21 17:00 PT

The repository URL is part of the WebMCP Challenge submission, and rules §6
forbids altering the Submission after the deadline. Judging runs to
2026-09-21 17:00 PT.

## Defects in the pending edits, to fix before landing

Three link problems, whenever the landing happens.

**1. Two links in the pending edit resolve locally and 404 on GitHub.**
Line 9 links `docs/PROJECT-REVIEW-2026-09-06.md` and `docs/BUILD-PLAN.md`. Line
69 links `docs/BUILD-PLAN.md` again. Both files exist on disk and neither is
tracked: `git ls-files --error-unmatch` reports both as untracked. Fix by
`git add`-ing both files in the same commit that lands the README.

**2. The edit drops six links that do resolve.**
The committed README's "Next" section lists six `.scratch/bridge/issues/*.md`
tickets, all of them tracked and all of them resolving on GitHub today. The
pending edit replaces that list with prose. That is a reasonable editorial
choice — the edit itself says those tickets are no longer a reliable list of
unimplemented work — but it should be a deliberate drop, not an accident.

**3. `fixtures/ATTRIBUTION.md` is already broken on this branch.**
Line 65 links `fixtures/ATTRIBUTION.md`. On `codex/marginalia-v2` the v1
prototype has moved: the file is now `archive/v1-webmcp/fixtures/ATTRIBUTION.md`,
and there is no `fixtures/` directory at the repository root. For the same
reason, "use any static server from the repository root" and `npx serve .` no
longer start the v1 reader — the entry point is now
`archive/v1-webmcp/index.html`. This is not a defect the pending edit introduced,
but it lands with it.

## Proposed README body

```markdown
# Marginalia

Marginalia is a margin beside whatever you are reading. You select a passage or
write a note, and the answer appears next to it, anchored to the words that
prompted it. The page itself is never changed. Your reading stays on your
computer.

The repository holds two things: the hackathon prototype that was submitted, and
the reader that has been built since.

## The v1 WebMCP prototype

The WebMCP Challenge submission is a static page that registers WebMCP tools so a
human and their agent work on the same document: the page holds the source, the
marks and the notes, and the agent reads the live reading state rather than a
pasted excerpt. The page registers no tool that mutates the source layer, which
is enforced by the tools it does not register.

It now lives in [archive/v1-webmcp/](archive/v1-webmcp/). To run it, serve that
directory with any static server and open the URL it prints:

```sh
npx serve archive/v1-webmcp
```

No build step and no credentials are required. Fixture licenses and source
attribution are in
[archive/v1-webmcp/fixtures/ATTRIBUTION.md](archive/v1-webmcp/fixtures/ATTRIBUTION.md).

Everything in the submission was written between 25 August and 4 September 2026.
It is new work using WebMCP; no code was reused.

## The v2 reader

[marginalia-v2-package/](marginalia-v2-package/) is the reader the project became:
a local helper daemon that holds your reading, a Chrome MV3 extension that draws
the margin, and a local library page. Its
[README](marginalia-v2-package/README.md) covers installing the helper, loading
the extension and pairing them.

Privacy boundary: [marginalia-v2-package/docs/PRIVACY.md](marginalia-v2-package/docs/PRIVACY.md).

## What is not finished

v2 is an alpha, and these gates are open:

- No run against a real model provider has been recorded. Reply behaviour is
  proven on deterministic fixtures only.
- Web checks are unavailable. This build defines no network-capable policy.
- Solver confinement is requested but not yet observed.
- Native install is proven on Windows only. macOS and Linux have command-level CI
  evidence.
- The maintainer's own reading verdict on two real pages is pending.

[marginalia-v2-package/BUILD-STATUS.md](marginalia-v2-package/BUILD-STATUS.md)
and [marginalia-v2-package/docs/README.md](marginalia-v2-package/docs/README.md)
carry the detail.

## License

MIT. See [LICENSE](LICENSE).
```

## Two notes on the framing

**Keep the submitted-versus-since distinction while judging is open.** The
pending edit replaces "The submission defers the following work" with "The
project now continues beyond the hackathon". That is true and it is the better
sentence after judging closes. While judging is open, a reader needs to be able
to tell what was submitted from what came after, which is why the body above
splits v1 and v2 into separate sections rather than merging them.

**Add a screenshot after judging closes.** Rules §7 lets judges decide on text,
images and video alone, and the README currently has no image. A single
screenshot of the margin beside a real page is the highest-value addition once
editing is allowed again.

## Link check

Every link in the proposed body, checked for existence on disk and for git
tracking on `codex/marginalia-v2`:

| Link | On disk | Tracked |
|---|---|---|
| `archive/v1-webmcp/` | yes | yes |
| `archive/v1-webmcp/fixtures/ATTRIBUTION.md` | yes | yes |
| `marginalia-v2-package/` | yes | yes |
| `marginalia-v2-package/README.md` | yes | yes |
| `marginalia-v2-package/docs/PRIVACY.md` | yes | yes, once this branch lands |
| `marginalia-v2-package/BUILD-STATUS.md` | yes | yes |
| `marginalia-v2-package/docs/README.md` | yes | yes |
| `LICENSE` | yes | yes |

No link in the proposed body points at `docs/PROJECT-REVIEW-2026-09-06.md`,
`docs/BUILD-PLAN.md` or root `fixtures/`, because none of those is tracked here.
