# Runtime limitations

## Devspace

Attempted to open the repository workspace through Devspace. Connector response:

> We couldn't connect your account. Please try again.

No Devspace workspace id or runtime generation was available.

## Browser

The available system Chromium is managed with `URLBlocklist=["*"]`. Local HTTP and file navigation were blocked, so the exact static test pages could not be opened. Repeating the same browser launch would not be a materially different test hypothesis.

## Network

The isolated container could not resolve GitHub for a normal clone. Repository reads, writes, branch creation, commits, and PR creation used the connected GitHub tool. Local source copies were used only for syntax and diagnostic execution.

## Consequence

No browser-only or CDN claim is marked fully verified. Those gates are explicitly carried as pre-merge checks in `REPORT.md`.
