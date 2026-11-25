#!/bin/bash
# usage: start-be.sh [rate_limit_max]
# Starts the backend (from the folder above systest/) with a test env. Requires ../.env.systest (see README).
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."
[ -f .env.systest ] || { echo "Missing ../.env.systest (copy systest/env.systest.example). Refusing to start against your real .env."; exit 1; }
grep -qE "^MONGO_URI=mongodb://(127\.0\.0\.1|localhost)" .env.systest || { echo "MONGO_URI in .env.systest must point to a LOCAL throwaway MongoDB. Refusing."; exit 1; }
set -a; . ./.env.systest; set +a
pkill -f "node app.js$" 2>/dev/null; sleep 1
if [ "$1" = "default" ]; then setsid nohup node app.js > "$HERE/results/backend.log" 2>&1 & else RATE_LIMIT_MAX_REQUESTS=${1:-1000000} setsid nohup node app.js > "$HERE/results/backend.log" 2>&1 & fi
for i in $(seq 1 30); do curl -s localhost:3000/health >/dev/null && { echo "backend up (limit=${1:-1000000})"; exit 0; }; sleep 1; done; echo "backend FAILED"; tail -20 "$HERE/results/backend.log"; exit 1
