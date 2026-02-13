#Requires -Version 5.1
<#
.SYNOPSIS
    Install Tamma CLI on Windows.

.DESCRIPTION
    Downloads the correct Tamma CLI binary for your platform from GitHub Releases,
    verifies the SHA256 checksum, and installs it to your local app data directory.

.PARAMETER Version
    Specific version to install (default: latest). Can also be set via $env:TAMMA_VERSION.

.PARAMETER InstallDir
    Installation directory (default: $env:LOCALAPPDATA\tamma). Can also be set via $env:TAMMA_INSTALL_DIR.

.EXAMPLE
    irm https://raw.githubusercontent.com/meywd/tamma/main/install.ps1 | iex

.EXAMPLE
    $env:TAMMA_VERSION = "0.2.0"; irm https://raw.githubusercontent.com/meywd/tamma/main/install.ps1 | iex
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

# ── Constants ──────────────────────────────────────────────────────────────────

$GitHubRepo = "meywd/tamma"
$GitHubApi = "https://api.github.com/repos/$GitHubRepo/releases/latest"
$DownloadBase = "https://github.com/$GitHubRepo/releases/download"

# ── Configuration ──────────────────────────────────────────────────────────────

$Version = if ($env:TAMMA_VERSION) { $env:TAMMA_VERSION.TrimStart("v") } else { $null }
$InstallDir = if ($env:TAMMA_INSTALL_DIR) { $env:TAMMA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "tamma" }

# ── Banner ─────────────────────────────────────────────────────────────────────

function Write-Banner {
    $banner = @"

  _____
 |_   _|_ _ _ __ ___  _ __ ___   __ _
   | |/ _` | '_ `` _ \| '_ `` _ \ / _`` |
   | | (_| | | | | | | | | | | | (_| |
   |_|\__,_|_| |_| |_|_| |_| |_|\__,_|

  Autonomous Development Agent

"@
    Write-Host $banner -ForegroundColor Cyan
}

# ── Logging helpers ────────────────────────────────────────────────────────────

function Write-Info {
    param([string]$Message)
    Write-Host "info  " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Ok {
    param([string]$Message)
    Write-Host "ok    " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warn {
    param([string]$Message)
    Write-Host "warn  " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Err {
    param([string]$Message)
    Write-Host "error " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

# ── Platform detection ─────────────────────────────────────────────────────────

function Get-Platform {
    $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

    switch ($osArch) {
        "X64"   { return "x64" }
        "Arm64" { return "arm64" }
        default {
            Write-Err "Unsupported architecture: $osArch"
            exit 1
        }
    }
}

# ── Version resolution ─────────────────────────────────────────────────────────

function Get-LatestVersion {
    $headers = @{
        "Accept" = "application/vnd.github.v3+json"
        "User-Agent" = "tamma-installer"
    }

    if ($env:GITHUB_TOKEN) {
        $headers["Authorization"] = "token $($env:GITHUB_TOKEN)"
    }

    try {
        $response = Invoke-RestMethod -Uri $GitHubApi -Headers $headers -UseBasicParsing
        $tag = $response.tag_name
        return $tag.TrimStart("v")
    }
    catch {
        Write-Err "Failed to fetch latest version from GitHub API."
        Write-Err "Error: $_"
        Write-Err "If rate-limited, set `$env:GITHUB_TOKEN to increase the limit."
        exit 1
    }
}

# ── Checksum verification ─────────────────────────────────────────────────────

function Test-Checksum {
    param(
        [string]$FilePath,
        [string]$ExpectedHash
    )

    $actualHash = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()

    if ($actualHash -ne $ExpectedHash.ToLower()) {
        Write-Err "Checksum verification failed!"
        Write-Err "Expected: $ExpectedHash"
        Write-Err "Actual:   $actualHash"
        Write-Err "The downloaded binary may be corrupted or tampered with."
        exit 1
    }

    Write-Ok "Checksum verified: $actualHash"
}

# ── PATH management ───────────────────────────────────────────────────────────

function Add-ToPath {
    param([string]$Directory)

    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

    if ($currentPath -split ";" | Where-Object { $_ -eq $Directory }) {
        Write-Info "Install directory is already in your PATH."
        return
    }

    Write-Host ""
    Write-Warn "$Directory is not in your PATH."
    $answer = Read-Host "  Add $Directory to PATH? [y/N]"

    if ($answer -match "^[yY]") {
        $newPath = "$Directory;$currentPath"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Ok "Added $Directory to user PATH."
        Write-Info "Restart your terminal for the change to take effect."

        # Also update the current session
        $env:Path = "$Directory;$env:Path"
    }
    else {
        Write-Info "Skipped PATH update. Add it manually:"
        Write-Info "  `$env:Path = `"$Directory;`$env:Path`""
    }
}

# ── Main ───────────────────────────────────────────────────────────────────────

function Install-Tamma {
    Write-Banner

    # Detect platform (Windows only supports windows-x64 and windows-arm64 for now)
    $arch = Get-Platform
    $os = "win32"
    Write-Info "Detected platform: windows-$arch"

    # Resolve version
    if ($Version) {
        Write-Info "Installing specified version: $Version"
    }
    else {
        Write-Info "Fetching latest version..."
        $script:Version = Get-LatestVersion
        Write-Info "Latest version: $Version"
    }

    # Compute asset names
    $binaryName = "tamma-$Version-$os-$arch.exe"
    $checksumName = "$binaryName.sha256"
    $downloadUrl = "$DownloadBase/v$Version/$binaryName"
    $checksumUrl = "$DownloadBase/v$Version/$checksumName"

    # Create temp directory
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "tamma-install-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        $tempBinary = Join-Path $tempDir $binaryName
        $tempChecksum = Join-Path $tempDir $checksumName

        # Download binary
        Write-Info "Downloading $binaryName..."
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $tempBinary -UseBasicParsing
        }
        catch {
            Write-Err "Failed to download binary."
            Write-Err "URL: $downloadUrl"
            Write-Err "Error: $_"
            exit 1
        }
        Write-Ok "Downloaded binary"

        # Download checksum
        Write-Info "Downloading checksum..."
        try {
            Invoke-WebRequest -Uri $checksumUrl -OutFile $tempChecksum -UseBasicParsing
        }
        catch {
            Write-Err "Failed to download checksum file."
            Write-Err "URL: $checksumUrl"
            Write-Err "Error: $_"
            exit 1
        }

        # Extract expected hash from checksum file (format: "hash  filename")
        $checksumContent = Get-Content $tempChecksum -Raw
        $expectedHash = ($checksumContent -split '\s+')[0]

        # Verify checksum
        Write-Info "Verifying checksum..."
        Test-Checksum -FilePath $tempBinary -ExpectedHash $expectedHash

        # Ensure install directory exists
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }

        # Atomic install: move to final location
        $finalPath = Join-Path $InstallDir "tamma.exe"
        Move-Item -Path $tempBinary -Destination $finalPath -Force
        Write-Ok "Installed tamma to $finalPath"

        # Verify the binary works
        try {
            $installedVersion = & $finalPath --version 2>$null
            if ($installedVersion) {
                Write-Ok "Verified: tamma $installedVersion"
            }
        }
        catch {
            # Non-fatal: the binary might not support --version yet
        }

        # Offer to add to PATH
        Add-ToPath -Directory $InstallDir

        # Print success
        Write-Host ""
        Write-Host "  Tamma $Version installed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Info "Get started:"
        Write-Info "  tamma --help"
        Write-Info "  tamma start"
        Write-Host ""
    }
    finally {
        # Cleanup temp directory
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# Run the installer
Install-Tamma
