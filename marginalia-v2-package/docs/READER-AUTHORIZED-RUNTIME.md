# Reader-authorized runtime

This optional runtime permits real model asks with incomplete confinement evidence. It is off by default. The stock runtime still refuses dispatch. Requested restrictions are not proof of confinement.

Use a dedicated Codex installation and home. Sign in to that dedicated home yourself. Do not copy credentials from another home. Replace the example paths with existing absolute paths. The executable must be a real file and must end in `.exe` on Windows. The home must be a real directory, separate from both `~/.codex` and `CODEX_HOME`, with neither containing the other.

From the package directory in PowerShell:

```powershell
$env:MARGINALIA_CODEX_EXECUTABLE = 'D:\MarginaliaRuntime\codex.exe'
$env:MARGINALIA_CODEX_HOME = 'D:\MarginaliaRuntime\dedicated-home'
$env:MARGINALIA_AUTHORIZED_RUNTIME_MODULE = (Join-Path (Get-Location) 'daemon/reader-authorized-runtime.ts')
$env:MARGINALIA_READER_AUTHORIZED_UNCONFINED = 'I-UNDERSTAND'
npm start
```

Every ask still requires approval of the exact outgoing text and recipient. Current consent, dispatch authorization, attempt identity, policy fingerprint, workspace, home, model, mode, output schema, and model-turn checks stay enforced. Requested thread, turn, and configuration policies still apply. Unsupported catalog entries still veto the request. Recovery still requires its existing evidence checks.

The runtime collects real evidence. It logs rejected audit issue codes once per attempt to stderr, without page text or secrets. It allows audit evidence failures, including unresolved or contradictory observations. It never labels them as verified confinement. Diagnostics still say `external-runtime-not-verified-here`.

These seven gaps remain:

- `dedicated-credential-origin-not-attested`
- `inherited-environment-values-not-reviewed`
- `effective-instruction-and-capability-closure-not-observed`
- `model-reachable-read-confinement-not-observed`
- `filesystem-write-confinement-not-observed`
- `closed-tool-network-not-observed`
- `model-traffic-separation-not-observed`

To disable this mode, remove `MARGINALIA_AUTHORIZED_RUNTIME_MODULE` and `MARGINALIA_READER_AUTHORIZED_UNCONFINED`, then restart the helper.
