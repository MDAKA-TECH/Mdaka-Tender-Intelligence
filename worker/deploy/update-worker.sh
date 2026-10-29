#!/usr/bin/env bash
# Pull the latest code and restart the worker. Run on the server: bash /opt/tender-intel/worker/deploy/update-worker.sh
set -euo pipefail
APP_DIR="/opt/tender-intel"
ENV_FILE="$HOME/tender-worker.env"
git -C "$APP_DIR" pull --ff-only
docker build -t tender-worker "$APP_DIR/worker"
docker rm -f tender-worker >/dev/null 2>&1 || true
docker run -d --name tender-worker --restart unless-stopped --env-file "$ENV_FILE" \
  --memory 1500m --log-opt max-size=10m --log-opt max-file=3 tender-worker >/dev/null
sleep 8
docker logs --tail 15 tender-worker
