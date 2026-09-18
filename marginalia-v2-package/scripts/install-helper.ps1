# This installer only manages the local helper. It never sends content or changes Codex sign-in.
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Uninstall,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'Marginalia Local Helper'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$main = Join-Path $root 'daemon\main.ts'
$localData = [Environment]::GetFolderPath('LocalApplicationData')
if ([string]::IsNullOrWhiteSpace($localData)) { $localData = Join-Path $HOME '.marginalia' }
$dataDir = if ($env:MARGINALIA_DATA_DIR) { $env:MARGINALIA_DATA_DIR } else { Join-Path $localData 'Marginalia' }
if (-not [IO.Path]::IsPathRooted($dataDir)) { throw 'MARGINALIA_DATA_DIR must be absolute.' }
$log = Join-Path $dataDir 'helper.log'
$planOnly = $DryRun -or $WhatIfPreference

function Show-Finish {
  Write-Output 'Helper address: http://127.0.0.1:43120'
  Write-Output 'Open the extension options and pair with the code the helper shows.'
}

function Quote-PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

if ($Uninstall) {
  if ($planOnly) {
    Write-Output "[DRY RUN] Stop and remove per-user Scheduled Task '$taskName'; retain $dataDir."
  } else {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
      Write-Output "Removed Scheduled Task '$taskName'. Reader data remains in $dataDir."
    } else {
      Write-Output "Scheduled Task '$taskName' is not installed. Reader data remains in $dataDir."
    }
  }
  Show-Finish
  exit 0
}

$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCommand) { throw 'Node 24 is required and node was not found on PATH.' }
$node = $nodeCommand.Source
$version = (& $node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw "Node 24 is required; found $version." }
$npmCommand = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $npmCommand) { throw 'npm was not found on PATH.' }
$npm = $npmCommand.Source

if ($planOnly) {
  Write-Output "[DRY RUN] Node check passed: $version ($node)."
  Write-Output "[DRY RUN] Run npm ci in $root only if node_modules is missing."
  Write-Output "[DRY RUN] Run npm run build in $root."
  Write-Output "[DRY RUN] Create $dataDir for data and logs."
  Write-Output "[DRY RUN] Register per-user Scheduled Task '$taskName' at logon and start it now."
  Write-Output "[DRY RUN] Run node daemon/main.ts from $root with MARGINALIA_DATA_DIR=$dataDir."
  Show-Finish
  exit 0
}

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules') -PathType Container)) {
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
  }
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$shell = (Get-Process -Id $PID).Path
$command = "`$env:MARGINALIA_DATA_DIR = $(Quote-PowerShellLiteral $dataDir); & $(Quote-PowerShellLiteral $node) $(Quote-PowerShellLiteral $main) >> $(Quote-PowerShellLiteral $log) 2>&1"
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $command + '"'
$action = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $root
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts the Marginalia local helper at logon.'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started Scheduled Task '$taskName'. Helper output: $log"
Show-Finish
