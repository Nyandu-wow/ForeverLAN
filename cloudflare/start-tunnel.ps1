# Start Cloudflare Tunnel — push-only ingest → local Forever LAN host :8765
# Publishes foreverlan-ingest.example.com only. Board: http://127.0.0.1:8765/
# Prerequisites: config.yml filled; cloudflared in .\bin\ or on PATH
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Join-Path $here "config.yml"
$localBin = Join-Path $here "bin\cloudflared.exe"

if (-not (Test-Path $config)) {
  Write-Host "Missing $config"
  Write-Host "Copy config.example.yml -> config.yml and fill tunnel UUID + credentials-file."
  Write-Host "Or run setup-tunnel.ps1 after tunnel login. See README.md."
  exit 1
}

$cloudflared = $null
if (Test-Path $localBin) {
  $cloudflared = $localBin
} else {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { $cloudflared = $cmd.Source }
}

if (-not $cloudflared) {
  Write-Host "cloudflared not found."
  Write-Host "Expected: $localBin"
  Write-Host "Or install via winget: winget install Cloudflare.cloudflared"
  exit 1
}

Write-Host "Using: $cloudflared"
Write-Host "Tunneling https://foreverlan-ingest.example.com -> http://127.0.0.1:8765 (POST /events only)"
Write-Host "Board stays local: http://127.0.0.1:8765/"
& $cloudflared tunnel --config $config run
exit $LASTEXITCODE
