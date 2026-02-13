#!/bin/sh
# install.sh - Install Tamma CLI from GitHub Releases
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/meywd/tamma/main/install.sh | sh
#
# Environment variables:
#   TAMMA_VERSION    - Specific version to install (default: latest)
#   TAMMA_INSTALL_DIR - Installation directory (default: $HOME/.local/bin)
#   HTTPS_PROXY      - Proxy for HTTPS requests
#   GITHUB_TOKEN     - GitHub token for API rate limiting
#   NO_COLOR         - Disable colored output when set
#
set -eu

# ── Constants ──────────────────────────────────────────────────────────────────

GITHUB_REPO="meywd/tamma"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
DOWNLOAD_BASE="https://github.com/${GITHUB_REPO}/releases/download"
INSTALL_DIR="${TAMMA_INSTALL_DIR:-${HOME}/.local/bin}"
TMPDIR_BASE="${TMPDIR:-/tmp}"

# ── Color helpers ──────────────────────────────────────────────────────────────

setup_colors() {
  if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    BOLD=""
    RESET=""
  else
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    RESET='\033[0m'
  fi
}

# ── Logging helpers ────────────────────────────────────────────────────────────

info() {
  printf "${BLUE}info${RESET}  %s\n" "$1"
}

success() {
  printf "${GREEN}ok${RESET}    %s\n" "$1"
}

warn() {
  printf "${YELLOW}warn${RESET}  %s\n" "$1" >&2
}

error() {
  printf "${RED}error${RESET} %s\n" "$1" >&2
}

# ── Cleanup trap ───────────────────────────────────────────────────────────────

TMPDIR_INSTALL=""

cleanup() {
  if [ -n "${TMPDIR_INSTALL}" ] && [ -d "${TMPDIR_INSTALL}" ]; then
    rm -rf "${TMPDIR_INSTALL}"
  fi
}

trap cleanup EXIT INT TERM

# ── Banner ─────────────────────────────────────────────────────────────────────

print_banner() {
  if [ -n "${NO_COLOR:-}" ]; then
    cat <<'BANNER'

  _____
 |_   _|_ _ _ __ ___  _ __ ___   __ _
   | |/ _` | '_ ` _ \| '_ ` _ \ / _` |
   | | (_| | | | | | | | | | | | (_| |
   |_|\__,_|_| |_| |_|_| |_| |_|\__,_|

  Autonomous Development Agent

BANNER
  else
    printf '%b' "${BOLD}"
    cat <<'BANNER'

  _____
 |_   _|_ _ _ __ ___  _ __ ___   __ _
   | |/ _` | '_ ` _ \| '_ ` _ \ / _` |
   | | (_| | | | | | | | | | | | (_| |
   |_|\__,_|_| |_| |_|_| |_| |_|\__,_|

BANNER
    printf '%b' "${RESET}"
    printf '  %bAutonomous Development Agent%b\n\n' "${BLUE}" "${RESET}"
  fi
}

# ── Platform detection ─────────────────────────────────────────────────────────

detect_os() {
  os="$(uname -s)"
  case "${os}" in
    Linux)  echo "linux" ;;
    Darwin) echo "darwin" ;;
    CYGWIN*|MINGW*|MSYS*)
      error "Windows is not supported by this installer."
      error "Please use the PowerShell installer instead:"
      error "  irm https://raw.githubusercontent.com/meywd/tamma/main/install.ps1 | iex"
      exit 1
      ;;
    *)
      error "Unsupported operating system: ${os}"
      exit 1
      ;;
  esac
}

detect_arch() {
  arch="$(uname -m)"
  case "${arch}" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)
      error "Unsupported architecture: ${arch}"
      exit 1
      ;;
  esac
}

# ── Download helpers ───────────────────────────────────────────────────────────

has_curl() {
  command -v curl >/dev/null 2>&1
}

has_wget() {
  command -v wget >/dev/null 2>&1
}

# Download a URL to a file. Uses curl if available, falls back to wget.
# $1 = URL, $2 = output file path, $3 = optional auth header value
download() {
  url="$1"
  output="$2"
  auth_header="${3:-}"

  if has_curl; then
    if [ -n "${auth_header}" ]; then
      curl -fsSL --proto '=https' -H "Authorization: ${auth_header}" -o "${output}" "${url}"
    elif [ -n "${HTTPS_PROXY:-}" ]; then
      curl -fsSL --proto '=https' --proxy "${HTTPS_PROXY}" -o "${output}" "${url}"
    else
      curl -fsSL --proto '=https' -o "${output}" "${url}"
    fi
  elif has_wget; then
    if [ -n "${auth_header}" ]; then
      wget -q --header="Authorization: ${auth_header}" -O "${output}" "${url}"
    elif [ -n "${HTTPS_PROXY:-}" ]; then
      https_proxy="${HTTPS_PROXY}" wget -q -O "${output}" "${url}"
    else
      wget -q -O "${output}" "${url}"
    fi
  else
    error "Neither curl nor wget found. Please install one and try again."
    exit 1
  fi
}

# Fetch a URL to stdout. Uses curl if available, falls back to wget.
# $1 = URL, $2 = optional auth header value
fetch() {
  url="$1"
  auth_header="${2:-}"

  if has_curl; then
    if [ -n "${auth_header}" ]; then
      curl -fsSL --proto '=https' -H "Authorization: ${auth_header}" "${url}"
    elif [ -n "${HTTPS_PROXY:-}" ]; then
      curl -fsSL --proto '=https' --proxy "${HTTPS_PROXY}" "${url}"
    else
      curl -fsSL --proto '=https' "${url}"
    fi
  elif has_wget; then
    if [ -n "${auth_header}" ]; then
      wget -q --header="Authorization: ${auth_header}" -O - "${url}"
    elif [ -n "${HTTPS_PROXY:-}" ]; then
      https_proxy="${HTTPS_PROXY}" wget -q -O - "${url}"
    else
      wget -q -O - "${url}"
    fi
  else
    error "Neither curl nor wget found. Please install one and try again."
    exit 1
  fi
}

# ── Version resolution ─────────────────────────────────────────────────────────

get_latest_version() {
  auth=""
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth="token ${GITHUB_TOKEN}"
  fi

  response="$(fetch "${GITHUB_API}" "${auth}")"

  # Extract tag_name from JSON using grep/sed (no jq dependency)
  # Matches: "tag_name": "v0.2.0"
  version="$(printf '%s' "${response}" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"v\{0,1\}\([^"]*\)".*/\1/')"

  if [ -z "${version}" ]; then
    error "Failed to determine latest version from GitHub API."
    error "This may be due to API rate limiting. Set GITHUB_TOKEN to increase the limit."
    exit 1
  fi

  # Strip leading 'v' if present
  version="$(printf '%s' "${version}" | sed 's/^v//')"

  printf '%s' "${version}"
}

# ── Checksum verification ─────────────────────────────────────────────────────

verify_checksum() {
  file="$1"
  expected_hash="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    actual_hash="$(sha256sum "${file}" | cut -d ' ' -f 1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual_hash="$(shasum -a 256 "${file}" | cut -d ' ' -f 1)"
  else
    warn "Neither sha256sum nor shasum found. Skipping checksum verification."
    return 0
  fi

  if [ "${actual_hash}" != "${expected_hash}" ]; then
    error "Checksum verification failed!"
    error "Expected: ${expected_hash}"
    error "Actual:   ${actual_hash}"
    error "The downloaded binary may be corrupted or tampered with."
    exit 1
  fi

  success "Checksum verified: ${actual_hash}"
}

# ── Shell RC detection ─────────────────────────────────────────────────────────

detect_shell_rc() {
  current_shell="$(basename "${SHELL:-sh}")"
  case "${current_shell}" in
    zsh)
      echo "${HOME}/.zshrc"
      ;;
    bash)
      if [ -f "${HOME}/.bash_profile" ]; then
        echo "${HOME}/.bash_profile"
      else
        echo "${HOME}/.bashrc"
      fi
      ;;
    fish)
      echo "${HOME}/.config/fish/config.fish"
      ;;
    *)
      if [ -f "${HOME}/.bashrc" ]; then
        echo "${HOME}/.bashrc"
      elif [ -f "${HOME}/.profile" ]; then
        echo "${HOME}/.profile"
      else
        echo "${HOME}/.bashrc"
      fi
      ;;
  esac
}

add_to_path() {
  install_dir="$1"
  rc_file="$(detect_shell_rc)"

  # Check if the directory is already in PATH
  case ":${PATH}:" in
    *":${install_dir}:"*)
      info "Install directory is already in your PATH."
      return 0
      ;;
  esac

  printf '\n'
  warn "${install_dir} is not in your PATH."

  # When piped from curl, stdin is the script itself.
  # Re-open stdin from the terminal for interactive prompts.
  if [ ! -t 0 ]; then
    if [ -e /dev/tty ]; then
      exec 3</dev/tty
    else
      warn "Cannot prompt for PATH update (no TTY). Please add it manually."
      info "Add this to your shell configuration:"
      info "  export PATH=\"${install_dir}:\$PATH\""
      return 0
    fi
  else
    exec 3<&0
  fi

  printf '%b' "  Add ${BOLD}${install_dir}${RESET} to PATH in ${BOLD}${rc_file}${RESET}? [y/N] "
  read -r answer <&3
  exec 3<&-

  case "${answer}" in
    [yY]|[yY][eE][sS])
      current_shell="$(basename "${SHELL:-sh}")"
      if [ "${current_shell}" = "fish" ]; then
        printf '\n# Added by Tamma installer\nfish_add_path %s\n' "${install_dir}" >> "${rc_file}"
      else
        # shellcheck disable=SC2016
        printf '\n# Added by Tamma installer\nexport PATH="%s:$PATH"\n' "${install_dir}" >> "${rc_file}"
      fi
      success "Added ${install_dir} to PATH in ${rc_file}"
      info "Run 'source ${rc_file}' or restart your shell to apply."
      ;;
    *)
      info "Skipped PATH update. Add it manually:"
      info "  export PATH=\"${install_dir}:\$PATH\""
      ;;
  esac
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
  setup_colors
  print_banner

  # Detect platform
  os="$(detect_os)"
  arch="$(detect_arch)"
  info "Detected platform: ${os}-${arch}"

  # Resolve version
  if [ -n "${TAMMA_VERSION:-}" ]; then
    version="${TAMMA_VERSION}"
    # Strip leading 'v' if user passed it
    version="$(printf '%s' "${version}" | sed 's/^v//')"
    info "Installing specified version: ${version}"
  else
    info "Fetching latest version..."
    version="$(get_latest_version)"
    info "Latest version: ${version}"
  fi

  # Compute asset names
  binary_name="tamma-${version}-${os}-${arch}"
  checksum_name="${binary_name}.sha256"
  download_url="${DOWNLOAD_BASE}/v${version}/${binary_name}"
  checksum_url="${DOWNLOAD_BASE}/v${version}/${checksum_name}"

  # Create temp directory
  TMPDIR_INSTALL="$(mktemp -d "${TMPDIR_BASE}/tamma-install.XXXXXX")"
  tmp_binary="${TMPDIR_INSTALL}/${binary_name}"
  tmp_checksum="${TMPDIR_INSTALL}/${checksum_name}"

  # Download binary
  info "Downloading ${binary_name}..."
  download "${download_url}" "${tmp_binary}"
  success "Downloaded binary"

  # Download checksum
  info "Downloading checksum..."
  download "${checksum_url}" "${tmp_checksum}"

  # Extract expected hash from checksum file (format: "hash  filename")
  expected_hash="$(cut -d ' ' -f 1 "${tmp_checksum}")"

  # Verify checksum
  info "Verifying checksum..."
  verify_checksum "${tmp_binary}" "${expected_hash}"

  # Ensure install directory exists
  mkdir -p "${INSTALL_DIR}"

  # Atomic install: set executable, then move to final location
  chmod +x "${tmp_binary}"
  mv "${tmp_binary}" "${INSTALL_DIR}/tamma"
  success "Installed tamma to ${INSTALL_DIR}/tamma"

  # Verify the binary works
  installed_version="$("${INSTALL_DIR}/tamma" --version 2>/dev/null || true)"
  if [ -n "${installed_version}" ]; then
    success "Verified: tamma ${installed_version}"
  fi

  # Offer to add to PATH
  add_to_path "${INSTALL_DIR}"

  # Print success message
  printf '\n'
  printf '  %b%s%b\n' "${GREEN}${BOLD}" "Tamma ${version} installed successfully!" "${RESET}"
  printf '\n'
  info "Get started:"
  info "  tamma --help"
  info "  tamma start"
  printf '\n'
}

main "$@"
