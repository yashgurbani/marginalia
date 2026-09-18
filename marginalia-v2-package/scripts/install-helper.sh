#!/usr/bin/env bash
# This installer only manages the local helper. It never sends content or changes Codex sign-in.
set -euo pipefail

uninstall=false
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --uninstall) uninstall=true ;;
    --dry-run) dry_run=true ;;
    -h|--help) printf 'Usage: %s [--dry-run] [--uninstall]\n' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
main="$root/daemon/main.ts"
os=$(uname -s)
label='com.marginalia.helper'

show_start_instructions() {
  printf '%s\n' 'Helper address: http://127.0.0.1:43120/'
  printf '%s\n' 'To pair, open the helper address in a browser, choose "Show pairing code", then enter the code in the extension options.'
}

show_removed_instructions() {
  printf '%s\n' 'The helper is stopped. Install it again before opening the helper address or pairing.'
}

xml_escape() {
  local value=$1
  value=${value//&/\&amp;}; value=${value//</\&lt;}; value=${value//>/\&gt;}
  printf '%s' "${value//\"/\&quot;}"
}

systemd_quote() {
  local value=$1
  value=${value//\\/\\\\}; value=${value//\"/\\\"}; value=${value//%/%%}
  printf '"%s"' "$value"
}

systemd_exec_quote() {
  systemd_quote "${1//\$/'$$'}"
}

case "$os" in
  Darwin)
    data_dir=${MARGINALIA_DATA_DIR:-"$HOME/Library/Application Support/Marginalia"}
    service_path="$HOME/Library/LaunchAgents/$label.plist"
    service_name='LaunchAgent'
    ;;
  Linux)
    data_dir=${MARGINALIA_DATA_DIR:-"${XDG_DATA_HOME:-$HOME/.local/share}/Marginalia"}
    service_path="$HOME/.config/systemd/user/marginalia-helper.service"
    service_name='systemd user unit'
    ;;
  *)
    if $dry_run; then
      printf '[DRY RUN] %s is unsupported by this POSIX installer; use install-helper.ps1 on Windows.\n' "$os"
      printf '%s\n' '[DRY RUN] Supported hosts register a LaunchAgent with launchctl or a systemd user unit with systemctl.'
      printf '[DRY RUN] Run npm ci in %s only if node_modules is missing.\n' "$root"
      printf '[DRY RUN] Run npm run build in %s.\n' "$root"
      show_start_instructions
      exit 0
    fi
    printf 'Unsupported operating system: %s.\n' "$os" >&2
    exit 1
    ;;
esac

[[ "$data_dir" == /* ]] || { printf 'MARGINALIA_DATA_DIR must be absolute.\n' >&2; exit 1; }

if $uninstall; then
  if $dry_run; then
    printf '[DRY RUN] Stop and remove %s %s; retain %s.\n' "$service_name" "$service_path" "$data_dir"
  elif [[ "$os" == Darwin ]]; then
    launchctl bootout "gui/$UID/$label" 2>/dev/null || true
    rm -f -- "$service_path"
    printf 'Removed LaunchAgent. Reader data remains in %s.\n' "$data_dir"
  else
    systemctl --user disable --now marginalia-helper.service 2>/dev/null || true
    rm -f -- "$service_path"
    systemctl --user daemon-reload
    printf 'Removed systemd user unit. Reader data remains in %s.\n' "$data_dir"
  fi
  show_removed_instructions
  exit 0
fi

command -v node >/dev/null || { printf 'Node 24 is required and node was not found on PATH.\n' >&2; exit 1; }
node_version=$(node --version)
[[ "$node_version" == v24.* ]] || { printf 'Node 24 is required; found %s.\n' "$node_version" >&2; exit 1; }
command -v npm >/dev/null || { printf 'npm was not found on PATH.\n' >&2; exit 1; }
node_path=$(node -p 'process.execPath')

if $dry_run; then
  printf '[DRY RUN] Node check passed: %s (%s).\n' "$node_version" "$node_path"
  printf '[DRY RUN] Run npm ci in %s only if node_modules is missing.\n' "$root"
  printf '[DRY RUN] Run npm run build in %s.\n' "$root"
  printf '[DRY RUN] Create %s for data and logs.\n' "$data_dir"
  if [[ "$os" == Darwin ]]; then
    printf '[DRY RUN] Write LaunchAgent %s and register it with launchctl.\n' "$service_path"
  else
    printf '[DRY RUN] Write systemd user unit %s, enable it at login, and start it now with systemctl.\n' "$service_path"
  fi
  printf '[DRY RUN] Run node daemon/main.ts from %s with MARGINALIA_DATA_DIR=%s.\n' "$root" "$data_dir"
  show_start_instructions
  exit 0
fi

if [[ ! -d "$root/node_modules" ]]; then (cd "$root" && npm ci); fi
(cd "$root" && npm run build)
mkdir -p -- "$data_dir"
chmod 700 "$data_dir"

if [[ "$os" == Darwin ]]; then
  mkdir -p -- "$(dirname -- "$service_path")"
  temp=$(mktemp "${service_path}.XXXXXX")
  cat >"$temp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array><string>$(xml_escape "$node_path")</string><string>$(xml_escape "$main")</string></array>
<key>WorkingDirectory</key><string>$(xml_escape "$root")</string>
<key>EnvironmentVariables</key><dict><key>MARGINALIA_DATA_DIR</key><string>$(xml_escape "$data_dir")</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$(xml_escape "$data_dir/helper.log")</string>
<key>StandardErrorPath</key><string>$(xml_escape "$data_dir/helper.log")</string>
</dict></plist>
EOF
  chmod 600 "$temp"; mv -f -- "$temp" "$service_path"
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$service_path"
  printf 'Installed and started LaunchAgent. Helper output: %s\n' "$data_dir/helper.log"
else
  mkdir -p -- "$(dirname -- "$service_path")"
  temp=$(mktemp "${service_path}.XXXXXX")
  cat >"$temp" <<EOF
[Unit]
Description=Marginalia local helper

[Service]
Type=simple
WorkingDirectory=$(systemd_quote "$root")
Environment=$(systemd_quote "MARGINALIA_DATA_DIR=$data_dir")
ExecStart=$(systemd_exec_quote "$node_path") $(systemd_exec_quote "$main")
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
EOF
  chmod 600 "$temp"; mv -f -- "$temp" "$service_path"
  systemctl --user daemon-reload
  systemctl --user enable marginalia-helper.service
  systemctl --user restart marginalia-helper.service
  printf '%s\n' 'Installed and started systemd user unit. View helper output with: journalctl --user -u marginalia-helper -f'
fi
show_start_instructions
