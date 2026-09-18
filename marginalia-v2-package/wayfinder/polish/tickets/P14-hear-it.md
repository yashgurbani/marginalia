# Hear it, local speech

status: closed
type: build
blocked by: Related saved passages in the margin

## Goal
The bottom zone promises "hear it". `ui/margin.ts:438` prints "Hear it · not available in this version." Add explicit local playback with the browser's built-in speech synthesis. Nothing leaves the machine.

## Owned paths
`ui/margin.ts` (footer only), one new `ui/hear-it.ts`, `ui/margin.css`, one new `tests/hear-it.test.ts`.

## Acceptance
- Hear it reads the current selection, or the page text from the reading position when nothing is selected. It starts only on an explicit press.
- A Stop control appears while speaking. Escape also stops. Status is announced through an accessible status region once per change.
- If the browser has no speech synthesis or no local voice, the control says so in one plain sentence.
- Only local voices are used (`voice.localService === true`). A test asserts a remote voice is never chosen.
- The source page is never modified.

## Report
`D:\Projects\Marginalia\.local\polish\reports\P14.md`

## Technical preflight
Narrow lifecycle wiring in ui/margin.ts is included with the footer: stop playback on collapse, suspend and destroy, so the reader retains an accessible stop path and hidden/disposed margins cannot continue. ui/hear-it.ts uses only explicit localService===true voices, rechecked per bounded chunk; asynchronous voice availability never starts playback. Browser localService is the admission claim, not an independently observed network-confinement result.

Chief preflight also includes tests/margin-entry.test.ts's obsolete Hear-it-unavailable copy assertion: replace it with the real unavailable-browser message and disabled/hidden controls, preserving existing no-request/Keep/Park assertions. Full gate exposed this single stale expectation at line270; failure log retained.

## Resolution
Closed2026-09-18. Explicit localService-only playback for selection/current reading position, bounded continuation, Stop/Escape and teardown fences. Independent7/7 review; chief stable1051/1045pass/0fail/6platformskip, root tsc0, extension typecheck0, build0. Report D:/Projects/Marginalia/.local/polish/reports/P14.md; receipt SHA256 949FD464DA0DBE4581244EAFA4EFBD5AD228FA19DD7C5CAD85DC4478B8EC8E40. Native audible/network and all live gates remain unverified.
