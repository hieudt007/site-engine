#!/usr/bin/env bash
# Build + đóng gói site-engine.zip (tech_doc.md §2).
# Output: site-engine.zip ở thư mục gốc repo — copy/commit thủ công sang
# lead-base/resources/site-engine/site-engine.zip (quyết định lúc release, chưa tự động hoá).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> npm run build (prisma generate + tsc)"
npm run build

echo "==> đóng gói site-engine.zip"
if ! command -v zip >/dev/null 2>&1; then
  echo "Cần lệnh 'zip' (có sẵn trên Linux/CI) — máy này chưa cài, dừng lại." >&2
  exit 1
fi
rm -f site-engine.zip
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

mkdir -p "$STAGE_DIR/site-engine"
cp -r dist "$STAGE_DIR/site-engine/dist"
cp -r prisma "$STAGE_DIR/site-engine/prisma"
cp package.json "$STAGE_DIR/site-engine/package.json"
if [ -f package-lock.json ]; then
  cp package-lock.json "$STAGE_DIR/site-engine/package-lock.json"
fi

(cd "$STAGE_DIR" && zip -r -q "$OLDPWD/site-engine.zip" site-engine)

echo "==> xong: site-engine.zip"
