# Reader-authorized runtime

The normal helper finds the installed native Codex executable on PATH and uses the reader's ordinary `~/.codex` home. No Marginalia environment variables or second sign-in are required. Windows npm installations are resolved to their native executable without executing shell shims. Discovery checks paths, never reads authentication files, and never adopts an inherited `CODEX_HOME` belonging to a coding agent.

The reader sees: **Marginalia uses your own Codex setup, including its settings and tools.** This includes configured tool servers, skills and instructions. Missing confinement evidence does not block a send. Availability means the runtime can try a request; it does not prove sign-in, provider compatibility or confinement.

The existing dedicated-home override remains the stricter option. Set both environment variables to existing absolute paths. On Windows the executable must be a native `.exe` file. This explicit home must be separate from the job workspace, `~/.codex` and any ambient `CODEX_HOME`. Partial or invalid explicit configuration fails instead of silently switching accounts. Sign in to that home yourself; Marginalia never copies credentials or starts sign-in.

```powershell
$env:MARGINALIA_CODEX_EXECUTABLE = 'D:\MarginaliaRuntime\codex.exe'
$env:MARGINALIA_CODEX_HOME = 'D:\MarginaliaRuntime\dedicated-home'
npm start
```

Missing or invalid executable or home paths make execution unavailable. Launch checks still verify executable identity, the supported version and a home separate from the workspace. The stock helper keeps the saved-solver transport configured. Saved-solver execution has its own authority and execution gates.

The old runtime-module and unconfined-acknowledgement environment switches have no effect. Production does not load a runtime module from the environment. Tests inject an `AuthorizedRuntimeFactory` through `startServer.runtimeFactoryBuilder`; fake transports can be passed to the stock factory through its host dependency argument.

For explicit asks, the reader still reviews the exact outgoing content and recipient. Current grants, site exclusions, denials, request bindings, cancellation and attempt checks remain enforced at send time. Dedicated mode retains its requested read-only definition policy and unsupported-catalog veto. Ordinary mode deliberately inherits the reader's setup; those inherited capabilities are not certified as confined.

Protection lost in ordinary mode: there is no separate account/configuration boundary. The reader's tools and skills can participate, and their settings determine their access. Protection kept: Marginalia does not read or copy credentials, changes no saved Codex settings, keeps job workspaces outside the Codex home, and still binds every deep-help send to the current approved request. Neither mode claims verified filesystem or network confinement.

Ordinary mode does not force file-based credential storage, approval settings, tool restrictions or a replacement instruction configuration. It inherits the helper's environment so configured tools and providers can use their normal integration variables, API credentials and proxy settings. The resolved ordinary home replaces any inherited CODEX_HOME, including differently cased keys. Dedicated mode retains its existing environment allowlist. Environment values are not printed. Interactive provider approval requests receive the transport's existing unsupported-request response; Marginalia does not approve them silently. A request that cannot finish remains subject to the existing job deadline (ten minutes by default), and the provider's stop is not claimed as confirmed.

The passive evidence source reports seven unverified observations:

- `dedicated-credential-origin-not-attested`
- `inherited-environment-values-not-reviewed`
- `effective-instruction-and-capability-closure-not-observed`
- `model-reachable-read-confinement-not-observed`
- `filesystem-write-confinement-not-observed`
- `closed-tool-network-not-observed`
- `model-traffic-separation-not-observed`

`GET /api/jobs` and all three preparation responses include `unverified: string[]` and `disclosureVersion: string | null`. Version `runtime-d2-v2` incorporates the selected identity and policy. Ordinary mode includes the plain setup disclosure above. A policy or configured identity change changes the version. A factory without disclosure metadata supplies an empty list and null version.

The send sheet should translate these identifiers into one plain line and remember the displayed version for this installation. This is a disclosure, with no second approval checkbox. The UI integration is tracked separately in the D2 report because another worker owns those files.

Diagnostics continue to report incomplete evidence. The policy gate logs rejected audit issue codes once per attempt without outgoing text. Reader-authorized mode permits unresolved and contradictory confinement observations; those observations remain unverified.

A completed thread held by the same live process can accept an explicitly approved follow-up without the recovery-evidence veto. It still verifies the recorded turn, current thread state and current dispatch authority. After a disconnect or restart, unknown state cannot cause a turn to be replayed. Recovery remains subject to its evidence checks.

New saved-solver bindings use the `manifest-v1:directory:<device>:<inode>` generation format. They require a present, bounded, unlinked manifest. Older `directory:<device>:<inode>` bindings can resolve without a manifest. Path, solver hash, interpreter hash, authority and execution checks still apply. Continuations preserve a pinned solver through separate workspace validation; permission to author another solver is intersected with the current host allowance.
