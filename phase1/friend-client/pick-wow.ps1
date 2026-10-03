# Resolves WoW: Forever client dir for Forever LAN INSTALL.
# Prints the absolute client path (folder containing WowB.exe / Wow.exe) to stdout.
# Exit 0 on success, 1 if cancelled / invalid.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName PresentationFramework

function Test-WowClient([string]$dir) {
  if (-not $dir) { return $null }
  $dir = $dir.TrimEnd('\', '/')
  if ((Test-Path (Join-Path $dir "WowB.exe")) -or (Test-Path (Join-Path $dir "Wow.exe"))) {
    return $dir
  }
  $nested = Join-Path $dir "_classic_beta_"
  if ((Test-Path (Join-Path $nested "WowB.exe")) -or (Test-Path (Join-Path $nested "Wow.exe"))) {
    return $nested
  }
  $nested2 = Join-Path $dir "World of Warcraft\_classic_beta_"
  if ((Test-Path (Join-Path $nested2 "WowB.exe")) -or (Test-Path (Join-Path $nested2 "Wow.exe"))) {
    return $nested2
  }
  return $null
}

$candidates = @(
  "C:\Games\FOREVER\World of Warcraft\_classic_beta_",
  "C:\Program Files (x86)\World of Warcraft\_classic_beta_",
  "C:\Program Files\World of Warcraft\_classic_beta_"
)

$suggested = $null
foreach ($c in $candidates) {
  $hit = Test-WowClient $c
  if ($hit) { $suggested = $hit; break }
}

[System.Windows.MessageBox]::Show(
  "Next, choose where WoW: Forever is installed on this PC.`n`nSelect the folder that contains WowB.exe`n(usually named _classic_beta_).`n`nYou can also select the parent 'World of Warcraft' folder — Setup will find _classic_beta_ inside it.",
  "Forever LAN Setup",
  "OK",
  "Information"
) | Out-Null

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select your WoW: Forever folder (contains WowB.exe, or the World of Warcraft folder)"
$dialog.ShowNewFolderButton = $false
if ($suggested -and (Test-Path $suggested)) {
  $dialog.SelectedPath = $suggested
}

if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
  [System.Windows.MessageBox]::Show(
    "Setup cancelled — no game folder was selected.",
    "Forever LAN",
    "OK",
    "Warning"
  ) | Out-Null
  exit 1
}

$resolved = Test-WowClient $dialog.SelectedPath
if (-not $resolved) {
  [System.Windows.MessageBox]::Show(
    "That folder does not look like a WoW: Forever install.`n`nIt needs WowB.exe (or Wow.exe), usually inside _classic_beta_.`n`nSelected:`n$($dialog.SelectedPath)`n`nRun Setup again and pick the correct folder.",
    "Forever LAN",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

Write-Output $resolved
exit 0
