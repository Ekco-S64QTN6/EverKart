<#
.SYNOPSIS
    EverKart - Windows installer.

.DESCRIPTION
    Builds EverKart from your own EverQuest files and makes its Windows installer
    (game\release\EverKart-Setup-<version>.exe), then runs it: EverKart lands in your
    Start menu and on your desktop.

      1. Copy your EverQuest folder into the Everquest folder next to this script.
      2. Double-click install.bat   (or: powershell -ExecutionPolicy Bypass -File install.ps1)

    Missing tools (Python, Node.js, FFmpeg) are installed with winget after asking.

.PARAMETER BuildOnly
    Build the installer, do not run it.

.PARAMETER Yes
    Install missing tools without asking.
#>
param([switch]$BuildOnly, [switch]$Yes)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONUTF8 = '1'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  + $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host ''; Write-Host "Error: $text" -ForegroundColor Red; exit 1 }
function Ask($text) {
    if ($Yes) { return $true }
    $a = Read-Host "  $text [Y/n]"
    return ($a -eq '' -or $a -match '^[Yy]')
}
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Run($exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { Fail "'$exe $($arguments -join ' ')' failed (exit code $LASTEXITCODE)" }
}

# Python 3.10+: the 'py' launcher first ('python' may be the Microsoft Store shortcut)
function Find-Python {
    foreach ($cand in @(@('py', '-3'), @('python'))) {
        if (-not (Has $cand[0])) { continue }
        $pre = @($cand | Select-Object -Skip 1)
        try { $out = & $cand[0] @pre -c 'import sys; print(sys.version_info >= (3, 10))' 2>$null } catch { continue }
        if ($out -eq 'True') { return ,$cand }
    }
    return $null
}
function Node-Ok {
    if (-not ((Has 'node') -and (Has 'npm'))) { return $false }
    & node -e "process.exit(+process.versions.node.split('.')[0] < 18 ? 1 : 0)" 2>$null
    return ($LASTEXITCODE -eq 0)
}

Write-Host 'EverKart - kart racing through real EverQuest zones' -ForegroundColor White

# --- 1. the tools the build needs --------------------------------------------------------------
Step 'Checking the tools the build needs'
$missing = @()
if (Find-Python) { Ok 'Python' } else { $missing += @{ Name = 'Python 3.12'; Id = 'Python.Python.3.12' } }
if (Node-Ok)     { Ok "Node.js $(node --version)" } else { $missing += @{ Name = 'Node.js LTS'; Id = 'OpenJS.NodeJS.LTS' } }
if (Has 'ffmpeg') { Ok 'FFmpeg' } else { $missing += @{ Name = 'FFmpeg'; Id = 'Gyan.FFmpeg' } }

if ($missing.Count -gt 0) {
    $names = ($missing | ForEach-Object { $_.Name }) -join ', '
    Warn "missing: $names"
    if (-not (Has 'winget')) {
        Fail "install $names yourself (winget, the Windows package manager, is not available), then run install.bat again"
    }
    if (-not (Ask "Install $names with winget?")) { Fail "the build needs $names" }
    foreach ($m in $missing) {
        Write-Host "  installing $($m.Name)..."
        & winget install --id $m.Id -e --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { Warn "winget reported a problem installing $($m.Name) (exit code $LASTEXITCODE)" }
    }
    Refresh-Path
    if (-not (Find-Python)) { Fail 'Python 3.10+ is still not found - open a new window and run install.bat again' }
    if (-not (Node-Ok))     { Fail 'Node.js 18+ is still not found - open a new window and run install.bat again' }
    if (-not (Has 'ffmpeg')) { Fail 'FFmpeg is still not found - open a new window and run install.bat again' }
}
$py = Find-Python

# music is optional: FluidSynth and a General MIDI soundfont render the zones' music
if ((Has 'fluidsynth') -and $env:SOUNDFONT -and (Test-Path -LiteralPath $env:SOUNDFONT)) {
    Ok 'FluidSynth and a soundfont (the zones'' music)'
} else {
    Warn 'no music: FluidSynth and a General MIDI soundfont (SOUNDFONT=<file.sf2>) render the zones'' music'
    Warn 'the game builds and plays without it - see docs\INSTALL.md to add it later'
}

# --- 2. your EverQuest files -------------------------------------------------------------------
Step 'Looking for your EverQuest files'
$eqDir = (& $py[0] @($py | Select-Object -Skip 1) -c 'import sys; sys.path.insert(0, "tools"); import eqfiles; print(eqfiles.EQ)').Trim()
if (-not (Test-Path -LiteralPath (Join-Path $eqDir 'global_chr.s3d'))) {
    Fail @"
no EverQuest files in $eqDir

  Copy your EverQuest folder into the Everquest folder here (it then holds global_chr.s3d,
  the zones' .s3d files and so on), or set EVERQUEST_DIR to it before running the installer.
  EverKart is built and tested with Project 1999's EverQuest files. See Everquest\README.md.
"@
}
Ok $eqDir

# --- 3. build -----------------------------------------------------------------------------------
Step 'Setting up the build (Python packages in .venv\)'
$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPy)) { Run $py[0] (@($py | Select-Object -Skip 1) + @('-m', 'venv', '.venv')) }
Run $venvPy @('-m', 'pip', 'install', '-q', '--upgrade', 'pip')
Run $venvPy @('-m', 'pip', 'install', '-q', '-r', 'tools\requirements.txt')
Ok 'ready'

Step 'Building EverKart from your EverQuest files (the first build takes a while)'
Run $venvPy @('tools\build.py')
$setup = Get-ChildItem -Path 'game\release' -Filter 'EverKart-Setup-*.exe' -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Fail 'the build did not produce the installer (see the messages above)' }
Ok $setup.FullName

if ($BuildOnly) {
    Write-Host ''
    Write-Host "Done. Run $($setup.FullName) to install EverKart." -ForegroundColor Green
    exit 0
}

# --- 4. install -----------------------------------------------------------------------------------
Step 'Installing'
Start-Process -FilePath $setup.FullName -Wait
Ok 'Start menu -> EverKart (and a desktop shortcut)'
Write-Host ''
Write-Host 'Done. Have fun in Norrath.' -ForegroundColor Green
