# Downloads the full vdf-web project (including the VDF submodule) into Kevin's folder.
# Run in PowerShell: irm (or download this file from the repo) — easiest: clone repo first with Cursor, or run from an existing clone:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-to-pc.ps1

$ErrorActionPreference = "Stop"
$Target = "C:\Users\kevin\Documents\Projects\63 personal\02_vdf-web"
$Repo = "https://origin.cursor.com/git/kevin-rosso/tmp-eb081e15f50468e6.git"

if (Test-Path $Target) {
  if (Test-Path (Join-Path $Target ".git")) {
    Write-Host "Updating existing repo at $Target"
    Set-Location $Target
    git pull origin main
    git submodule update --init --recursive
    exit 0
  }
  throw "Folder exists but is not a git repo: $Target — move it aside or pick another path."
}

$Parent = Split-Path $Target -Parent
if (-not (Test-Path $Parent)) {
  New-Item -ItemType Directory -Path $Parent -Force | Out-Null
}

Write-Host "Cloning into $Target"
git clone --branch main --recurse-submodules $Repo $Target
Write-Host "Done. Open $Target in Cursor, then: npm install"
