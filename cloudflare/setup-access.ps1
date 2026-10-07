# Ensure ingest DNS exists + print push-only checklist (after tunnel login).
# Default remote beta does NOT need Cloudflare Access (board is local-only).
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $here
$exe = Join-Path $here "bin\cloudflared.exe"
if (-not (Test-Path $exe)) {
  Write-Host "Missing $exe"
  exit 1
}

$ingestHost = $env:FOREVERLAN_INGEST_HOSTNAME
if (-not $ingestHost) {
  $cfg = Join-Path $repoRoot "config.json"
  if (Test-Path $cfg) {
    try {
      $json = Get-Content $cfg -Raw | ConvertFrom-Json
      if ($json.ingestPublicHostname) { $ingestHost = [string]$json.ingestPublicHostname }
    } catch {}
  }
}
if (-not $ingestHost) { $ingestHost = "foreverlan-ingest.example.com" }

Write-Host "Ensuring DNS route for ingest ($ingestHost)..."
& $exe tunnel route dns foreverlan $ingestHost 2>&1 | ForEach-Object { Write-Host $_ }

$cfgPath = Join-Path $here "config.yml"
$example = Join-Path $here "config.example.yml"
if (-not (Test-Path $cfgPath) -and (Test-Path $example)) {
  Copy-Item $example $cfgPath
  Write-Host "Wrote $cfgPath from example — fill tunnel UUID + credentials-file + your ingest hostname"
}

Write-Host ""
Write-Host "Push-only remote beta (default):"
Write-Host "  1. config.yml ingress = $ingestHost only (see config.example.yml)"
Write-Host "  2. NO Access app needed on ingest"
Write-Host "  3. config.json: remoteSecurityMode=wan, ingestPublicHostname=$ingestHost,"
Write-Host "     friendHostUrl=https://$ingestHost"
Write-Host "  4. Rebuild friend zip; start-remote-beta.bat"
Write-Host "  5. node scripts\test-remote-security.mjs --live-wan"
Write-Host "  6. Watch board at http://127.0.0.1:8765/ — leave any remote board hostname OFF the tunnel"
Write-Host ""
Write-Host "Optional later (remote board): see access-policy.md"
Write-Host "  - Add your dashboard hostname to tunnel ingress"
Write-Host "  - Access app on the dashboard hostname only (email allowlist + OTP)"
Write-Host "  - Still NO Access on the ingest hostname"
exit 0
