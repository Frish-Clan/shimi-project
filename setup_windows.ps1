# Shimi Project - Windows Setup Script
# Installs: Git, Python 3.12, Node.js LTS
# Run with: PowerShell -ExecutionPolicy Bypass -File .\setup_windows.ps1

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Shimi Project - Windows Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# --- Check winget ---
Write-Host "[1/3] Checking winget..." -ForegroundColor Yellow
try {
    $null = winget --version 2>$null
    Write-Host "      winget OK" -ForegroundColor Green
} catch {
    Write-Host "ERROR: winget not found." -ForegroundColor Red
    Write-Host "Please update Windows or install from: https://aka.ms/getwinget" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# --- Git ---
Write-Host ""
Write-Host "[1/3] Installing Git..." -ForegroundColor Yellow
$gitExe = Get-Command git -ErrorAction SilentlyContinue
if ($gitExe) {
    Write-Host "      Git already installed: $(git --version)" -ForegroundColor Green
} else {
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Write-Host "      Git installed." -ForegroundColor Green
}

# --- Python ---
Write-Host ""
Write-Host "[2/3] Installing Python 3.12..." -ForegroundColor Yellow
$pyExe = Get-Command python -ErrorAction SilentlyContinue
if ($pyExe) {
    Write-Host "      Python already installed: $(python --version)" -ForegroundColor Green
} else {
    winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
    Write-Host "      Python installed." -ForegroundColor Green
}

# --- Node.js ---
Write-Host ""
Write-Host "[3/3] Installing Node.js LTS..." -ForegroundColor Yellow
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if ($nodeExe) {
    Write-Host "      Node.js already installed: $(node --version)" -ForegroundColor Green
} else {
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    Write-Host "      Node.js installed." -ForegroundColor Green
}

# --- Done ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Done! Close and reopen PowerShell." -ForegroundColor Cyan
Write-Host "  Then clone the project:" -ForegroundColor Cyan
Write-Host "  git clone https://github.com/Frish-Clan/shimi-project.git" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
