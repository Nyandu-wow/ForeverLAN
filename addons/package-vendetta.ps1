param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'))

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'ForeverVendetta'
$toc = Get-Content -LiteralPath (Join-Path $source 'ForeverVendetta.toc')
$version = (($toc | Where-Object { $_ -match '^## Version:' }) -replace '^## Version:\s*', '').Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version in TOC' }
$files = @('ForeverVendetta.toc', 'Core.lua', 'Comms.lua', 'UI.lua', 'Main.lua', 'README.md')
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) { throw "Missing $file" }
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$destination = Join-Path (Resolve-Path -LiteralPath $OutputDirectory).Path "ForeverVendetta-$version.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($destination, [System.IO.FileMode]::Create)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $source $file), "ForeverVendetta/$file") | Out-Null
    }
    $license = Join-Path (Split-Path $PSScriptRoot -Parent) 'LICENSE'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $license, 'ForeverVendetta/LICENSE') | Out-Null
} finally { $zip.Dispose(); $stream.Dispose() }
Write-Output $destination
