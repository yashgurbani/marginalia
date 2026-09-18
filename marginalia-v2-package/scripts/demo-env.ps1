# A27a: isolated, recording-safe demo environment for Marginalia.
#
# The helper is supervised with stdout/stderr redaction because daemon/main.ts
# prints a six-digit pairing code during normal startup. The browser remains
# visible for recording; the helper supervisor remains hidden.
[CmdletBinding()]
param(
  [switch]$Start,
  [switch]$Reset,
  [switch]$Check,

  # Private entry point used by the hidden helper supervisor. It is not part of
  # the recording workflow and never prints the child's raw output.
  [switch]$HelperSupervisor,
  [string]$SupervisorNodePath,
  [string]$SupervisorRepoRoot,
  [string]$SupervisorDataDir,
  [string]$SupervisorPort,
  [string]$SupervisorLogPath,
  [string]$SupervisorPidPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = [IO.Path]::GetFullPath($PSCommandPath)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$demoRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.local\demo-env'))
$dataDir = [IO.Path]::GetFullPath((Join-Path $demoRoot 'data'))
$profileDir = [IO.Path]::GetFullPath((Join-Path $demoRoot 'chrome-profile'))
$logsDir = [IO.Path]::GetFullPath((Join-Path $demoRoot 'logs'))
$statePath = [IO.Path]::GetFullPath((Join-Path $demoRoot 'state.json'))
$helperPidPath = [IO.Path]::GetFullPath((Join-Path $demoRoot 'helper-child.json'))
$helperLogPath = [IO.Path]::GetFullPath((Join-Path $logsDir 'helper.log'))
$demoLogPath = [IO.Path]::GetFullPath((Join-Path $logsDir 'demo.log'))
$mainEntry = [IO.Path]::GetFullPath((Join-Path $repoRoot 'daemon\main.ts'))
$extensionBuild = [IO.Path]::GetFullPath((Join-Path $repoRoot 'extension\.output\chrome-mv3'))
$chromePath = 'D:\Projects\Marginalia-worktrees\chief-20260918-a4-browser\.scratch\a4-browser\chrome-for-testing-153.0.8010.52\chrome-win64\chrome.exe'
$navierUrl = 'https://openai.com/index/navier-stokes-solution/'
$nasaUrl = 'https://science.nasa.gov/earth/facts/'
$everydayHelperPort = 43120

function Normalize-PathValue([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw 'A required path was empty.' }
  $full = [IO.Path]::GetFullPath($Value)
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\', '/') }
  return $full
}

function Path-Equals([string]$Left, [string]$Right) {
  return [String]::Equals((Normalize-PathValue $Left), (Normalize-PathValue $Right), [StringComparison]::OrdinalIgnoreCase)
}

function Path-IsUnder([string]$Child, [string]$Parent) {
  $childPath = Normalize-PathValue $Child
  $parentPath = (Normalize-PathValue $Parent).TrimEnd('\', '/')
  return $childPath.StartsWith($parentPath + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparseAncestors([string]$Path, [string]$StopAt) {
  $current = Normalize-PathValue $Path
  $stop = Normalize-PathValue $StopAt
  if (-not (Path-Equals $current $stop) -and -not (Path-IsUnder $current $stop)) {
    throw 'The demo path is not contained by the repository root.'
  }
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'A demo path ancestor is a link or junction; refusing to use it.'
      }
    }
    if (Path-Equals $current $stop) { break }
    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or (Path-Equals $parent $current)) {
      throw 'Could not verify demo path containment.'
    }
    $current = Normalize-PathValue $parent
  }
}

function Assert-DemoChildDirectory([string]$Path, [string]$Name) {
  $expected = Normalize-PathValue (Join-Path $demoRoot $Name)
  $actual = Normalize-PathValue $Path
  if (-not (Path-Equals $actual $expected) -or -not (Path-IsUnder $actual $demoRoot)) {
    throw "Refusing to use an unexpected demo directory for $Name."
  }
  Assert-NoReparseAncestors $actual $repoRoot
  if (Test-Path -LiteralPath $actual) {
    $item = Get-Item -LiteralPath $actual -Force
    if (-not $item.PSIsContainer) { throw "The demo $Name path is not a directory." }
  }
  return $expected
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-JsonFile([string]$Path, $Value) {
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Write-Utf8NoBom $Path (($Value | ConvertTo-Json -Depth 30) + [Environment]::NewLine)
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
  catch { throw "The demo state file is not valid JSON; refusing to infer ownership." }
}

function Redact-LogLine([string]$Line) {
  if ($null -eq $Line) { return '' }
  $safe = $Line -replace '(?i)(pairing\s+code\s*[:=]\s*)\d{6}', '$1[REDACTED]'
  if ($safe -match '(?i)pairing|challenge') { $safe = $safe -replace '\b\d{6}\b', '[REDACTED]' }
  return $safe
}

function Write-DemoLog([string]$Line) {
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  $safe = Redact-LogLine $Line
  [IO.File]::AppendAllText($demoLogPath, $safe + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Assert-NoPairingCodeInLogs {
  if (-not (Test-Path -LiteralPath $logsDir -PathType Container)) { return }
  $leak = Get-ChildItem -LiteralPath $logsDir -Recurse -Force -File -ErrorAction SilentlyContinue |
    Select-String -Pattern '(?i)pairing\s+code\s*[:=]\s*\d{6}' -SimpleMatch:$false -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -ne $leak) { throw 'A demo log contains a pairing code; refusing to report the environment as ready.' }
}

function Get-FreeLoopbackPort {
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
      $listener.Start()
      $port = [int]$listener.LocalEndpoint.Port
    } finally {
      $listener.Stop()
    }
    if ($port -ne $everydayHelperPort) { return $port }
  }
  throw 'Could not reserve a demo port distinct from the everyday helper port.'
}

function Get-NodePath {
  $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $command) { throw 'Node 24 is required and was not found on PATH.' }
  $version = (& $command.Source --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') {
    throw "Node 24 is required for the released helper; found $version."
  }
  return (Normalize-PathValue $command.Source)
}

function Get-WindowsPowerShellPath {
  $command = Get-Command powershell.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $command) { throw 'Windows PowerShell is required to supervise the hidden helper.' }
  return (Normalize-PathValue $command.Source)
}

function Quote-StartProcessArgument([string]$Value) {
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Assert-ExtensionBuild {
  if (-not (Test-Path -LiteralPath $extensionBuild -PathType Container)) {
    throw 'The released extension build is missing. Build extension/.output/chrome-mv3 at the v1.1 commit before starting the demo.'
  }
  $manifestPath = Join-Path $extensionBuild 'manifest.json'
  $backgroundPath = Join-Path $extensionBuild 'background.js'
  $panelPath = Join-Path $extensionBuild 'panel.html'
  foreach ($path in @($manifestPath, $backgroundPath, $panelPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "The released extension build is incomplete ($([IO.Path]::GetFileName($path)))." }
  }
  try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json }
  catch { throw 'The released extension manifest is not valid JSON.' }
  if ([int]$manifest.manifest_version -ne 3 -or [string]$manifest.version -ne '1.1.0' -or [string]$manifest.background.service_worker -ne 'background.js') {
    throw 'The released extension manifest is not the v1.1.0 Chrome MV3 background build.'
  }
  return (Normalize-PathValue $extensionBuild)
}

function Get-ExpectedExtensionIdentity {
  $null = Assert-ExtensionBuild
  try { $manifest = Get-Content -LiteralPath (Join-Path $extensionBuild 'manifest.json') -Raw | ConvertFrom-Json }
  catch { throw 'The released extension manifest could not be read for runtime identity verification.' }
  $contentScript = @($manifest.content_scripts)[0]
  return [pscustomobject]@{
    manifestVersion = [int]$manifest.manifest_version
    name = [string]$manifest.name
    version = [string]$manifest.version
    serviceWorker = [string]$manifest.background.service_worker
    panelPath = [string]$manifest.side_panel.default_path
    contentScriptJs = @($contentScript.js | ForEach-Object { [string]$_ })
    contentScriptMatches = @($contentScript.matches | ForEach-Object { [string]$_ })
  }
}

function Get-ProcessSnapshot([int]$ProcessId) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  $cim = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId={0}" -f $ProcessId) -ErrorAction SilentlyContinue | Select-Object -First 1
  $path = ''
  $commandLine = ''
  if ($null -ne $cim) {
    $path = [string]$cim.ExecutablePath
    $commandLine = [string]$cim.CommandLine
  }
  if ([string]::IsNullOrWhiteSpace($path)) {
    try { $path = [string]$process.Path } catch { $path = '' }
  }
  $startTicks = 0L
  try { $startTicks = $process.StartTime.ToUniversalTime().Ticks } catch { }
  return [pscustomobject]@{
    Pid = $ProcessId
    StartTimeUtcTicks = [Int64]$startTicks
    Path = $path
    CommandLine = $commandLine
    Process = $process
  }
}

function Normalize-CommandLine([string]$Value) {
  return ($Value -replace '"', '').Replace('/', '\').ToLowerInvariant()
}

function New-ProcessRecord([int]$ProcessId, [string]$Kind, [string]$Executable, [string[]]$Markers) {
  $snapshot = Get-ProcessSnapshot $ProcessId
  if ($null -eq $snapshot -or $snapshot.StartTimeUtcTicks -eq 0) { throw "The $Kind process ended before its ownership record could be written." }
  $expectedPath = Normalize-PathValue $Executable
  if (-not [string]::IsNullOrWhiteSpace($snapshot.Path) -and -not (Path-Equals $snapshot.Path $expectedPath)) {
    throw "The $Kind process executable did not match the launched executable."
  }
  return [ordered]@{
    kind = $Kind
    pid = [int]$ProcessId
    startTimeUtcTicks = [Int64]$snapshot.StartTimeUtcTicks
    executable = $expectedPath
    markers = @($Markers)
  }
}

function Test-HelperMarker($Marker, [string]$ExpectedExecutable) {
  if ($null -eq $Marker -or $Marker.PSObject.Properties.Name -notcontains 'pid' -or
      $Marker.PSObject.Properties.Name -notcontains 'startTimeUtcTicks' -or
      $Marker.PSObject.Properties.Name -notcontains 'executable') { return $null }
  if ([int]$Marker.pid -le 0 -or [Int64]$Marker.startTimeUtcTicks -le 0) { return $null }
  $snapshot = Get-ProcessSnapshot ([int]$Marker.pid)
  if ($null -eq $snapshot -or [Int64]$snapshot.StartTimeUtcTicks -ne [Int64]$Marker.startTimeUtcTicks) { return $null }
  if ([string]::IsNullOrWhiteSpace($snapshot.Path) -or -not (Path-Equals $snapshot.Path ([string]$Marker.executable)) -or
      -not (Path-Equals $snapshot.Path $ExpectedExecutable)) { return $null }
  return $snapshot
}

function Test-RecordedProcess($Record) {
  if ($null -eq $Record) { return $null }
  $snapshot = Get-ProcessSnapshot ([int]$Record.pid)
  if ($null -eq $snapshot) { return $null }
  if ([Int64]$Record.startTimeUtcTicks -ne [Int64]$snapshot.StartTimeUtcTicks) {
    throw "The recorded $($Record.kind) PID now belongs to another process; refusing to stop it."
  }
  if ([string]::IsNullOrWhiteSpace($snapshot.Path) -or -not (Path-Equals $snapshot.Path ([string]$Record.executable))) {
    throw "The recorded $($Record.kind) executable no longer matches; refusing to stop it."
  }
  $commandLine = Normalize-CommandLine $snapshot.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    throw "The recorded $($Record.kind) command line could not be verified; refusing to stop it."
  }
  foreach ($marker in @($Record.markers)) {
    $needle = Normalize-CommandLine ([string]$marker)
    if ([string]::IsNullOrWhiteSpace($needle) -or -not $commandLine.Contains($needle)) {
      throw "The recorded $($Record.kind) command line no longer matches; refusing to stop it."
    }
  }
  return $snapshot
}

function Get-StateProcessRecords($State) {
  $records = [System.Collections.Generic.List[object]]::new()
  if ($null -eq $State) { return @() }
  if ($null -ne $State.helper) {
    if ($null -ne $State.helper.child) { $records.Add($State.helper.child) }
    if ($null -ne $State.helper.supervisor) { $records.Add($State.helper.supervisor) }
  }
  if ($null -ne $State.browser) {
    foreach ($record in @($State.browser.processes)) { if ($null -ne $record) { $records.Add($record) } }
  }
  return @($records | Group-Object -Property pid | ForEach-Object { $_.Group[0] })
}

function Stop-RecordedProcesses($State) {
  $records = @(Get-StateProcessRecords $State)
  $live = [System.Collections.Generic.List[object]]::new()
  foreach ($record in $records) {
    $snapshot = Test-RecordedProcess $record
    if ($null -ne $snapshot) { $live.Add([pscustomobject]@{ Record = $record; Snapshot = $snapshot }) }
  }

  $ordered = @(
    $live | Where-Object { $_.Record.kind -eq 'helper-child' }
    $live | Where-Object { $_.Record.kind -eq 'helper-supervisor' }
    $live | Where-Object { $_.Record.kind -eq 'browser' }
  )
  foreach ($entry in $ordered) {
    # Revalidate immediately before using the process handle. This avoids a
    # PID-reuse race between the initial ownership sweep and the stop.
    $validated = Test-RecordedProcess $entry.Record
    if ($null -eq $validated) { continue }
    Stop-Process -InputObject $validated.Process -Force -ErrorAction SilentlyContinue
    $remaining = $null
    $stopDeadline = (Get-Date).ToUniversalTime().AddSeconds(20)
    do {
      $remaining = Get-ProcessSnapshot ([int]$entry.Record.pid)
      if ($null -eq $remaining) { break }
      if (([Int64]$remaining.StartTimeUtcTicks -ne 0 -and [Int64]$remaining.StartTimeUtcTicks -ne [Int64]$validated.StartTimeUtcTicks) -or
          (-not [string]::IsNullOrWhiteSpace($remaining.Path) -and -not (Path-Equals $remaining.Path ([string]$entry.Record.executable)))) {
        throw "The owned $($entry.Record.kind) PID was reused while stopping; refusing to remove demo data."
      }
      Start-Sleep -Milliseconds 250
    } while ((Get-Date).ToUniversalTime() -lt $stopDeadline)
    if ($null -ne $remaining) {
      throw "The owned $($entry.Record.kind) process did not stop; refusing to remove demo data."
    }
  }
}

function Wait-PathGone([string]$Path) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "The demo path remained locked after its owned processes stopped: $Path"
}

function Get-HelperHealth([int]$Port) {
  try {
    $response = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/health" -f $Port) -Method Get -UseBasicParsing -TimeoutSec 3
    $body = $response.Content | ConvertFrom-Json
    return [pscustomobject]@{ statusCode = [int]$response.StatusCode; body = $body }
  } catch { return $null }
}

function Get-CdpVersion([int]$Port) {
  try { return (Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/version" -f $Port) -TimeoutSec 3) }
  catch { return $null }
}

function Get-CdpHttpTargets([int]$Port) {
  try { return @((Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 3)) }
  catch { return @() }
}

function Invoke-CdpRequest([string]$WebSocketUrl, [string]$Method, $Parameters) {
  if ([string]::IsNullOrWhiteSpace($WebSocketUrl)) { return $null }
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  try {
    [void]$socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $payload = [ordered]@{ id = 1; method = $Method }
    if ($null -ne $Parameters) { $payload.params = $Parameters }
    $requestBytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress -Depth 20))
    [void]$socket.SendAsync([ArraySegment[byte]]::new($requestBytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $buffer = New-Object byte[] 65536
    for ($messageAttempt = 0; $messageAttempt -lt 20; $messageAttempt++) {
      $builder = [Text.StringBuilder]::new()
      do {
        $receive = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        if ($receive.Count -gt 0) { [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $receive.Count)) }
      } while (-not $receive.EndOfMessage)
      $message = $builder.ToString() | ConvertFrom-Json
      if ($message.PSObject.Properties.Name -contains 'id' -and [int]$message.id -eq 1) { return $message }
    }
    return $null
  } catch { return $null }
  finally {
    try {
      if ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) {
        [void]$socket.CloseAsync([Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      }
    } catch { }
    $socket.Dispose()
  }
}

function Get-CdpBrowserTargets([string]$WebSocketUrl) {
  $message = Invoke-CdpRequest $WebSocketUrl 'Target.getTargets' $null
  if ($null -eq $message -or $message.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result -or
      $message.result.PSObject.Properties.Name -notcontains 'targetInfos' -or $null -eq $message.result.targetInfos) { return @() }
  return @($message.result.targetInfos)
}

function Test-ContentScriptMarker($Target) {
  if ($null -eq $Target -or [string]::IsNullOrWhiteSpace([string]$Target.webSocketDebuggerUrl)) { return $false }
  $expression = "Array.from(document.querySelectorAll('style')).some(function(style) { return typeof style.textContent === 'string' && style.textContent.indexOf('::highlight(marginalia-selection)') >= 0; })"
  $message = Invoke-CdpRequest ([string]$Target.webSocketDebuggerUrl) 'Runtime.evaluate' ([ordered]@{ expression = $expression; returnByValue = $true })
  try {
    if ($null -eq $message -or $message.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result) { return $false }
    if ($message.result.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result.result) { return $false }
    return [bool]$message.result.result.value
  } catch { return $false }
}

function Test-RuntimeExtensionIdentity($Runtime, [string]$ExpectedId, $ExpectedBuild) {
  try {
    if ($null -eq $Runtime -or $Runtime.PSObject.Properties.Name -notcontains 'id' -or
        $Runtime.PSObject.Properties.Name -notcontains 'manifest' -or $null -eq $Runtime.manifest) { return $null }
    $id = [string]$Runtime.id
    $manifest = $Runtime.manifest
    if ([string]::IsNullOrWhiteSpace($id) -or (-not [string]::IsNullOrWhiteSpace($ExpectedId) -and $id -ne $ExpectedId)) { return $null }
    if ($manifest.PSObject.Properties.Name -notcontains 'manifest_version' -or
        $manifest.PSObject.Properties.Name -notcontains 'name' -or
        $manifest.PSObject.Properties.Name -notcontains 'version' -or
        $manifest.PSObject.Properties.Name -notcontains 'background' -or
        $manifest.PSObject.Properties.Name -notcontains 'side_panel' -or
        $manifest.PSObject.Properties.Name -notcontains 'content_scripts') { return $null }
    if ([int]$manifest.manifest_version -ne [int]$ExpectedBuild.manifestVersion -or
        [string]$manifest.name -ne [string]$ExpectedBuild.name -or
        [string]$manifest.version -ne [string]$ExpectedBuild.version -or
        [string]$manifest.background.service_worker -ne [string]$ExpectedBuild.serviceWorker -or
        [string]$manifest.side_panel.default_path -ne [string]$ExpectedBuild.panelPath) { return $null }
    $contentScripts = @($manifest.content_scripts)
    if ($contentScripts.Count -ne 1) { return $null }
    $runtimeScript = $contentScripts[0]
    $runtimeJs = @($runtimeScript.js | ForEach-Object { [string]$_ })
    $runtimeMatches = @($runtimeScript.matches | ForEach-Object { [string]$_ })
    if (@($ExpectedBuild.contentScriptJs | Where-Object { $_ -notin $runtimeJs }).Count -ne 0 -or
        @($ExpectedBuild.contentScriptMatches | Where-Object { $_ -notin $runtimeMatches }).Count -ne 0) { return $null }
    return [pscustomobject]@{ id = $id; manifest = $manifest }
  } catch { return $null }
}

function Get-ExtensionRuntimeIdentity($Target, [string]$ExpectedId, $ExpectedBuild) {
  if ($null -eq $Target -or [string]::IsNullOrWhiteSpace([string]$Target.webSocketDebuggerUrl)) { return $null }
  $expression = '({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest() })'
  $message = Invoke-CdpRequest ([string]$Target.webSocketDebuggerUrl) 'Runtime.evaluate' ([ordered]@{ expression = $expression; returnByValue = $true })
  try {
    if ($null -eq $message -or $message.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result -or
        $message.result.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result.result -or
        $message.result.result.PSObject.Properties.Name -notcontains 'value' -or $null -eq $message.result.result.value) { return $null }
    return (Test-RuntimeExtensionIdentity $message.result.result.value $ExpectedId $ExpectedBuild)
  } catch { return $null }
}

function Invoke-ExtensionResourceProbe([int]$DebugPort, [string]$BrowserWebSocketUrl, [string]$ExpectedId, $ExpectedBuild) {
  if ([string]::IsNullOrWhiteSpace($BrowserWebSocketUrl) -or [string]::IsNullOrWhiteSpace($ExpectedId)) { return $null }
  $targetId = ''
  try {
    $created = Invoke-CdpRequest $BrowserWebSocketUrl 'Target.createTarget' ([ordered]@{
        url = ('chrome-extension://{0}/{1}' -f $ExpectedId, $ExpectedBuild.panelPath)
        background = $true
        newWindow = $false
      })
    if ($null -eq $created -or $created.PSObject.Properties.Name -notcontains 'result' -or $null -eq $created.result -or
        $created.result.PSObject.Properties.Name -notcontains 'targetId') { return $null }
    $targetId = [string]$created.result.targetId
    if ([string]::IsNullOrWhiteSpace($targetId)) { return $null }
    $deadline = (Get-Date).ToUniversalTime().AddSeconds(8)
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
      $target = @(Get-CdpHttpTargets $DebugPort | Where-Object { [string]$_.id -eq $targetId -and -not [string]::IsNullOrWhiteSpace([string]$_.webSocketDebuggerUrl) }) | Select-Object -First 1
      if ($null -ne $target) {
        $runtime = Get-ExtensionRuntimeIdentity $target $ExpectedId $ExpectedBuild
        if ($null -ne $runtime) { return [pscustomobject]@{ id = $runtime.id; evidence = 'extension-resource-runtime'; target = $target; page = $null; runtime = $runtime } }
      }
      Start-Sleep -Milliseconds 150
    }
    return $null
  } finally {
    if (-not [string]::IsNullOrWhiteSpace($targetId)) { [void](Invoke-CdpRequest $BrowserWebSocketUrl 'Target.closeTarget' ([ordered]@{ targetId = $targetId })) }
  }
}

function Get-LoadedExtension([int]$DebugPort, [string]$ExpectedId = '', $ExpectedBuild) {
  $targets = @(Get-CdpHttpTargets $DebugPort)
  $version = Get-CdpVersion $DebugPort
  $allTargets = @($targets)
  if ($null -ne $version -and -not [string]::IsNullOrWhiteSpace([string]$version.webSocketDebuggerUrl)) {
    $allTargets += @(Get-CdpBrowserTargets ([string]$version.webSocketDebuggerUrl))
  }
  $workers = @($allTargets | Where-Object {
      ($_.PSObject.Properties.Name -contains 'type') -and ($_.PSObject.Properties.Name -contains 'url') -and
      ([string]$_.type -eq 'service_worker' -or [string]$_.type -eq 'background_page') -and
      ([string]$_.url -match '^chrome-extension://[^/]+/background\.js(?:\?|$)')
    })
  # MV3 workers go idle. A live content-script marker in the actual public tab
  # proves injection by the released build even after that worker is suspended.
  $pageTargets = @($allTargets | Where-Object {
      ($_.PSObject.Properties.Name -contains 'type') -and ($_.PSObject.Properties.Name -contains 'url') -and
      ($_.PSObject.Properties.Name -contains 'webSocketDebuggerUrl') -and
      [string]$_.type -eq 'page' -and [string]$_.url -match '^https?://'
    })
  $markerPage = $null
  foreach ($page in $pageTargets) {
    if (Test-ContentScriptMarker $page) { $markerPage = $page; break }
  }
  foreach ($worker in $workers) {
    $match = [regex]::Match([string]$worker.url, '^chrome-extension://([^/]+)/')
    if (-not $match.Success) { continue }
    $id = $match.Groups[1].Value
    if (-not [string]::IsNullOrWhiteSpace($ExpectedId) -and $id -ne $ExpectedId) { continue }
    $runtime = Get-ExtensionRuntimeIdentity $worker $ExpectedId $ExpectedBuild
    if ($null -eq $runtime) { continue }
    if ($null -ne $markerPage) {
      return [pscustomobject]@{ id = $runtime.id; evidence = 'service-worker-and-content-script'; target = $worker; page = $markerPage; runtime = $runtime }
    }
    return [pscustomobject]@{ id = $runtime.id; evidence = 'service-worker-runtime'; target = $worker; page = $null; runtime = $runtime }
  }
  if ($workers.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($ExpectedId) -and $null -ne $version) {
    # A stale content-script style is not proof of a loaded extension. Wake a
    # fresh extension-owned resource and verify its runtime ID and manifest.
    $resource = Invoke-ExtensionResourceProbe $DebugPort ([string]$version.webSocketDebuggerUrl) $ExpectedId $ExpectedBuild
    if ($null -ne $resource) {
      return [pscustomobject]@{ id = $resource.id; evidence = $resource.evidence; target = $resource.target; page = $markerPage; runtime = $resource.runtime }
    }
  }
  return $null
}

function Test-BrowserPage([string]$Url, [int]$DebugPort) {
  foreach ($target in @(Get-CdpHttpTargets $DebugPort)) {
    if ([string]$target.type -ne 'page' -or [string]$target.url -ne $Url -or
        [string]::IsNullOrWhiteSpace([string]$target.webSocketDebuggerUrl)) { continue }
    $expression = "({ readyState: document.readyState, title: document.title, textLength: document.body ? document.body.innerText.length : 0 })"
    $message = Invoke-CdpRequest ([string]$target.webSocketDebuggerUrl) 'Runtime.evaluate' ([ordered]@{ expression = $expression; returnByValue = $true })
    try {
      if ($null -eq $message -or $message.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result -or
          $message.result.PSObject.Properties.Name -notcontains 'result' -or $null -eq $message.result.result -or
          $message.result.result.PSObject.Properties.Name -notcontains 'value' -or $null -eq $message.result.result.value) { continue }
      $value = $message.result.result.value
      if ([string]$value.readyState -in @('interactive', 'complete') -and [int]$value.textLength -gt 0) {
        return [pscustomobject]@{ url = $Url; status = 'browser-dom-ready'; reachable = $true; title = [string]$value.title }
      }
    } catch { }
  }
  return $null
}

function Test-PublicPage([string]$Url, [int]$DebugPort) {
  $browserEvidence = Test-BrowserPage $Url $DebugPort
  if ($null -ne $browserEvidence) { return $browserEvidence }
  $lastStatus = 0
  foreach ($method in @('HEAD', 'GET')) {
    $request = $null
    $response = $null
    try {
      $request = [System.Net.HttpWebRequest]::Create($Url)
      $request.Method = $method
      $request.AllowAutoRedirect = $true
      $request.Timeout = 20000
      $request.ReadWriteTimeout = 20000
      $request.UserAgent = 'Marginalia demo health check'
      $response = [System.Net.HttpWebResponse]$request.GetResponse()
      $lastStatus = [int]$response.StatusCode
    } catch [System.Net.WebException] {
      if ($null -ne $_.Exception.Response) {
        try { $lastStatus = [int]$_.Exception.Response.StatusCode } catch { $lastStatus = 0 }
      }
    } catch {
      $lastStatus = 0
    } finally {
      if ($null -ne $response) { $response.Close() }
      if ($null -ne $request) { $request.Abort() }
    }
    if ($lastStatus -ge 200 -and $lastStatus -lt 400) { break }
    if ($lastStatus -notin @(403, 405, 501)) { break }
  }
  return [pscustomobject]@{ url = $Url; status = $lastStatus; reachable = ($lastStatus -ge 200 -and $lastStatus -lt 400); title = '' }
}

function Invoke-HelperSupervisor {
  $writer = $null
  $safeWriter = $null
  $child = $null
  $writeData = $null
  try {
    foreach ($value in @($SupervisorNodePath, $SupervisorRepoRoot, $SupervisorDataDir, $SupervisorPort, $SupervisorLogPath, $SupervisorPidPath)) {
      if ([string]::IsNullOrWhiteSpace($value)) { throw 'The helper supervisor received incomplete launch data.' }
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $SupervisorLogPath) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $SupervisorPidPath) -Force | Out-Null

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = Normalize-PathValue $SupervisorNodePath
    $startInfo.WorkingDirectory = Normalize-PathValue $SupervisorRepoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $entryPoint = Normalize-PathValue (Join-Path $SupervisorRepoRoot 'daemon\main.ts')
    # Windows PowerShell 5.1 has EnvironmentVariables but not ArgumentList.
    $startInfo.Arguments = '"' + $entryPoint.Replace('"', '\"') + '"'
    $environment = $startInfo.EnvironmentVariables
    $environment['MARGINALIA_DATA_DIR'] = Normalize-PathValue $SupervisorDataDir
    $environment['MARGINALIA_PORT'] = [string]$SupervisorPort
    foreach ($key in @('MARGINALIA_AUTHORIZED_RUNTIME_MODULE', 'MARGINALIA_READER_AUTHORIZED_UNCONFINED', 'MARGINALIA_CODEX_EXECUTABLE', 'MARGINALIA_CODEX_HOME')) {
      [void]$environment.Remove($key)
    }

    $writer = [IO.StreamWriter]::new($SupervisorLogPath, $true, [Text.UTF8Encoding]::new($false))
    $writer.AutoFlush = $true
    $safeWriter = [IO.TextWriter]::Synchronized($writer)
    $writeData = [Diagnostics.DataReceivedEventHandler]{
      param($sender, $eventArgs)
      if ($null -ne $eventArgs.Data) {
        $line = $eventArgs.Data -replace '(?i)(pairing\s+code\s*[:=]\s*)\d{6}', '$1[REDACTED]'
        if ($line -match '(?i)pairing|challenge') { $line = $line -replace '\b\d{6}\b', '[REDACTED]' }
        $safeWriter.WriteLine($line)
      }
    }
    $child = [Diagnostics.Process]::new()
    $child.StartInfo = $startInfo
    $child.add_OutputDataReceived($writeData)
    $child.add_ErrorDataReceived($writeData)
    if (-not $child.Start()) { throw 'The helper process could not be started.' }
    $child.BeginOutputReadLine(); $child.BeginErrorReadLine()
    $childSnapshot = Get-ProcessSnapshot $child.Id
    if ($null -eq $childSnapshot -or $childSnapshot.StartTimeUtcTicks -eq 0) { throw 'The helper process ended before supervision began.' }
    Write-JsonFile $SupervisorPidPath ([ordered]@{ pid = [int]$child.Id; startTimeUtcTicks = [Int64]$childSnapshot.StartTimeUtcTicks; executable = (Normalize-PathValue $SupervisorNodePath) })
    $safeWriter.WriteLine('A27a helper supervisor started. Raw helper output is not retained.')
    $child.WaitForExit()
    $child.WaitForExit()
    $safeWriter.WriteLine(('Helper process exited with code {0}.' -f $child.ExitCode))
  } catch {
    try {
      $message = Redact-LogLine ([string]$_.Exception.Message)
      if ($null -ne $safeWriter) {
        $safeWriter.WriteLine('Helper supervisor error: ' + $message)
        $safeWriter.Flush()
      } else {
        [IO.File]::AppendAllText($SupervisorLogPath, ('Helper supervisor error: ' + $message + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
      }
    } catch { }
    exit 1
  } finally {
    if ($null -ne $child) {
      try { $child.remove_OutputDataReceived($writeData) } catch { }
      try { $child.remove_ErrorDataReceived($writeData) } catch { }
      $child.Dispose()
    }
    if ($null -ne $writer) { $writer.Dispose() }
  }
}

function Invoke-Start {
  $existing = Read-JsonFile $statePath
  if ($null -ne $existing -and [string]$existing.status -in @('starting', 'active')) {
    throw 'The demo environment has an ownership record for a running start. Run -Reset before starting again.'
  }
  foreach ($path in @($dataDir, $profileDir)) {
    if (Test-Path -LiteralPath $path) { throw 'Demo data or profile already exists. Run -Reset before starting; no existing state was removed.' }
  }
  $null = Assert-DemoChildDirectory $dataDir 'data'
  $null = Assert-DemoChildDirectory $profileDir 'chrome-profile'
  $node = Get-NodePath
  $extensionIdentity = Get-ExpectedExtensionIdentity
  if (-not (Test-Path -LiteralPath $chromePath -PathType Leaf)) { throw 'The A4 Chrome for Testing executable is missing from the approved path.' }
  New-Item -ItemType Directory -Path $demoRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

  $helperPort = Get-FreeLoopbackPort
  do { $debugPort = Get-FreeLoopbackPort } while ($debugPort -eq $helperPort)
  # Reset preserves this metadata file, so overwrite any old PID before a
  # fresh supervisor can publish its newly started child identity.
  Write-JsonFile $helperPidPath ([ordered]@{ status = 'pending'; ownerStartAtUtc = (Get-Date).ToUniversalTime().ToString('o') })
  $state = [ordered]@{
    version = 1
    status = 'starting'
    repoRoot = (Normalize-PathValue $repoRoot)
    dataDir = (Normalize-PathValue $dataDir)
    profileDir = (Normalize-PathValue $profileDir)
    extensionBuild = (Normalize-PathValue $extensionBuild)
    chromePath = (Normalize-PathValue $chromePath)
    helperPort = [int]$helperPort
    debugPort = [int]$debugPort
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    helper = [ordered]@{ child = $null; supervisor = $null }
    browser = [ordered]@{ root = $null; processes = @() }
  }
  Write-JsonFile $statePath $state

  try {
    $powershell = Get-WindowsPowerShellPath
    $supervisorArgs = @(
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', (Quote-StartProcessArgument $scriptPath),
      '-HelperSupervisor', '-SupervisorNodePath', (Quote-StartProcessArgument $node), '-SupervisorRepoRoot', (Quote-StartProcessArgument $repoRoot),
      '-SupervisorDataDir', (Quote-StartProcessArgument $dataDir), '-SupervisorPort', ([string]$helperPort),
      '-SupervisorLogPath', (Quote-StartProcessArgument $helperLogPath), '-SupervisorPidPath', (Quote-StartProcessArgument $helperPidPath)
    )
    $supervisor = Start-Process -FilePath $powershell -ArgumentList $supervisorArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    $state.helper.supervisor = New-ProcessRecord $supervisor.Id 'helper-supervisor' $powershell @($scriptPath, '-HelperSupervisor')
    Write-JsonFile $statePath $state
    Write-DemoLog ('Started hidden helper supervisor for port {0}.' -f $helperPort)

    $deadline = (Get-Date).ToUniversalTime().AddSeconds(20)
    $marker = $null
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
      if (Test-Path -LiteralPath $helperPidPath -PathType Leaf) {
        try {
          $candidate = Read-JsonFile $helperPidPath
          if ($null -ne (Test-HelperMarker $candidate $node)) { $marker = $candidate }
        } catch { $marker = $null }
        if ($null -ne $marker) { break }
      }
      if ($null -eq (Get-Process -Id ([int]$supervisor.Id) -ErrorAction SilentlyContinue)) { throw 'The hidden helper supervisor exited before the helper became ready.' }
      Start-Sleep -Milliseconds 100
    }
    if ($null -eq $marker) { throw 'The helper did not publish a fresh owned process identity in time.' }
    $state.helper.child = New-ProcessRecord ([int]$marker.pid) 'helper-child' $node @($mainEntry)
    Write-JsonFile $statePath $state

    $health = $null
    $deadline = (Get-Date).ToUniversalTime().AddSeconds(20)
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
      $health = Get-HelperHealth $helperPort
      if ($null -ne $health -and $health.statusCode -eq 200 -and [string]$health.body.status -eq 'ready' -and [string]$health.body.storage -eq 'ready') { break }
      if ($null -eq (Get-Process -Id ([int]$marker.pid) -ErrorAction SilentlyContinue)) { throw 'The helper exited before its health endpoint became ready.' }
      Start-Sleep -Milliseconds 150
    }
    if ($null -eq $health -or $health.statusCode -ne 200 -or [string]$health.body.status -ne 'ready' -or [string]$health.body.storage -ne 'ready') {
      throw 'The demo helper did not report ready storage on its recorded port.'
    }

    $chromeArgs = @(
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking',
      '--disable-features=Translate,OptimizationHints,MediaRouter', '--hide-crash-restore-bubble',
      '--window-size=1920,1080', '--force-device-scale-factor=1', '--new-window',
      ('--user-data-dir={0}' -f $profileDir), ('--load-extension={0}' -f $extensionBuild),
      ('--disable-extensions-except={0}' -f $extensionBuild), '--remote-debugging-address=127.0.0.1',
      ('--remote-debugging-port={0}' -f $debugPort), $navierUrl
    )
    # Deliberately omit -WindowStyle Hidden: Chrome is the visible recording surface.
    $chrome = Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -WorkingDirectory (Split-Path -Parent $chromePath) -PassThru
    $browserMarker = '--user-data-dir=' + $profileDir
    $state.browser.root = New-ProcessRecord $chrome.Id 'browser' $chromePath @($browserMarker, ('--remote-debugging-port={0}' -f $debugPort))
    $state.browser.processes = @($state.browser.root)
    Write-JsonFile $statePath $state
    Write-DemoLog ('Started visible CfT browser for port {0}.' -f $debugPort)

    $version = $null
    $deadline = (Get-Date).ToUniversalTime().AddSeconds(25)
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
      $version = Get-CdpVersion $debugPort
      if ($null -ne $version) { break }
      if ($null -eq (Get-Process -Id ([int]$chrome.Id) -ErrorAction SilentlyContinue)) { throw 'The visible Chrome process exited before DevTools became ready.' }
      Start-Sleep -Milliseconds 200
    }
    if ($null -eq $version) { throw 'The visible Chrome process did not expose its recorded DevTools endpoint.' }

    $loaded = $null
    $deadline = (Get-Date).ToUniversalTime().AddSeconds(20)
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
      $loaded = Get-LoadedExtension $debugPort '' $extensionIdentity
      if ($null -ne $loaded) { break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $loaded) { throw 'Chrome started, but the released Marginalia background service worker was not observed.' }

    # Record only Chrome processes whose command line carries this exact fresh profile.
    $browserRecords = [System.Collections.Generic.List[object]]::new()
    $browserRecords.Add($state.browser.root)
    $chromeProcesses = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      [string]$_.ExecutablePath -and (Path-Equals ([string]$_.ExecutablePath) $chromePath) -and
      (Normalize-CommandLine ([string]$_.CommandLine)).Contains((Normalize-CommandLine $browserMarker))
    }
    foreach ($chromeProcess in @($chromeProcesses)) {
      if ([int]$chromeProcess.ProcessId -eq [int]$chrome.Id) { continue }
      try {
        $browserRecords.Add((New-ProcessRecord ([int]$chromeProcess.ProcessId) 'browser' $chromePath @($browserMarker)))
      } catch { }
    }
    $state.browser.processes = @($browserRecords | Group-Object -Property pid | ForEach-Object { $_.Group[0] })
    $state.status = 'active'
    $state.extensionId = [string]$loaded.id
    $state.extensionIdentity = [ordered]@{
      manifestVersion = [int]$extensionIdentity.manifestVersion
      name = [string]$extensionIdentity.name
      version = [string]$extensionIdentity.version
      serviceWorker = [string]$extensionIdentity.serviceWorker
      panelPath = [string]$extensionIdentity.panelPath
    }
    Write-JsonFile $statePath $state
    Assert-NoPairingCodeInLogs
    Write-DemoLog ('Demo environment ready; loaded extension id {0}.' -f $loaded.id)
    Write-Output ('Demo environment started on a private helper port ({0}).' -f $helperPort)
    Write-Output ('CfT is visible at 1920x1080 with the released Marginalia extension loaded ({0}; evidence: {1}).' -f $loaded.id, $loaded.evidence)
    Write-Output 'Pairing is manual and off camera; the pairing code is never printed or written to logs.'
    Write-Output 'Run -Check for a non-destructive health check or -Reset to stop only this recorded demo.'
  } catch {
    try {
      if ($null -ne $state.helper.child -and $null -eq (Get-Process -Id ([int]$state.helper.child.pid) -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $helperPidPath)) { }
      if ($null -eq $state.helper.child -and (Test-Path -LiteralPath $helperPidPath -PathType Leaf)) {
        $failedMarker = Read-JsonFile $helperPidPath
        if ($null -ne (Test-HelperMarker $failedMarker $node)) {
          $state.helper.child = New-ProcessRecord ([int]$failedMarker.pid) 'helper-child' $node @($mainEntry)
        }
      }
      $state.status = 'failed'
      Write-JsonFile $statePath $state
      Stop-RecordedProcesses $state
    } catch { Write-DemoLog ('Start cleanup was incomplete: ' + (Redact-LogLine ([string]$_.Exception.Message))) }
    throw
  }
}

function Invoke-Check {
  $state = Read-JsonFile $statePath
  if ($null -eq $state -or [string]$state.status -ne 'active') { throw 'The demo environment has no active ownership record. Run -Start first.' }
  if (-not (Path-Equals ([string]$state.dataDir) $dataDir) -or -not (Path-Equals ([string]$state.profileDir) $profileDir) -or
      -not (Path-Equals ([string]$state.extensionBuild) $extensionBuild) -or -not (Path-Equals ([string]$state.chromePath) $chromePath)) {
    throw 'The demo ownership record points outside this repository or at a different build; refusing to check it.'
  }
  $extensionIdentity = Get-ExpectedExtensionIdentity
  $helper = Test-RecordedProcess $state.helper.child
  # The helper itself is the health authority. A terminal or job host may
  # reap the detached supervisor after launch; that does not make a healthy,
  # owned helper lie about its state, and Reset still verifies/stops both when
  # the supervisor identity remains alive.
  if ($null -eq $helper) { throw 'The recorded demo helper process is not running.' }
  $health = Get-HelperHealth ([int]$state.helperPort)
  if ($null -eq $health -or $health.statusCode -ne 200 -or [string]$health.body.status -ne 'ready' -or [string]$health.body.storage -ne 'ready') {
    throw 'The recorded helper did not report ready storage on its own port.'
  }
  $browser = Test-RecordedProcess $state.browser.root
  if ($null -eq $browser) { throw 'The recorded visible Chrome process is not running.' }
  $loaded = Get-LoadedExtension ([int]$state.debugPort) ([string]$state.extensionId) $extensionIdentity
  if ($null -eq $loaded) { throw 'Chrome is reachable, but the released Marginalia extension identity/content script was not observed.' }
  $pages = @((Test-PublicPage $navierUrl ([int]$state.debugPort)), (Test-PublicPage $nasaUrl ([int]$state.debugPort)))
  Assert-NoPairingCodeInLogs
  Write-Output ('Helper health: PASS (port {0}, storage ready).' -f $state.helperPort)
  Write-Output ('Extension runtime: PASS ({0}; evidence: {1}).' -f $loaded.id, $loaded.evidence)
  foreach ($page in $pages) {
    $label = if ($page.url -eq $navierUrl) { 'Navier-Stokes page' } else { 'NASA Earth facts page' }
    if (-not $page.reachable) { throw "$label was not reachable from the demo check." }
    if ([string]$page.status -eq 'browser-dom-ready') {
      Write-Output ('{0}: PASS (browser DOM ready; title: {1}).' -f $label, $page.title)
    } else {
      Write-Output ('{0}: PASS (HTTP {1}).' -f $label, $page.status)
    }
  }
  Write-Output 'Demo check: PASS. No provider request was started by this check.'
}

function Invoke-Reset {
  $state = Read-JsonFile $statePath
  $null = Assert-DemoChildDirectory $dataDir 'data'
  $null = Assert-DemoChildDirectory $profileDir 'chrome-profile'
  $hasData = Test-Path -LiteralPath $dataDir
  $hasProfile = Test-Path -LiteralPath $profileDir
  if ($null -eq $state) {
    if ($hasData -or $hasProfile) { throw 'No ownership record exists; refusing to delete demo data or profile.' }
    Write-Output 'Demo reset: nothing owned is present.'
    return
  }
  if (-not (Path-Equals ([string]$state.dataDir) $dataDir) -or -not (Path-Equals ([string]$state.profileDir) $profileDir)) {
    throw 'The demo ownership record does not resolve to the two approved reset directories.'
  }
  if ([string]$state.status -ne 'reset') { Stop-RecordedProcesses $state }
  foreach ($targetInfo in @([pscustomobject]@{ path = $dataDir; name = 'data' }, [pscustomobject]@{ path = $profileDir; name = 'chrome-profile' })) {
    $target = [string]$targetInfo.path
    $null = Assert-DemoChildDirectory $target ([string]$targetInfo.name)
    if (Test-Path -LiteralPath $target) {
      $item = Get-Item -LiteralPath $target -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing to remove a linked demo directory.' }
      Remove-Item -LiteralPath $target -Recurse -Force
      Wait-PathGone $target
    }
  }
  $state.status = 'reset'
  $resetAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  if ($state.PSObject.Properties.Name -contains 'resetAtUtc') { $state.resetAtUtc = $resetAtUtc }
  else { $state | Add-Member -NotePropertyName resetAtUtc -NotePropertyValue $resetAtUtc }
  Write-JsonFile $statePath $state
  Write-DemoLog 'Demo reset completed; only the recorded helper/browser identities and the approved data/profile directories were touched.'
  Assert-NoPairingCodeInLogs
  Write-Output 'Demo reset: PASS. Owned helper/browser identities stopped; only data and chrome-profile were removed. Logs and other folders were preserved.'
}

if ($HelperSupervisor) {
  Invoke-HelperSupervisor
  exit 0
}

$actionCount = @($Start.IsPresent, $Reset.IsPresent, $Check.IsPresent | Where-Object { $_ }).Count
if ($actionCount -ne 1) { throw 'Choose exactly one action: -Start, -Reset, or -Check.' }
if ($Start) { Invoke-Start }
elseif ($Reset) { Invoke-Reset }
else { Invoke-Check }
