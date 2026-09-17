# 04-sidebar-rendering

label: wayfinder:prototype
mode: HITL
status: closed
blocked_by: 02-artifact-contract-v1

## Question

How the margin renders on an arbitrary page: iframe inside a shadow-DOM host in the content script vs chrome.sidePanel. Prototype both on two hostile pages (a dynamic SPA and arXiv HTML) and judge anchoring stability, layout intrusion, and whether the artifact iframe can be sandboxed as the contract requires.

## Resolution

Resolved (rev 2). Chrome side panel first (opened on a user gesture); injected floating panel and Firefox tested separately. The content script adds a namespaced shadow host and CSS Custom Highlight marks; it preserves source content and layout and never edits the page's own nodes ("never rewrite the source", not "literally untouched DOM"). Replies render as typed blocks by packaged code inside the panel; there is no generated-code path and no srcdoc iframe. Service worker treated as disposable.
