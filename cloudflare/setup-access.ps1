# Ensure ingest DNS exists + print push-only checklist (after tunnel login).
# Default remote beta does NOT need Cloudflare Access (board is local-only).
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here "bin\cloudflared.exe"
if (-not (Test-Path $exe)) {
  Write-Host "Missing $exe"
  exit 1
}

Write-Host "Ensuring DNS route for ingest (required)..."
& $exe tunnel route dns foreverlan foreverlan-ingest.example.com 2>&1 | ForEach-Object { Write-Host $_ }

$cfgPath = Join-Path $here "config.yml"
$example = Join-Path $here "config.example.yml"
if (-not (Test-Path $cfgPath) -and (Test-Path $example)) {
  Copy-Item $example $cfgPath
  Write-Host "Wrote $cfgPath from example — fill tunnel UUID + credentials-file"
}

Write-Host ""
Write-Host "Push-only remote beta (default):"
Write-Host "  1. config.yml ingress = foreverlan-ingest.example.com only (see config.example.yml)"
Write-Host "  2. NO Access app needed on ingest"
Write-Host "  3. config.json: remoteSecurityMode=wan, ingestPublicHostname=foreverlan-ingest.example.com,"
Write-Host "     friendHostUrl=https://foreverlan-ingest.example.com"
Write-Host "  4. Rebuild friend zip; start-remote-beta.bat"
Write-Host "  5. node scripts\test-remote-security.mjs --live-wan"
Write-Host "  6. Watch board at http://127.0.0.1:8765/ — leave foreverlan.example.com OFF the tunnel"
Write-Host ""
Write-Host "Optional later (remote board): see access-policy.md"
Write-Host "  - Add foreverlan.example.com to tunnel ingress"
Write-Host "  - Access app on foreverlan.example.com only (email allowlist + OTP)"
Write-Host "  - Still NO Access on foreverlan-ingest.example.com"
exit 0
