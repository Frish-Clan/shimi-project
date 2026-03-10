# ============================================================
#  Shimi Project — Windows Setup Script
#  Installs: Git, Python 3.12, Node.js LTS
#  Run in PowerShell as Administrator:
#    Right-click PowerShell → "Run as Administrator"
#    Then: .\setup_windows.ps1
# ============================================================

$ErrorActionPreference = "Stop"

function Write-Header($text) {
    Write-Host ""
    Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-OK($text)   { Write-Host "  [OK] $text" -ForegroundColor Green  }
function Write-Info($text) { Write-Host "  [..] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  [!!] $text" -ForegroundColor Red    }

# ── Check running as Administrator ──────────────────────────
if (-not ([Security.Principal.WindowsPrincipal]
          [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Err "Please run this script as Administrator."
    Write-Err "Right-click PowerShell and choose 'Run as Administrator'."
    Read-Host  "Press Enter to exit"
    exit 1
}

# ── Check winget ─────────────────────────────────────────────
Write-Header "Checking Windows Package Manager (winget)"
try {
    $wv = winget --version 2>$null
    Write-OK "winget found: $wv"
} catch {
    Write-Err "winget not found. Please update Windows or install it from:"
    Write-Err "https://aka.ms/getwinget"
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Git ──────────────────────────────────────────────────────
Write-Header "Installing Git"
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if ($gitCheck) {
    $gitVer = git --version
    Write-OK "Git already installed: $gitVer"
} else {
    Write-Info "Installing Git via winget..."
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-OK "Git installed successfully."
}

# ── Python 3.12 ──────────────────────────────────────────────
Write-Header "Installing Python 3.12"
$pyCheck = Get-Command python -ErrorAction SilentlyContinue
if ($pyCheck) {
    $pyVer = python --version 2>&1
    Write-OK "Python already installed: $pyVer"
} else {
    Write-Info "Installing Python 3.12 via winget..."
    winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-OK "Python installed successfully."
}

# ── Upgrade pip ──────────────────────────────────────────────
Write-Header "Upgrading pip"
Write-Info "Upgrading pip..."
python -m pip install --upgrade pip --quiet
Write-OK "pip up to date."

# ── Node.js LTS ──────────────────────────────────────────────
Write-Header "Installing Node.js LTS"
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCheck) {
    $nodeVer = node --version
    Write-OK "Node.js already installed: $nodeVer"
} else {
    Write-Info "Installing Node.js LTS via winget..."
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Write-OK "Node.js installed successfully."
}

# ── Summary ──────────────────────────────────────────────────
Write-Header "All done!"
Write-Host ""
Write-Host "  Installed:" -ForegroundColor White
try { Write-OK "Git    — $(git --version)" }   catch { Write-Err "Git    — not found in PATH yet" }
try { Write-OK "Python — $(python --version)" } catch { Write-Err "Python — not found in PATH yet" }
try { Write-OK "Node   — $(node --version)" }   catch { Write-Err "Node   — not found in PATH yet" }

Write-Host ""
Write-Host "  IMPORTANT: Close and reopen your terminal so PATH changes take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Next step — clone the project:" -ForegroundColor White
Write-Host "    git clone https://github.com/Frish-Clan/shimi-project.git" -ForegroundColor Cyan
Write-Host "    cd shimi-project" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
