# Tier 2 Installer: curl-based Standalone Binary Distribution

> **Goal**: `curl -fsSL https://raw.githubusercontent.com/meywd/tamma/main/install.sh | bash`
> installs a standalone `tamma` binary into `~/.local/bin/tamma` with zero prerequisites
> (no Node.js, no pnpm, no npm).

## Table of Contents

1. [Overview](#1-overview)
2. [Binary Compilation Strategy](#2-binary-compilation-strategy)
3. [Install Script (install.sh)](#3-install-script-installsh)
4. [Windows PowerShell Variant (install.ps1)](#4-windows-powershell-variant-installps1)
5. [GitHub Releases Pipeline](#5-github-releases-pipeline)
6. [Auto-Update Mechanism](#6-auto-update-mechanism)
7. [Homebrew Formula](#7-homebrew-formula)
8. [First-Run Experience](#8-first-run-experience)
9. [Testing Strategy](#9-testing-strategy)
10. [Risks and Mitigations](#10-risks-and-mitigations)
11. [Implementation Steps](#11-implementation-steps)

---

## 1. Overview

### Current State

The CLI (`@tamma/cli`) is a TypeScript + React (Ink) TUI application that requires:
- Node.js >= 22
- pnpm (for monorepo workspace resolution)
- 6 workspace packages: `@tamma/shared`, `@tamma/observability`, `@tamma/providers`, `@tamma/platforms`, `@tamma/orchestrator`, `@tamma/api`
- External runtime dependencies: `ink`, `react`, `commander`, `dotenv`, `pino`, `fastify`, `@octokit/rest`, `@anthropic-ai/sdk`, `openai`, `@gitbeaker/rest`, `zod`

### Target State

A single self-contained binary per platform that embeds the entire dependency tree. Users run
`curl ... | bash` and get a working `tamma` command. The binary runs the same code paths as the
npm-installed version.

### Why Bun

`bun build --compile` produces standalone executables that embed the Bun runtime, all JavaScript,
and all dependencies into a single file. This is the same approach used by
[OpenCode](https://github.com/nicepkg/opencode) for CLI distribution. Key advantages:

- Single command to produce a binary from TypeScript/JSX source
- Built-in JSX transform (no separate build step for React/Ink)
- Supports `node:*` APIs (child_process, fs, path, etc.)
- Cross-compilation: build for any target from any host
- Output binary size typically 50-90 MB (Bun runtime + app code)

---

## 2. Binary Compilation Strategy

### 2.1 Target Platforms

| Target | Bun Target String | Runner | Priority |
|--------|------------------|--------|----------|
| macOS ARM64 (Apple Silicon) | `bun-darwin-arm64` | `macos-14` (M1) | P0 |
| macOS x64 (Intel) | `bun-darwin-x64` | `macos-13` | P0 |
| Linux x64 | `bun-linux-x64` | `ubuntu-latest` | P0 |
| Linux ARM64 | `bun-linux-arm64` | `ubuntu-24.04-arm` | P1 |
| Windows x64 | `bun-windows-x64` | `windows-latest` | P2 (experimental) |

### 2.2 Entrypoint and Build Command

The compilation entrypoint is the CLI's `src/index.tsx`. Bun handles JSX natively.

```bash
# Build for current platform
bun build --compile --minify --sourcemap ./packages/cli/src/index.tsx \
  --outfile tamma

# Cross-compile for a specific target
bun build --compile --minify --sourcemap ./packages/cli/src/index.tsx \
  --target=bun-linux-x64 \
  --outfile tamma-linux-x64
```

### 2.3 Build Script

Create `scripts/build-binary.ts` to orchestrate cross-platform builds:

```typescript
#!/usr/bin/env bun
/**
 * scripts/build-binary.ts
 *
 * Builds standalone tamma binaries for all target platforms.
 * Usage:
 *   bun run scripts/build-binary.ts                    # current platform only
 *   bun run scripts/build-binary.ts --all              # all platforms
 *   bun run scripts/build-binary.ts --target linux-x64 # specific target
 */

import { $ } from 'bun';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const VERSION = JSON.parse(
  readFileSync('packages/cli/package.json', 'utf-8')
).version;

const TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'linux-arm64': 'bun-linux-arm64',
  'windows-x64': 'bun-windows-x64',
} as const;

type Platform = keyof typeof TARGETS;

const ENTRYPOINT = 'packages/cli/src/index.tsx';
const DIST_DIR = 'dist/binaries';

function getOutputName(platform: Platform): string {
  const ext = platform.startsWith('windows') ? '.exe' : '';
  return `tamma-${VERSION}-${platform}${ext}`;
}

async function buildTarget(platform: Platform): Promise<string> {
  const target = TARGETS[platform];
  const outfile = join(DIST_DIR, getOutputName(platform));

  console.log(`Building for ${platform}...`);

  await $`bun build --compile --minify --sourcemap ${ENTRYPOINT} \
    --target=${target} \
    --outfile ${outfile}`.throws(true);

  // Generate SHA256 checksum
  const binary = readFileSync(outfile);
  const hash = createHash('sha256').update(binary).digest('hex');
  writeFileSync(`${outfile}.sha256`, `${hash}  ${getOutputName(platform)}\n`);

  console.log(`  -> ${outfile} (${(binary.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  -> SHA256: ${hash}`);

  return hash;
}

async function main() {
  mkdirSync(DIST_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const buildAll = args.includes('--all');
  const targetArg = args.find((a) => a.startsWith('--target='))?.split('=')[1];

  let platforms: Platform[];
  if (buildAll) {
    platforms = Object.keys(TARGETS) as Platform[];
  } else if (targetArg && targetArg in TARGETS) {
    platforms = [targetArg as Platform];
  } else {
    // Detect current platform
    const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    platforms = [`${os}-${arch}` as Platform];
  }

  const manifest: Record<string, { sha256: string; size: number }> = {};

  for (const platform of platforms) {
    const hash = await buildTarget(platform);
    const outfile = join(DIST_DIR, getOutputName(platform));
    const stat = Bun.file(outfile);
    manifest[platform] = { sha256: hash, size: stat.size };
  }

  // Write manifest
  const manifestContent = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    assets: manifest,
  };
  writeFileSync(
    join(DIST_DIR, 'manifest.json'),
    JSON.stringify(manifestContent, null, 2)
  );

  console.log('\nManifest written to dist/binaries/manifest.json');
}

main().catch(console.error);
```

### 2.4 Handling JSX (Ink/React)

Bun has built-in JSX support. The current `tsconfig.json` uses `"jsx": "react"` which maps to
`React.createElement` calls. Bun handles this transparently during `bun build --compile`:

- All `.tsx` files (SessionLayout, Banner, IssueSelector, etc.) are compiled inline
- React 18 and Ink 5 are bundled into the binary
- No separate Babel or esbuild step needed

**One important consideration**: Ink uses `yoga-wasm-web` (or `yoga-layout`) for terminal layout.
This is a WASM module that Bun embeds as a binary asset. This has been proven to work with
`bun build --compile` in production (e.g., OpenCode ships Ink-based TUI via Bun binaries).

### 2.5 Handling Node.js Built-in Modules

The codebase uses these `node:*` modules:
- `node:child_process` (execSync, execFileSync in preflight, providers)
- `node:fs` (config file I/O)
- `node:path` (path resolution)
- `node:module` (createRequire for package.json version -- needs adjustment)
- `node:crypto` (potential usage in auth)

Bun implements all of these. The one adjustment needed is the `createRequire` usage in
`packages/cli/src/index.tsx`:

```typescript
// CURRENT (won't work in Bun binary — no package.json next to the binary)
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// FIX: Embed version at build time
const VERSION = process.env['TAMMA_VERSION'] ?? '0.1.0';
```

We will inject `TAMMA_VERSION` via `--define` at build time:

```bash
bun build --compile --minify \
  --define "process.env.TAMMA_VERSION='\"${VERSION}\"'" \
  ./packages/cli/src/index.tsx --outfile tamma
```

Alternatively, use a `version.ts` file generated at build time:

```typescript
// packages/cli/src/version.ts (generated by build script)
export const VERSION = '0.1.0';
```

### 2.6 Handling pino (Worker Threads)

`pino` uses `thread-stream` under the hood to do asynchronous logging in a worker thread.
Bun supports `worker_threads` but the thread worker file must be resolvable at runtime.
This is a known pain point with bundlers.

**Mitigation strategies** (in order of preference):

1. **Use pino's synchronous transport**: Set `pino({ transport: undefined })` and use the
   synchronous mode. The CLI already uses a custom `LogEmitter` bridge for interactive mode,
   so pino is only used in `--dry-run` mode. Synchronous logging is acceptable for CLI usage.

2. **Replace pino with a lightweight logger**: Since the CLI's own `createLoggerBridge` already
   implements the `ILogger` interface without pino, we could make the binary always use the
   bridge logger and drop the pino dependency for the binary build path.

3. **Use `--external pino`**: Mark pino as external and ship a pino worker script alongside the
   binary. This is less clean but would work.

Recommendation: Option 2. Create a `createSimpleLogger` function that writes directly to
stderr (matching the `ILogger` interface) and use it for the binary build. This eliminates
the pino/thread-stream bundling issue entirely.

### 2.7 Bundle Size Expectations

| Component | Estimated Size |
|-----------|---------------|
| Bun runtime | ~45 MB |
| Application code (all packages) | ~2 MB |
| Dependencies (React, Ink, Octokit, Anthropic SDK, etc.) | ~8 MB |
| **Total (uncompressed)** | **~55 MB** |
| **Total (after --minify)** | **~50 MB** |
| **Compressed (.tar.gz for download)** | **~18-22 MB** |

These sizes are comparable to other Bun-compiled CLIs (OpenCode ships at ~55 MB uncompressed).

### 2.8 Workspace Resolution

The monorepo uses `workspace:*` protocol in package.json. During `bun build --compile`, Bun
resolves workspace packages by following the `pnpm-workspace.yaml` configuration. This means
the build must be run from the monorepo root where workspace resolution is available.

If workspace resolution causes issues, we can create a pre-build step that uses `esbuild` to
bundle all workspace packages into a single entrypoint first, then feed that to `bun build --compile`:

```bash
# Fallback: two-stage build
npx esbuild packages/cli/src/index.tsx \
  --bundle --platform=node --format=esm \
  --outfile=dist/cli-bundle.mjs \
  --external:react --external:ink --external:yoga-wasm-web

bun build --compile --minify dist/cli-bundle.mjs --outfile tamma
```

---

## 3. Install Script (install.sh)

```bash
#!/usr/bin/env bash
#
# Tamma CLI Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/meywd/tamma/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/meywd/tamma/main/install.sh | bash -s -- --version 0.2.0
#   curl -fsSL https://raw.githubusercontent.com/meywd/tamma/main/install.sh | TAMMA_INSTALL_DIR=/usr/local/bin bash
#
# Environment variables:
#   TAMMA_INSTALL_DIR  - Installation directory (default: ~/.local/bin)
#   TAMMA_VERSION      - Specific version to install (default: latest)
#   HTTPS_PROXY        - Proxy for HTTPS connections
#   NO_COLOR           - Disable colored output

set -euo pipefail

# --- Configuration ---
REPO="meywd/tamma"
BINARY_NAME="tamma"
DEFAULT_INSTALL_DIR="${HOME}/.local/bin"
INSTALL_DIR="${TAMMA_INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}"
GITHUB_API="https://api.github.com"
GITHUB_DOWNLOAD="https://github.com"

# --- Colors ---
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  DIM='\033[2m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' DIM='' BOLD='' RESET=''
fi

# --- Logging ---
info()  { echo -e "${CYAN}info${RESET}  $*"; }
warn()  { echo -e "${YELLOW}warn${RESET}  $*" >&2; }
error() { echo -e "${RED}error${RESET} $*" >&2; }
success() { echo -e "${GREEN}ok${RESET}    $*"; }

# --- Banner ---
banner() {
  echo -e "${CYAN}${BOLD}"
  echo '  ╔╦╗╔═╗╔╦╗╔╦╗╔═╗'
  echo '   ║ ╠═╣║║║║║║╠═╣'
  echo '   ╩ ╩ ╩╩ ╩╩ ╩╩ ╩'
  echo -e "${RESET}"
  echo -e "${DIM}  Standalone binary installer${RESET}"
  echo ""
}

# --- Detect OS and Architecture ---
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    CYGWIN*|MINGW*|MSYS*) os="windows" ;;
    *)
      error "Unsupported operating system: $(uname -s)"
      error "Supported: Linux, macOS, Windows (WSL recommended)"
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    arm64|aarch64)  arch="arm64" ;;
    armv7l)
      error "32-bit ARM is not supported. Use a 64-bit ARM system."
      exit 1
      ;;
    *)
      error "Unsupported architecture: $(uname -m)"
      error "Supported: x86_64, arm64"
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

# --- Check for required tools ---
check_requirements() {
  local missing=()

  if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    missing+=("curl or wget")
  fi

  if ! command -v git &>/dev/null; then
    warn "git is not installed. Tamma requires git at runtime."
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required tools: ${missing[*]}"
    exit 1
  fi
}

# --- Download helper (supports curl and wget, respects proxy) ---
download() {
  local url="$1"
  local output="$2"

  if command -v curl &>/dev/null; then
    curl -fsSL ${HTTPS_PROXY:+--proxy "${HTTPS_PROXY}"} \
      -o "${output}" "${url}"
  elif command -v wget &>/dev/null; then
    wget -q ${HTTPS_PROXY:+-e "https_proxy=${HTTPS_PROXY}"} \
      -O "${output}" "${url}"
  fi
}

# --- Fetch helper for API calls ---
fetch() {
  local url="$1"

  if command -v curl &>/dev/null; then
    curl -fsSL ${HTTPS_PROXY:+--proxy "${HTTPS_PROXY}"} \
      ${GITHUB_TOKEN:+-H "Authorization: Bearer ${GITHUB_TOKEN}"} \
      "${url}"
  elif command -v wget &>/dev/null; then
    wget -qO- ${HTTPS_PROXY:+-e "https_proxy=${HTTPS_PROXY}"} \
      ${GITHUB_TOKEN:+--header="Authorization: Bearer ${GITHUB_TOKEN}"} \
      "${url}"
  fi
}

# --- Resolve version ---
resolve_version() {
  local version="${TAMMA_VERSION:-}"

  if [ -n "${version}" ]; then
    # Strip leading 'v' if present
    version="${version#v}"
    echo "${version}"
    return
  fi

  # Parse --version argument
  for arg in "$@"; do
    case "${arg}" in
      --version=*) version="${arg#*=}"; version="${version#v}"; echo "${version}"; return ;;
      --version)   shift_next=true ;;
      *)
        if [ "${shift_next:-false}" = true ]; then
          version="${arg#v}"
          echo "${version}"
          return
        fi
        ;;
    esac
  done

  # Fetch latest release from GitHub
  info "Fetching latest version..."
  local release_info
  release_info="$(fetch "${GITHUB_API}/repos/${REPO}/releases/latest")"

  if [ -z "${release_info}" ]; then
    error "Failed to fetch latest release from GitHub."
    error "You may be rate-limited. Set GITHUB_TOKEN or use --version to specify a version."
    exit 1
  fi

  # Parse tag_name from JSON (portable, no jq dependency)
  version="$(echo "${release_info}" | grep -o '"tag_name":\s*"[^"]*"' | head -1 | cut -d'"' -f4)"
  version="${version#v}"

  if [ -z "${version}" ]; then
    error "Could not determine latest version from GitHub API response."
    exit 1
  fi

  echo "${version}"
}

# --- Verify checksum ---
verify_checksum() {
  local file="$1"
  local expected="$2"

  if [ -z "${expected}" ]; then
    warn "No checksum available for verification. Skipping."
    return 0
  fi

  local actual
  if command -v sha256sum &>/dev/null; then
    actual="$(sha256sum "${file}" | cut -d' ' -f1)"
  elif command -v shasum &>/dev/null; then
    actual="$(shasum -a 256 "${file}" | cut -d' ' -f1)"
  else
    warn "Neither sha256sum nor shasum found. Skipping checksum verification."
    return 0
  fi

  if [ "${actual}" != "${expected}" ]; then
    error "Checksum verification failed!"
    error "  Expected: ${expected}"
    error "  Actual:   ${actual}"
    error ""
    error "The downloaded binary may be corrupted or tampered with."
    error "Please try again or report this issue."
    rm -f "${file}"
    exit 1
  fi

  success "Checksum verified"
}

# --- Ensure install directory is in PATH ---
ensure_in_path() {
  local dir="$1"

  # Check if already in PATH
  case ":${PATH}:" in
    *":${dir}:"*) return 0 ;;
  esac

  warn "${dir} is not in your PATH."
  echo ""

  # Detect shell and suggest fix
  local shell_name
  shell_name="$(basename "${SHELL:-/bin/bash}")"
  local rc_file

  case "${shell_name}" in
    zsh)  rc_file="${HOME}/.zshrc" ;;
    bash)
      if [ -f "${HOME}/.bash_profile" ]; then
        rc_file="${HOME}/.bash_profile"
      else
        rc_file="${HOME}/.bashrc"
      fi
      ;;
    fish) rc_file="${HOME}/.config/fish/config.fish" ;;
    *)    rc_file="${HOME}/.profile" ;;
  esac

  local path_line
  if [ "${shell_name}" = "fish" ]; then
    path_line="fish_add_path ${dir}"
  else
    path_line="export PATH=\"${dir}:\$PATH\""
  fi

  info "Add this to ${rc_file}:"
  echo ""
  echo "  ${path_line}"
  echo ""

  # Offer to add it automatically
  if [ -t 0 ]; then
    printf "Add to %s now? [Y/n] " "${rc_file}"
    read -r response
    case "${response}" in
      [nN]*)
        info "Skipped. Add it manually to use tamma from anywhere."
        ;;
      *)
        echo "" >> "${rc_file}"
        echo "# Tamma CLI" >> "${rc_file}"
        echo "${path_line}" >> "${rc_file}"
        success "Added to ${rc_file}. Run 'source ${rc_file}' or open a new terminal."
        ;;
    esac
  else
    info "Run: ${path_line}"
  fi
}

# --- Main ---
main() {
  banner

  local platform version asset_name download_url checksum_url

  check_requirements
  platform="$(detect_platform)"
  info "Detected platform: ${BOLD}${platform}${RESET}"

  version="$(resolve_version "$@")"
  info "Installing version: ${BOLD}v${version}${RESET}"

  # Construct download URLs
  local ext=""
  if [[ "${platform}" == windows-* ]]; then
    ext=".exe"
  fi
  asset_name="tamma-${version}-${platform}${ext}"
  download_url="${GITHUB_DOWNLOAD}/${REPO}/releases/download/v${version}/${asset_name}"
  checksum_url="${GITHUB_DOWNLOAD}/${REPO}/releases/download/v${version}/${asset_name}.sha256"

  # Create temp directory
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  # Download binary
  info "Downloading ${asset_name}..."
  if ! download "${download_url}" "${tmp_dir}/${asset_name}"; then
    error "Download failed."
    error "URL: ${download_url}"
    error ""
    error "Possible causes:"
    error "  - Version v${version} does not exist"
    error "  - No binary available for ${platform}"
    error "  - Network/proxy issues"
    exit 1
  fi
  success "Downloaded $(du -h "${tmp_dir}/${asset_name}" | cut -f1 | xargs) binary"

  # Download and verify checksum
  info "Verifying checksum..."
  local expected_hash=""
  if download "${checksum_url}" "${tmp_dir}/${asset_name}.sha256" 2>/dev/null; then
    expected_hash="$(cut -d' ' -f1 < "${tmp_dir}/${asset_name}.sha256")"
  fi
  verify_checksum "${tmp_dir}/${asset_name}" "${expected_hash}"

  # Install
  info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
  mkdir -p "${INSTALL_DIR}"

  # Atomic install: write to temp location then move
  local target="${INSTALL_DIR}/${BINARY_NAME}${ext}"
  cp "${tmp_dir}/${asset_name}" "${target}.tmp"
  chmod +x "${target}.tmp"
  mv -f "${target}.tmp" "${target}"
  success "Installed ${target}"

  # Verify installation
  if "${target}" --version &>/dev/null; then
    local installed_version
    installed_version="$("${target}" --version 2>/dev/null || echo "unknown")"
    success "Verified: tamma ${installed_version}"
  else
    warn "Binary installed but could not verify. Try running: ${target} --version"
  fi

  # PATH check
  ensure_in_path "${INSTALL_DIR}"

  echo ""
  echo -e "${GREEN}${BOLD}Tamma installed successfully!${RESET}"
  echo ""
  echo "  Get started:"
  echo "    cd your-project"
  echo "    tamma init        # Interactive setup wizard"
  echo "    tamma start       # Start processing issues"
  echo ""
  echo -e "  ${DIM}Docs: https://github.com/${REPO}#readme${RESET}"
  echo ""
}

main "$@"
```

### 3.1 Script Features Summary

| Feature | Implementation |
|---------|---------------|
| OS detection | `uname -s` (Linux, Darwin, CYGWIN/MINGW) |
| Arch detection | `uname -m` (x86_64, arm64, aarch64) |
| Download | curl (preferred) with wget fallback |
| Checksum verification | sha256sum / shasum -a 256 |
| Proxy support | `HTTPS_PROXY` env var forwarded to curl/wget |
| Version pinning | `--version X.Y.Z` flag or `TAMMA_VERSION` env |
| Custom install dir | `TAMMA_INSTALL_DIR` env (default: `~/.local/bin`) |
| PATH management | Auto-detect shell RC file, offer to add PATH entry |
| Atomic install | Write to `.tmp`, then `mv` to avoid partial binary |
| GitHub rate limits | Supports `GITHUB_TOKEN` env for authenticated API calls |
| No jq dependency | Parses JSON with grep/cut for portability |
| Colorized output | Respects `NO_COLOR` env and TTY detection |
| Cleanup | `trap` ensures temp directory is removed on exit |

---

## 4. Windows PowerShell Variant (install.ps1)

```powershell
#Requires -Version 5.1
<#
.SYNOPSIS
    Tamma CLI installer for Windows.

.DESCRIPTION
    Downloads and installs the Tamma standalone binary.

.EXAMPLE
    irm https://raw.githubusercontent.com/meywd/tamma/main/install.ps1 | iex

.EXAMPLE
    $env:TAMMA_VERSION = "0.2.0"; irm https://raw.githubusercontent.com/meywd/tamma/main/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"

$Repo = "meywd/tamma"
$BinaryName = "tamma.exe"
$DefaultInstallDir = "$env:USERPROFILE\.local\bin"
$InstallDir = if ($env:TAMMA_INSTALL_DIR) { $env:TAMMA_INSTALL_DIR } else { $DefaultInstallDir }

function Write-Banner {
    Write-Host ""
    Write-Host "  ╔╦╗╔═╗╔╦╗╔╦╗╔═╗" -ForegroundColor Cyan
    Write-Host "   ║ ╠═╣║║║║║║╠═╣" -ForegroundColor Cyan
    Write-Host "   ╩ ╩ ╩╩ ╩╩ ╩╩ ╩" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Standalone binary installer" -ForegroundColor DarkGray
    Write-Host ""
}

function Get-Platform {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64"   { return "windows-x64" }
        "Arm64" { return "windows-arm64" }
        default {
            Write-Error "Unsupported architecture: $arch"
            exit 1
        }
    }
}

function Get-LatestVersion {
    if ($env:TAMMA_VERSION) {
        return $env:TAMMA_VERSION.TrimStart("v")
    }

    Write-Host "info  Fetching latest version..." -ForegroundColor Cyan
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
        -Headers @{ "User-Agent" = "tamma-installer" }
    return $release.tag_name.TrimStart("v")
}

function Test-Checksum {
    param(
        [string]$FilePath,
        [string]$Expected
    )

    if (-not $Expected) {
        Write-Host "warn  No checksum available. Skipping verification." -ForegroundColor Yellow
        return
    }

    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $Expected.ToLower()) {
        Write-Error "Checksum mismatch! Expected: $Expected, Got: $actual"
        Remove-Item -Path $FilePath -Force
        exit 1
    }

    Write-Host "ok    Checksum verified" -ForegroundColor Green
}

function Add-ToPath {
    param([string]$Dir)

    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -split ";" -contains $Dir) {
        return
    }

    Write-Host "warn  $Dir is not in your PATH." -ForegroundColor Yellow
    $response = Read-Host "Add to user PATH? [Y/n]"
    if ($response -ne "n" -and $response -ne "N") {
        [Environment]::SetEnvironmentVariable(
            "Path",
            "$Dir;$currentPath",
            "User"
        )
        $env:Path = "$Dir;$env:Path"
        Write-Host "ok    Added to PATH. Restart your terminal to apply." -ForegroundColor Green
    }
}

# --- Main ---
Write-Banner

$platform = Get-Platform
Write-Host "info  Platform: $platform" -ForegroundColor Cyan

$version = Get-LatestVersion
Write-Host "info  Version: v$version" -ForegroundColor Cyan

$assetName = "tamma-$version-$platform.exe"
$downloadUrl = "https://github.com/$Repo/releases/download/v$version/$assetName"
$checksumUrl = "https://github.com/$Repo/releases/download/v$version/$assetName.sha256"

# Download
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "tamma-install-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {
    Write-Host "info  Downloading $assetName..." -ForegroundColor Cyan
    $tmpFile = Join-Path $tmpDir $assetName
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpFile -UseBasicParsing

    # Checksum
    $expectedHash = ""
    try {
        $checksumContent = Invoke-WebRequest -Uri $checksumUrl -UseBasicParsing
        $expectedHash = ($checksumContent.Content -split "\s+")[0]
    } catch {
        Write-Host "warn  Could not download checksum file." -ForegroundColor Yellow
    }
    Test-Checksum -FilePath $tmpFile -Expected $expectedHash

    # Install
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $target = Join-Path $InstallDir $BinaryName
    Copy-Item -Path $tmpFile -Destination $target -Force
    Write-Host "ok    Installed to $target" -ForegroundColor Green

    # PATH
    Add-ToPath -Dir $InstallDir

    Write-Host ""
    Write-Host "  Tamma installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Get started:"
    Write-Host "    cd your-project"
    Write-Host "    tamma init"
    Write-Host "    tamma start"
    Write-Host ""
}
finally {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
```

---

## 5. GitHub Releases Pipeline

### 5.1 Release Workflow

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    name: Build ${{ matrix.platform }}
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: darwin-arm64
            runner: macos-14
            target: bun-darwin-arm64
          - platform: darwin-x64
            runner: macos-13
            target: bun-darwin-x64
          - platform: linux-x64
            runner: ubuntu-latest
            target: bun-linux-x64
          - platform: linux-arm64
            runner: ubuntu-24.04-arm
            target: bun-linux-arm64
          # Uncomment when Windows support is ready:
          # - platform: windows-x64
          #   runner: windows-latest
          #   target: bun-windows-x64
          #   ext: .exe

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Build binary
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          EXT="${{ matrix.ext || '' }}"
          ASSET_NAME="tamma-${VERSION}-${{ matrix.platform }}${EXT}"

          bun build --compile --minify --sourcemap \
            packages/cli/src/index.tsx \
            --target=${{ matrix.target }} \
            --outfile "dist/${ASSET_NAME}"

          # Generate checksum
          cd dist
          if command -v sha256sum &>/dev/null; then
            sha256sum "${ASSET_NAME}" > "${ASSET_NAME}.sha256"
          else
            shasum -a 256 "${ASSET_NAME}" > "${ASSET_NAME}.sha256"
          fi
        shell: bash

      - name: Smoke test (native platform only)
        if: |
          (matrix.platform == 'linux-x64' && runner.os == 'Linux') ||
          (matrix.platform == 'darwin-arm64' && runner.os == 'macOS') ||
          (matrix.platform == 'darwin-x64' && runner.os == 'macOS')
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          ASSET_NAME="tamma-${VERSION}-${{ matrix.platform }}"
          chmod +x "dist/${ASSET_NAME}"
          "dist/${ASSET_NAME}" --version
          "dist/${ASSET_NAME}" --help

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: binary-${{ matrix.platform }}
          path: |
            dist/tamma-*
          retention-days: 1

  release:
    name: Create Release
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Generate manifest
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          cd artifacts

          # Collect all checksums into a single file
          cat *.sha256 > "tamma-${VERSION}-checksums.txt"

          # Generate manifest.json
          echo '{' > manifest.json
          echo "  \"version\": \"${VERSION}\"," >> manifest.json
          echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> manifest.json
          echo '  "assets": {' >> manifest.json

          first=true
          for sha_file in tamma-${VERSION}-*.sha256; do
            platform="${sha_file#tamma-${VERSION}-}"
            platform="${platform%.sha256}"
            platform="${platform%.exe}"
            hash="$(cut -d' ' -f1 < "${sha_file}")"
            binary="${sha_file%.sha256}"
            size="$(stat -c%s "${binary}" 2>/dev/null || stat -f%z "${binary}")"

            if [ "$first" = true ]; then
              first=false
            else
              echo "," >> manifest.json
            fi
            printf '    "%s": {"sha256": "%s", "size": %s}' \
              "${platform}" "${hash}" "${size}" >> manifest.json
          done

          echo '' >> manifest.json
          echo '  }' >> manifest.json
          echo '}' >> manifest.json

          cat manifest.json

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}
          generate_release_notes: true
          files: |
            artifacts/tamma-*
            artifacts/manifest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # Verify the install script works against the new release
  verify-installer:
    name: Verify Installer (${{ matrix.os }})
    needs: release
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-14, macos-13]
    steps:
      - name: Checkout (for install script)
        uses: actions/checkout@v4

      - name: Run installer
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          TAMMA_VERSION="${VERSION}" TAMMA_INSTALL_DIR="${HOME}/.local/bin" \
            bash install.sh

      - name: Verify binary
        run: |
          export PATH="${HOME}/.local/bin:${PATH}"
          tamma --version
          tamma --help
```

### 5.2 Asset Naming Convention

```
tamma-{version}-{os}-{arch}[.exe]
tamma-{version}-{os}-{arch}[.exe].sha256
```

Examples for version 0.2.0:
```
tamma-0.2.0-darwin-arm64
tamma-0.2.0-darwin-arm64.sha256
tamma-0.2.0-darwin-x64
tamma-0.2.0-darwin-x64.sha256
tamma-0.2.0-linux-x64
tamma-0.2.0-linux-x64.sha256
tamma-0.2.0-linux-arm64
tamma-0.2.0-linux-arm64.sha256
tamma-0.2.0-checksums.txt       # All checksums in one file
manifest.json                    # Machine-readable manifest
```

### 5.3 Signing Considerations

For the initial release, SHA256 checksums provide tamper detection. Future enhancements:

| Level | Mechanism | When |
|-------|-----------|------|
| L0 (now) | SHA256 checksums per asset | v0.2.0 |
| L1 | Sigstore/cosign keyless signatures | v0.3.0 |
| L2 | Apple notarization for macOS | v0.4.0 |
| L3 | Windows Authenticode signing | If Windows demand materializes |

Sigstore integration example for the future:

```yaml
- name: Sign with cosign
  uses: sigstore/cosign-installer@v3

- name: Sign binary
  run: |
    cosign sign-blob --yes \
      --bundle "dist/${ASSET_NAME}.cosign-bundle" \
      "dist/${ASSET_NAME}"
```

---

## 6. Auto-Update Mechanism

### 6.1 `tamma upgrade` Command

Add to `packages/cli/src/commands/upgrade.ts`:

```typescript
import { execSync } from 'node:child_process';
import { createWriteStream, renameSync, unlinkSync, chmodSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { VERSION } from '../version.js';

interface ReleaseInfo {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function detectPlatform(): string {
  const os = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'windows'
    : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

export async function upgradeCommand(options: { force?: boolean }): Promise<void> {
  const currentVersion = VERSION;
  console.log(`Current version: v${currentVersion}`);

  // Fetch latest release
  const response = await fetch(
    'https://api.github.com/repos/meywd/tamma/releases/latest',
    { headers: { 'User-Agent': 'tamma-cli' } }
  );

  if (!response.ok) {
    console.error(`Failed to check for updates: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const release: ReleaseInfo = await response.json();
  const latestVersion = release.tag_name.replace(/^v/, '');

  if (latestVersion === currentVersion && !options.force) {
    console.log(`Already on the latest version (v${currentVersion}).`);
    return;
  }

  console.log(`New version available: v${latestVersion}`);

  // Find the correct asset
  const platform = detectPlatform();
  const ext = platform.startsWith('windows') ? '.exe' : '';
  const assetName = `tamma-${latestVersion}-${platform}${ext}`;

  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    console.error(`No binary available for ${platform}. Available assets:`);
    for (const a of release.assets) {
      console.error(`  - ${a.name}`);
    }
    process.exit(1);
  }

  // Download checksum
  const checksumAsset = release.assets.find((a) => a.name === `${assetName}.sha256`);
  let expectedHash: string | null = null;
  if (checksumAsset) {
    const checksumResponse = await fetch(checksumAsset.browser_download_url);
    const checksumText = await checksumResponse.text();
    expectedHash = checksumText.split(/\s+/)[0] ?? null;
  }

  // Download binary to temp location
  const currentBinary = process.execPath;
  const tmpPath = `${currentBinary}.update`;

  console.log(`Downloading ${assetName}...`);
  const downloadResponse = await fetch(asset.browser_download_url);
  if (!downloadResponse.ok || !downloadResponse.body) {
    console.error('Download failed.');
    process.exit(1);
  }

  const writeStream = createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(downloadResponse.body as any), writeStream);

  // Verify checksum
  if (expectedHash) {
    const fileBuffer = await Bun.file(tmpPath).arrayBuffer();
    const hash = createHash('sha256').update(Buffer.from(fileBuffer)).digest('hex');
    if (hash !== expectedHash) {
      console.error('Checksum verification failed. Aborting update.');
      unlinkSync(tmpPath);
      process.exit(1);
    }
    console.log('Checksum verified.');
  }

  // Atomic replacement
  chmodSync(tmpPath, 0o755);

  // On Unix: rename is atomic. On Windows: rename the old first, then the new.
  if (process.platform === 'win32') {
    const backupPath = `${currentBinary}.old`;
    try { unlinkSync(backupPath); } catch { /* ignore */ }
    renameSync(currentBinary, backupPath);
    renameSync(tmpPath, currentBinary);
    try { unlinkSync(backupPath); } catch { /* ignore, locked file */ }
  } else {
    renameSync(tmpPath, currentBinary);
  }

  console.log(`Updated to v${latestVersion}`);
  console.log('Restart tamma to use the new version.');
}
```

### 6.2 Background Update Check

Add a non-blocking update check on startup that runs after the command starts:

```typescript
// packages/cli/src/update-check.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { VERSION } from './version.js';

const STATE_DIR = join(homedir(), '.local', 'state', 'tamma');
const CHECK_FILE = join(STATE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateState {
  lastCheck: number;
  latestVersion: string | null;
}

function readState(): UpdateState {
  try {
    if (existsSync(CHECK_FILE)) {
      return JSON.parse(readFileSync(CHECK_FILE, 'utf-8'));
    }
  } catch { /* corrupt file, reset */ }
  return { lastCheck: 0, latestVersion: null };
}

function writeState(state: UpdateState): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(CHECK_FILE, JSON.stringify(state));
  } catch { /* non-critical */ }
}

/**
 * Perform a background update check. Non-blocking, never throws.
 * Returns a message to display if an update is available, or null.
 */
export async function checkForUpdates(): Promise<string | null> {
  try {
    const state = readState();

    // Check at most once per day
    if (Date.now() - state.lastCheck < CHECK_INTERVAL_MS) {
      if (state.latestVersion && state.latestVersion !== VERSION) {
        return `Update available: v${VERSION} -> v${state.latestVersion}. Run: tamma upgrade`;
      }
      return null;
    }

    // Fetch with a short timeout so it doesn't block startup
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(
      'https://api.github.com/repos/meywd/tamma/releases/latest',
      {
        headers: { 'User-Agent': 'tamma-update-check' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      writeState({ lastCheck: Date.now(), latestVersion: null });
      return null;
    }

    const data = await response.json() as { tag_name: string };
    const latest = data.tag_name.replace(/^v/, '');

    writeState({ lastCheck: Date.now(), latestVersion: latest });

    if (latest !== VERSION) {
      return `Update available: v${VERSION} -> v${latest}. Run: tamma upgrade`;
    }

    return null;
  } catch {
    return null;
  }
}
```

Usage in `index.tsx`:

```typescript
// Fire-and-forget update check (non-blocking)
void checkForUpdates().then((msg) => {
  if (msg) {
    console.log(`\n  ${msg}\n`);
  }
});
```

### 6.3 Version Comparison

Use simple semver comparison (no external dependency):

```typescript
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

---

## 7. Homebrew Formula

### 7.1 Creating the Tap Repository

Create a separate repository `meywd/homebrew-tap` (GitHub convention: `homebrew-` prefix
enables `brew tap meywd/tap`).

### 7.2 Formula Template

File: `meywd/homebrew-tap/Formula/tamma.rb`

```ruby
class Tamma < Formula
  desc "AI-powered autonomous development orchestration platform"
  homepage "https://github.com/meywd/tamma"
  version "0.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/meywd/tamma/releases/download/v#{version}/tamma-#{version}-darwin-arm64"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/meywd/tamma/releases/download/v#{version}/tamma-#{version}-darwin-x64"
      sha256 "PLACEHOLDER_SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/meywd/tamma/releases/download/v#{version}/tamma-#{version}-linux-arm64"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/meywd/tamma/releases/download/v#{version}/tamma-#{version}-linux-x64"
      sha256 "PLACEHOLDER_SHA256_LINUX_X64"
    end
  end

  def install
    binary_name = "tamma-#{version}-#{OS.mac? ? "darwin" : "linux"}-#{Hardware::CPU.arm? ? "arm64" : "x64"}"
    bin.install binary_name => "tamma"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tamma --version")
  end
end
```

### 7.3 Automated Formula Updates

Add a step to the release workflow that updates the Homebrew formula:

```yaml
  update-homebrew:
    name: Update Homebrew Formula
    needs: release
    runs-on: ubuntu-latest
    steps:
      - name: Checkout tap repo
        uses: actions/checkout@v4
        with:
          repository: meywd/homebrew-tap
          token: ${{ secrets.TAP_GITHUB_TOKEN }}

      - name: Download manifest
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          curl -fsSL "https://github.com/meywd/tamma/releases/download/v${VERSION}/manifest.json" \
            -o manifest.json

      - name: Update formula
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          # Parse checksums from manifest (using jq here since we control this environment)
          DARWIN_ARM64=$(jq -r '.assets["darwin-arm64"].sha256' manifest.json)
          DARWIN_X64=$(jq -r '.assets["darwin-x64"].sha256' manifest.json)
          LINUX_ARM64=$(jq -r '.assets["linux-arm64"].sha256' manifest.json)
          LINUX_X64=$(jq -r '.assets["linux-x64"].sha256' manifest.json)

          sed -i "s/version \".*\"/version \"${VERSION}\"/" Formula/tamma.rb
          sed -i "s/PLACEHOLDER_SHA256_DARWIN_ARM64/${DARWIN_ARM64}/" Formula/tamma.rb
          sed -i "s/PLACEHOLDER_SHA256_DARWIN_X64/${DARWIN_X64}/" Formula/tamma.rb
          sed -i "s/PLACEHOLDER_SHA256_LINUX_ARM64/${LINUX_ARM64}/" Formula/tamma.rb
          sed -i "s/PLACEHOLDER_SHA256_LINUX_X64/${LINUX_X64}/" Formula/tamma.rb

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add Formula/tamma.rb
          git commit -m "tamma ${GITHUB_REF_NAME}"
          git push
```

Users install via:
```bash
brew tap meywd/tap
brew install tamma
```

---

## 8. First-Run Experience

### 8.1 Differences for Binary Users vs npm Users

| Aspect | npm install | curl binary |
|--------|------------|-------------|
| Prerequisites | Node.js 22, pnpm, npm | None (git recommended) |
| Install command | `npm i -g @tamma/cli` | `curl -fsSL .../install.sh \| bash` |
| Binary location | `$(npm prefix -g)/bin/tamma` | `~/.local/bin/tamma` |
| Update | `npm update -g @tamma/cli` | `tamma upgrade` |
| Node.js check in preflight | Required (checks `process.version >= 22`) | Skipped (Bun runtime embedded) |
| `tamma init` | Identical experience | Identical experience |
| `tamma start` | Identical experience | Identical experience |
| `tamma server` | Identical experience | Identical experience |

### 8.2 Preflight Adjustments

The current `checkNodeVersion()` preflight check validates Node.js >= 22. For binary users, this
check is irrelevant (the Bun runtime is embedded). We need to detect the execution mode:

```typescript
// packages/cli/src/preflight.ts

export function isStandaloneBinary(): boolean {
  // Bun standalone binaries set this
  return typeof Bun !== 'undefined' && Bun.main === process.execPath;
}

export function checkNodeVersion(): PreflightCheck {
  if (isStandaloneBinary()) {
    return {
      name: 'Runtime',
      passed: true,
      required: true,
      message: `Tamma standalone binary (Bun ${Bun.version})`,
    };
  }

  // Existing Node.js version check...
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]!, 10);
  const passed = major >= 22;
  return {
    name: 'Node.js >= 22',
    passed,
    required: true,
    message: passed
      ? `Node.js ${version}`
      : `Node.js ${version} detected - v22+ required`,
  };
}
```

### 8.3 Version Embedding

The current `index.tsx` reads version from `package.json` via `createRequire`. In the binary, there
is no `package.json` on disk. Instead, we read from a generated constant:

```typescript
// packages/cli/src/version.ts (generated at build time)
export const VERSION = '0.1.0';
```

The build script writes this file before compilation:

```bash
VERSION=$(jq -r .version packages/cli/package.json)
echo "export const VERSION = '${VERSION}';" > packages/cli/src/version.ts
```

Then `index.tsx` is updated:

```typescript
// Replace:
// const require = createRequire(import.meta.url);
// const pkg = require('../package.json') as { version: string };

// With:
import { VERSION } from './version.js';

// And use VERSION instead of pkg.version
```

---

## 9. Testing Strategy

### 9.1 CI Matrix for Binary Builds

Every PR that touches `packages/cli/**`, `packages/orchestrator/**`, `packages/shared/**`,
or `scripts/build-binary.ts` triggers a binary build + smoke test job:

```yaml
# .github/workflows/ci.yml (addition)
  binary-smoke-test:
    name: Binary Smoke Test (${{ matrix.platform }})
    if: |
      github.event_name == 'push' ||
      contains(github.event.pull_request.labels.*.name, 'test-binary')
    runs-on: ${{ matrix.runner }}
    strategy:
      matrix:
        include:
          - platform: darwin-arm64
            runner: macos-14
          - platform: linux-x64
            runner: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Build binary
        run: |
          bun build --compile --minify \
            packages/cli/src/index.tsx \
            --outfile dist/tamma

      - name: Smoke tests
        run: |
          chmod +x dist/tamma

          # Test 1: Version output
          dist/tamma --version

          # Test 2: Help output
          dist/tamma --help

          # Test 3: Init shows preflight (will fail on missing git repo, but should not crash)
          cd /tmp && mkdir -p tamma-smoke && cd tamma-smoke && git init
          dist/tamma init 2>&1 || true

          # Test 4: Binary file type check
          file dist/tamma
```

### 9.2 Integration Test Suite

Create `packages/cli/src/cli.binary.test.ts` (run manually or in CI):

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BINARY = resolve(__dirname, '../../../dist/binaries/tamma');

describe.skipIf(!existsSync(BINARY))('Binary integration tests', () => {
  it('prints version', () => {
    const output = execSync(`${BINARY} --version`, { encoding: 'utf-8' });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help', () => {
    const output = execSync(`${BINARY} --help`, { encoding: 'utf-8' });
    expect(output).toContain('tamma');
    expect(output).toContain('start');
    expect(output).toContain('init');
    expect(output).toContain('server');
  });

  it('exits with error on missing config', () => {
    try {
      execSync(`${BINARY} start --config /nonexistent/path.json`, {
        encoding: 'utf-8',
        cwd: '/tmp',
      });
      expect.unreachable();
    } catch (err: any) {
      expect(err.status).not.toBe(0);
    }
  });

  it('runs preflight checks', () => {
    const output = execSync(`${BINARY} status 2>&1`, { encoding: 'utf-8' });
    // Should not crash even without config
    expect(output).toBeDefined();
  });
});
```

### 9.3 Installer Script Tests

Test the install script itself in CI using a matrix:

```yaml
  test-installer:
    name: Test install.sh (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-14, macos-13]
    steps:
      - uses: actions/checkout@v4

      # Test: script parses correctly
      - name: Shellcheck
        if: runner.os == 'Linux'
        run: shellcheck install.sh

      # Test: OS/arch detection
      - name: Test platform detection
        run: |
          # Source the script functions
          source <(sed -n '/^detect_platform/,/^}/p' install.sh)
          PLATFORM=$(detect_platform)
          echo "Detected: ${PLATFORM}"
          [[ "${PLATFORM}" =~ ^(darwin|linux)-(x64|arm64)$ ]]
```

---

## 10. Risks and Mitigations

### 10.1 Bun Compatibility

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Ink/yoga-wasm incompatibility | Low | High | Tested in OpenCode; add smoke test in CI. Fallback: headless mode without Ink. |
| `pino` worker thread bundling | Medium | Medium | Use custom `createSimpleLogger` for binary mode (Option 2 in section 2.6). |
| `@octokit/rest` or `@anthropic-ai/sdk` fetch API differences | Low | Medium | Both use standard `fetch()` which Bun supports natively. Test in smoke tests. |
| `node:child_process` behavior differences | Low | Low | Bun's `child_process` is mature. `execSync`/`execFileSync` used in preflight are well-tested. |
| Workspace resolution during `bun build` | Medium | High | Fallback: two-stage build with esbuild pre-bundle (section 2.8). |

### 10.2 Binary Size

| Risk | Mitigation |
|------|------------|
| Binary >100 MB | Use `--minify`, tree-shake unused exports. Profile with `bun build --compile --verbose`. Remove `pino-pretty` (only used in dev). |
| Slow download on poor connections | Compress with gzip/zstd for release assets. Show download progress in install script. |
| macOS Gatekeeper blocks unsigned binary | Add clear instructions: `xattr -d com.apple.quarantine ./tamma`. Long-term: Apple notarization. |

### 10.3 Platform Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Rosetta 2 (x64 on arm64 Mac) | `uname -m` reports `x86_64` under Rosetta. Script downloads x64 binary correctly. |
| musl Linux (Alpine) | Bun ships glibc-linked binaries. Alpine users need `apk add libc6-compat` or use Docker. Document this. |
| WSL | `uname -s` returns `Linux` in WSL. Script correctly downloads Linux binary, which works. |
| SELinux | Binary may need `restorecon` or appropriate context. Document in troubleshooting. |
| Read-only /home | User can set `TAMMA_INSTALL_DIR=/usr/local/bin` (may need sudo). |
| Corporate proxy | Install script respects `HTTPS_PROXY`. Documented in usage comments. |
| GitHub rate limit (unauthenticated) | 60 requests/hour. Script suggests `GITHUB_TOKEN` if rate-limited. |

### 10.4 Maintenance Burden

| Risk | Mitigation |
|------|------------|
| Two build systems (tsc for dev, bun for binary) | Build script is self-contained. CI validates both paths. |
| Bun version drift | Pin Bun version in CI. Update quarterly. |
| Formula/script staleness | Automated formula update in release workflow. install.sh fetches latest dynamically. |

---

## 11. Implementation Steps

### Phase 1: Build Infrastructure (3-4 days)

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 1.1 | Create `packages/cli/src/version.ts` and update `index.tsx` to use it instead of `createRequire` for package.json version | 0.5h | None |
| 1.2 | Create `createSimpleLogger` in `packages/observability` that writes to stderr without pino, usable as a pino-free fallback | 1h | None |
| 1.3 | Add `isStandaloneBinary()` detection to `preflight.ts` and skip Node.js version check for binary mode | 0.5h | 1.1 |
| 1.4 | Create `scripts/build-binary.ts` build script | 2h | 1.1, 1.2 |
| 1.5 | Test local `bun build --compile` for current platform, debug any bundling issues (Ink, yoga, workspace resolution) | 4h | 1.4 |
| 1.6 | If workspace resolution fails, implement two-stage esbuild + bun build fallback | 2h | 1.5 |

### Phase 2: Install Scripts (2 days)

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 2.1 | Create `install.sh` at repo root | 2h | None |
| 2.2 | Create `install.ps1` at repo root | 1.5h | None |
| 2.3 | Add shellcheck to CI for `install.sh` | 0.5h | 2.1 |
| 2.4 | Test install script locally on macOS and Linux (VM or Docker) | 2h | 2.1 |

### Phase 3: Release Pipeline (2 days)

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 3.1 | Create `.github/workflows/release.yml` with matrix build | 3h | 1.4 |
| 3.2 | Add binary smoke test job to existing CI workflow | 1h | 1.5 |
| 3.3 | Add installer verification job to release workflow | 1h | 2.1, 3.1 |
| 3.4 | Test full release flow with a `v0.1.0-rc.1` tag | 2h | 3.1, 3.2, 3.3 |

### Phase 4: Auto-Update (1 day)

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 4.1 | Implement `tamma upgrade` command | 2h | 1.1 |
| 4.2 | Implement background update check (`update-check.ts`) | 1.5h | 1.1 |
| 4.3 | Wire `upgrade` command and update check into `index.tsx` | 0.5h | 4.1, 4.2 |
| 4.4 | Test upgrade flow end-to-end (mock GitHub release) | 1h | 4.3 |

### Phase 5: Homebrew (0.5 days)

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 5.1 | Create `meywd/homebrew-tap` repository with formula template | 1h | 3.4 |
| 5.2 | Add automated formula update step to release workflow | 1h | 5.1 |
| 5.3 | Test `brew tap meywd/tap && brew install tamma` | 0.5h | 5.2 |

### Phase 6: Documentation and Polish (1 day)

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 6.1 | Update README with curl install instructions | 1h | 3.4 |
| 6.2 | Add troubleshooting guide (Gatekeeper, musl, proxy) | 1h | 3.4 |
| 6.3 | Add `--version` output that shows build metadata (commit, date, platform) | 0.5h | 1.1 |
| 6.4 | Final cross-platform validation (macOS Intel, macOS ARM, Ubuntu, Alpine Docker) | 2h | All |

### Total Estimated Effort

| Phase | Days |
|-------|------|
| Phase 1: Build Infrastructure | 3-4 |
| Phase 2: Install Scripts | 2 |
| Phase 3: Release Pipeline | 2 |
| Phase 4: Auto-Update | 1 |
| Phase 5: Homebrew | 0.5 |
| Phase 6: Documentation | 1 |
| **Total** | **9.5-10.5 days** |

### Critical Path

```
1.1 -> 1.4 -> 1.5 -> 3.1 -> 3.4 -> 5.1
                               |
2.1 -> 2.4 -------------------> 3.3
```

The critical path runs through binary compilation validation (1.5) since that is the
highest-risk step. If `bun build --compile` works smoothly with all dependencies,
the rest is mechanical.
