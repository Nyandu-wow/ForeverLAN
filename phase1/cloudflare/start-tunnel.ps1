# Start Cloudflare Tunnel for foreverlan.example.com
# Prerequisites: cloudflared installed, config.yml filled from config.example.yml
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Join-Path $here "config.yml"
if (-not (Test-Path $config)) {
  Write-Host "Missing $config"
  Write-Host "Copy config.example.yml -> config.yml and fill tunnel UUID + credentials-file."
  exit 1
}
Write-Host "Tunneling https://foreverlan.example.com -> http://127.0.0.1:8765"
& cloudflared tunnel --config $config run
