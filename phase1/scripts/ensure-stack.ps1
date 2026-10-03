# Ensure Forever LAN host + collector are healthy. Restarts if wedged.
$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Get-ForeverNodes {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'host[/\\]server\.js|collector[/\\]index\.js' }
}

function Get-PortOwner {
  $lines = netstat -ano | Select-String ':8765\s+.+\s+LISTENING'
  foreach ($line in $lines) {
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
    $owner = $parts[-1]
    if ($owner -match '^\d+$') { return [int]$owner }
  }
  return $null
}

function Test-HostHealth {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8765/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ne 200) { return $false }
    $j = $r.Content | ConvertFrom-Json
    return [bool]$j.ok
  } catch {
    return $false
  }
}

function Stop-ForeverNodes {
  Get-ForeverNodes | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "  stopped PID $($_.ProcessId)"
  }
  $owner = Get-PortOwner
  if ($owner) {
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    Write-Host "  freed port 8765 (PID $owner)"
  }
  Start-Sleep -Seconds 2
}

$healthy = Test-HostHealth
$nodes = @(Get-ForeverNodes)
$hasHost = $nodes | Where-Object { $_.CommandLine -match 'host[/\\]server\.js' }
$hasCollector = $nodes | Where-Object { $_.CommandLine -match 'collector[/\\]index\.js' }

if ($healthy -and $hasHost -and $hasCollector) {
  Write-Host "Already running - board is healthy."
  exit 0
}

Write-Host "Board needs a restart - healing..."
Stop-ForeverNodes

Write-Host "  starting host..."
Start-Process -WorkingDirectory $root -FilePath "node" -ArgumentList "host/server.js" -WindowStyle Minimized
$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Seconds 1
  if (Test-HostHealth) { break }
} while ((Get-Date) -lt $deadline)

if (-not (Test-HostHealth)) {
  Write-Host "Host failed to become healthy."
  exit 1
}

Write-Host "  starting collector..."
Start-Process -WorkingDirectory $root -FilePath "node" -ArgumentList "collector/index.js" -WindowStyle Minimized
Start-Sleep -Seconds 2

if (Test-HostHealth) {
  Write-Host "Ready."
  exit 0
}
Write-Host "Still unhealthy after start."
exit 1
