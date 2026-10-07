# Quiet keep-alive: if the board dies, bring it back.
$ErrorActionPreference = "Continue"
$mutexName = "Global\ForeverLANWatchdog"
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created) {
  # Another watchdog already running
  exit 0
}
$ensure = Join-Path $PSScriptRoot "ensure-stack.ps1"
try {
  while ($true) {
    Start-Sleep -Seconds 40
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:8765/health" -UseBasicParsing -TimeoutSec 4
      $j = $r.Content | ConvertFrom-Json
      if (-not $j.ok) { throw "not ok" }
      $nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'collector[/\\]index\.js' })
      if ($nodes.Count -lt 1) { throw "collector missing" }
    } catch {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $ensure | Out-Null
    }
  }
} finally {
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}
