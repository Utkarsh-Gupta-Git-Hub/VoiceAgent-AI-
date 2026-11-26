<#
.SYNOPSIS
    One-click setup + launcher for VoiceAgent AI (Windows 10/11).

.USAGE
    Double-click  setup_and_run.bat          (easiest)
    Double-click  stop.bat                   (stop everything)
    or from PowerShell:
        powershell -ExecutionPolicy Bypass -File .\setup_and_run.ps1
        powershell -ExecutionPolicy Bypass -File .\setup_and_run.ps1 -Stop

.WHAT IT DOES (in order)
    1. Finds or installs Python 3.10-3.13, Node.js 20.19+ and cloudflared (via winget)
    2. Creates .env from .env.example and asks you to fill in the API keys
    3. Creates a Python virtual environment and installs backend packages
    4. Installs the UI packages
    5. Stops any previous run of this project and checks ports 8001 / 5173
    6. Opens a free public tunnel (Cloudflare, no account) so Exotel can reach this PC
    7. Writes the tunnel address into .env (PUBLIC_WS_URL)
    8. Starts the backend (8001) and UI (5173), then opens the browser

    Safe to run again at any time: finished steps are quick on later runs.
#>
param([switch]$Stop)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # faster Invoke-WebRequest on PowerShell 5.1
$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 8001
$UiPort      = 5173
$PidFile     = Join-Path $Root ".run_pids"
$TunnelLog   = Join-Path $Root "cloudflared.log"
$VenvDir     = Join-Path $Root "venv"
$VenvPython  = Join-Path $VenvDir "Scripts\python.exe"
$EnvFile     = Join-Path $Root ".env"
Set-Location $Root

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK  $msg" -ForegroundColor Green }
function Info($msg)     { Write-Host "    ..  $msg" -ForegroundColor Gray }
function Warn($msg)     { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Fail($msg) {
    Write-Host "`nERROR: $msg" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

# Runs a native command and returns its trimmed stdout, or $null if it fails.
# (Never throws: PowerShell 5.1 turns native stderr into terminating errors otherwise.)
function Try-Run([string]$exe, [string[]]$argList) {
    try {
        $out = & $exe @argList 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Out-String).Trim() }
    } catch {}
    return $null
}

function Kill-Tree([int]$procId) {
    if ($procId -le 0) { return }
    try { & taskkill.exe /PID $procId /T /F *> $null } catch {}
}

function Port-InUse($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-All([switch]$Quiet) {
    if (Test-Path $PidFile) {
        foreach ($line in Get-Content $PidFile) {
            $procId = 0
            if ([int]::TryParse($line, [ref]$procId)) { Kill-Tree $procId }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
    if (-not $Quiet) { Write-Host "Stopped VoiceAgent AI (backend, UI, tunnel)." -ForegroundColor Green }
}

function Winget-Install($id, $label) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "$label is missing and winget is not available. Install $label manually, then run this again."
    }
    Warn "Installing $label with winget (a few minutes, may ask for permission)..."
    try {
        & winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements *> $null
    } catch {}
    Refresh-Path
}

# Python: must be a real install (not the Microsoft Store stub) and 3.10-3.13
# (3.14+ is too new for some voice packages such as onnxruntime / av).
function Get-PyVersion($exe, [string[]]$prefix) {
    return Try-Run $exe ($prefix + @("-c", "import sys;print('%d.%d' % sys.version_info[:2])"))
}
function Find-Python {
    $good = @("3.12", "3.13", "3.11", "3.10")
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in $good) {
            $ver = Get-PyVersion "py" @("-$v")
            if ($ver -eq $v) {
                $path = Try-Run "py" @("-$v", "-c", "import sys;print(sys.executable)")
                if ($path) { return $path }
            }
        }
    }
    $candidates = @()
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notlike "*WindowsApps*") { $candidates += $cmd.Source }
    foreach ($v in @("312", "313", "311", "310")) {
        $candidates += Join-Path $env:LOCALAPPDATA "Programs\Python\Python$v\python.exe"
        $candidates += "C:\Program Files\Python$v\python.exe"
    }
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $ver = Get-PyVersion $c @()
            if ($ver -and $good -contains $ver) { return $c }
        }
    }
    return $null
}

function Find-Node {
    $candidates = @()
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    $candidates += "C:\Program Files\nodejs\node.exe"
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $ver = Try-Run $c @("--version")
            if ($ver -match "^v(\d+)\.(\d+)") {
                $major = [int]$Matches[1]; $minor = [int]$Matches[2]
                # Vite 8 needs Node 20.19+ or 22.12+ (or any newer major)
                $supported = ($major -eq 20 -and $minor -ge 19) -or ($major -eq 22 -and $minor -ge 12) -or ($major -ge 23)
                if ($supported) { return $c }
            }
        }
    }
    return $null
}

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("C:\Program Files (x86)\cloudflared\cloudflared.exe",
                     "C:\Program Files\cloudflared\cloudflared.exe")) {
        if (Test-Path $p) { return $p }
    }
    $wg = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path $wg) {
        $hit = Get-ChildItem $wg -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

if ($Stop) { Stop-All; exit 0 }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   VoiceAgent AI - setup & run" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
Step "1/8" "Checking Python, Node.js and cloudflared"

$PythonExe = Find-Python
if (-not $PythonExe) {
    Winget-Install "Python.Python.3.12" "Python 3.12"
    $PythonExe = Find-Python
    if (-not $PythonExe) { Fail "Python 3.12 was installed but could not be found. Close this window and run the script again." }
}
Ok "Python $(Get-PyVersion $PythonExe @()) -> $PythonExe"

$NodeExe = Find-Node
if (-not $NodeExe) {
    Winget-Install "OpenJS.NodeJS.LTS" "Node.js LTS"
    $NodeExe = Find-Node
    if (-not $NodeExe) { Fail "Node.js 20.19+ is required. Close this window and run the script again (or install Node.js LTS from nodejs.org)." }
}
$NpmCmd = Join-Path (Split-Path $NodeExe) "npm.cmd"
if (-not (Test-Path $NpmCmd)) { Fail "npm was not found next to node.exe. Reinstall Node.js LTS." }
Ok "Node.js $(Try-Run $NodeExe @('--version')) -> $NodeExe"

$CloudflaredExe = Find-Cloudflared
if (-not $CloudflaredExe) {
    Winget-Install "Cloudflare.cloudflared" "cloudflared"
    $CloudflaredExe = Find-Cloudflared
    if (-not $CloudflaredExe) { Fail "cloudflared could not be installed. Install it from https://github.com/cloudflare/cloudflared/releases and re-run." }
}
Ok "cloudflared -> $CloudflaredExe"

# ---------------------------------------------------------------------------
# 2. .env (API keys - never committed to git)
# ---------------------------------------------------------------------------
Step "2/8" "Checking configuration (.env)"
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Root ".env.example") $EnvFile
    Warn ".env created from the template. Notepad will open now:"
    Warn "  paste your working .env contents (or fill in the REPLACE_ME keys), SAVE, then close Notepad."
    Start-Process notepad.exe $EnvFile -Wait
}
$envText  = Get-Content $EnvFile -Raw
$required = "SARVAM_API_KEY", "DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY",
            "EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN", "EXOTEL_CALLER_ID"
$missing = @()
foreach ($k in $required) {
    if ($envText -notmatch "(?m)^\s*$k\s*=\s*(?!REPLACE_ME)\S+") { $missing += $k }
}
if ($missing.Count -gt 0) {
    Warn "These keys are empty or still REPLACE_ME: $($missing -join ', ')"
    Warn "The app will start, but phone calls will not work until you fill them in and re-run."
} else {
    Ok ".env has all required keys"
}

# ---------------------------------------------------------------------------
# 3. Backend packages
# ---------------------------------------------------------------------------
Step "3/8" "Setting up Python environment"
if (Test-Path $VenvPython) {
    $venvVer = Get-PyVersion $VenvPython @()
    if (-not $venvVer -or @("3.10", "3.11", "3.12", "3.13") -notcontains $venvVer) {
        Warn "Existing venv uses an unsupported Python ($venvVer) - recreating it."
        Remove-Item $VenvDir -Recurse -Force
    }
}
if (-not (Test-Path $VenvPython)) {
    Info "Creating virtual environment..."
    & $PythonExe -m venv $VenvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) { Fail "Could not create the virtual environment." }
}
Info "Installing backend packages (first run: 5-10 minutes, no output while it works)..."
& $VenvPython -m pip install --upgrade pip --quiet --disable-pip-version-check
& $VenvPython -m pip install -r (Join-Path $Root "requirements.txt") --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Fail "Installing backend packages failed. Check your internet connection and run again." }
Ok "Backend packages installed"

# ---------------------------------------------------------------------------
# 4. UI packages
# ---------------------------------------------------------------------------
Step "4/8" "Installing UI packages"
Push-Location (Join-Path $Root "ui")
try {
    & $NpmCmd install --no-audit --no-fund --loglevel=error
    $npmExit = $LASTEXITCODE
} finally { Pop-Location }
if ($npmExit -ne 0) { Fail "npm install failed. Check your internet connection and run again." }
Ok "UI packages installed"

# ---------------------------------------------------------------------------
# 5. Ports (stop a previous run of THIS project only)
# ---------------------------------------------------------------------------
Step "5/8" "Preparing ports $BackendPort and $UiPort"
Stop-All -Quiet
Start-Sleep -Seconds 2
foreach ($port in @($BackendPort, $UiPort)) {
    if (Port-InUse $port) { Fail "Port $port is used by another program. Close that program and run again." }
}
Ok "Ports are free"

# ---------------------------------------------------------------------------
# 6. Public tunnel (Exotel must reach this PC)
# ---------------------------------------------------------------------------
Step "6/8" "Opening public tunnel (Cloudflare, no account needed)"
Remove-Item $TunnelLog -Force -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath $CloudflaredExe `
    -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$BackendPort") `
    -RedirectStandardError $TunnelLog -RedirectStandardOutput (Join-Path $Root "cloudflared.out.log") `
    -WindowStyle Hidden -PassThru
Add-Content $PidFile $tunnel.Id

$tunnelUrl = $null
for ($i = 0; $i -lt 60 -and -not $tunnelUrl; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $TunnelLog) {
        $m = Select-String -Path $TunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
             Select-Object -First 1
        if ($m) { $tunnelUrl = $m.Matches[0].Value }
    }
}
if (-not $tunnelUrl) { Fail "Could not open the tunnel. Check your internet connection (see cloudflared.log) and run again." }
Ok "Tunnel: $tunnelUrl"

# ---------------------------------------------------------------------------
# 7. Save tunnel address + port in .env (read by the backend at start-up)
# ---------------------------------------------------------------------------
Step "7/8" "Saving tunnel address to .env"
$wsUrl = ($tunnelUrl -replace "^https://", "wss://") + "/ws/voice-bot"
$lines = @(Get-Content $EnvFile)
$hasWs = $false; $hasPort = $false
$lines = @($lines | ForEach-Object {
    if ($_ -match "^\s*PUBLIC_WS_URL\s*=") { $hasWs = $true; "PUBLIC_WS_URL=$wsUrl" }
    elseif ($_ -match "^\s*PORT\s*=")      { $hasPort = $true; "PORT=$BackendPort" }
    else { $_ }
})
if (-not $hasWs)   { $lines += "PUBLIC_WS_URL=$wsUrl" }
if (-not $hasPort) { $lines += "PORT=$BackendPort" }
[System.IO.File]::WriteAllLines($EnvFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
Ok "PUBLIC_WS_URL=$wsUrl"

# ---------------------------------------------------------------------------
# 8. Start backend + UI
# ---------------------------------------------------------------------------
Step "8/8" "Starting backend and UI"
# 127.0.0.1 only: the tunnel connects locally, and this avoids a Windows Firewall prompt.
$backend = Start-Process -FilePath $VenvPython `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
    -WorkingDirectory $Root -RedirectStandardError (Join-Path $Root "backend.log") `
    -RedirectStandardOutput (Join-Path $Root "backend.out.log") -WindowStyle Hidden -PassThru
Add-Content $PidFile $backend.Id

$ready = $false
for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
    Start-Sleep -Seconds 1
    if ($backend.HasExited) { break }
    try { $ready = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$BackendPort/docs" -TimeoutSec 2).StatusCode -eq 200 } catch {}
}
if (-not $ready) {
    Write-Host "`n--- last lines of backend.log ---" -ForegroundColor Yellow
    Get-Content (Join-Path $Root "backend.log") -Tail 15 -ErrorAction SilentlyContinue
    Fail "Backend did not start (details above, full log in backend.log)."
}
Ok "Backend running on http://127.0.0.1:$BackendPort"

$ui = Start-Process -FilePath $NpmCmd `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$UiPort", "--strictPort") `
    -WorkingDirectory (Join-Path $Root "ui") -RedirectStandardOutput (Join-Path $Root "ui.log") `
    -RedirectStandardError (Join-Path $Root "ui.err.log") -WindowStyle Hidden -PassThru
Add-Content $PidFile $ui.Id

$uiReady = $false
for ($i = 0; $i -lt 60 -and -not $uiReady; $i++) {
    Start-Sleep -Seconds 1
    try { $uiReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$UiPort/" -TimeoutSec 2).StatusCode -eq 200 } catch {}
}
if (-not $uiReady) { Fail "UI did not start. See ui.err.log in this folder." }
Ok "UI running on http://127.0.0.1:$UiPort"

Start-Process "http://127.0.0.1:$UiPort/"

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  VoiceAgent AI is running" -ForegroundColor Green
Write-Host "    App      : http://127.0.0.1:$UiPort" -ForegroundColor Green
Write-Host "    API docs : http://127.0.0.1:$BackendPort/docs" -ForegroundColor Green
Write-Host "    Tunnel   : $tunnelUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Sign up / log in   2. Add a contact   3. Place a call" -ForegroundColor Green
Write-Host "  Logs  : backend.log, ui.err.log, cloudflared.log (this folder)" -ForegroundColor Green
Write-Host "  Stop  : double-click stop.bat" -ForegroundColor Green
Write-Host "  Keep this PC awake and online during calls." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Read-Host "`nPress Enter to close this window (the app keeps running)"
