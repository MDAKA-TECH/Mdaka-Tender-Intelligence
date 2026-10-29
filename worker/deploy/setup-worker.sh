#!/usr/bin/env bash
# One-time setup of the Tender Intelligence worker on a Linux server (Oracle Cloud, any VPS).
# Run as the normal user (ubuntu), after oracle-cloud-init.yaml has installed Docker and git:
#   curl is not needed: copy this file over, or paste it into `nano setup-worker.sh`, then
#   bash setup-worker.sh
set -euo pipefail

REPO="${REPO:-git@github.com:MDAKA-TECH/Mdaka-Tender-Intelligence.git}"
APP_DIR="/opt/tender-intel"
ENV_FILE="$HOME/tender-worker.env"
KEY="$HOME/.ssh/tender_deploy"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "Docker is not installed yet. Wait a few minutes for the server's first boot to finish, then try again."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Your user can't use Docker yet. Log out (exit) and SSH in again, then rerun this script."; exit 1; }

# 1. A read-only deploy key, so this server can pull the private repo (and nothing else).
if [ ! -f "$KEY" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -N "" -f "$KEY" -C "tender-worker@$(hostname)" >/dev/null
fi
if ! grep -q "tender_deploy" "$HOME/.ssh/config" 2>/dev/null; then
  cat >> "$HOME/.ssh/config" <<CFG
Host github.com
  IdentityFile $KEY
  IdentitiesOnly yes
CFG
  chmod 600 "$HOME/.ssh/config"
fi
ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null

if [ ! -d "$APP_DIR/.git" ]; then
  say "Add this deploy key to GitHub:"
  echo "  GitHub → MDAKA-TECH/Mdaka-Tender-Intelligence → Settings → Deploy keys → Add deploy key"
  echo "  Title: oracle-worker   ·   leave 'Allow write access' OFF   ·   Key:"
  echo
  cat "$KEY.pub"
  echo
  read -rp "Press Enter once the key is added... "
  git clone "$REPO" "$APP_DIR"
fi

# 2. The worker's settings (same as worker/.env on your PC). Stored only on this server, readable only by you.
if [ ! -s "$ENV_FILE" ]; then
  say "Now paste your worker settings."
  echo "nano will open. Paste the contents of worker\\.env from your PC, then press Ctrl+O, Enter, Ctrl+X."
  read -rp "Press Enter to open the editor... "
  touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
  nano "$ENV_FILE"
fi
grep -q '^SUPABASE_SERVICE_ROLE_KEY=.\+' "$ENV_FILE" || { echo "SUPABASE_SERVICE_ROLE_KEY is missing from $ENV_FILE. Run the script again."; exit 1; }

# 3. Build and start. --restart unless-stopped brings it back after a crash or a server reboot.
say "Building the worker (first time takes a few minutes)..."
docker build -t tender-worker "$APP_DIR/worker"
docker rm -f tender-worker >/dev/null 2>&1 || true
docker run -d --name tender-worker --restart unless-stopped --env-file "$ENV_FILE" \
  --memory 1500m --log-opt max-size=10m --log-opt max-file=3 tender-worker >/dev/null

say "Started. The last log lines:"
sleep 8
docker logs --tail 20 tender-worker
echo
echo "Look for 'OCR available' and 'AI extraction on'. Follow the log any time with: docker logs -f tender-worker"
