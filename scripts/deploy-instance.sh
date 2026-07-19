#!/usr/bin/env bash
# Update 1 instance đang chạy trên VPS bằng git (dev/test only — KHÔNG phải luồng chính thức
# tạo Website, vốn dùng site-engine.zip qua lead-base/WebsiteProvisionService.php).
#
# Chạy TRỰC TIẾP (as root, vd qua SSH) trong thư mục instance trên VPS, vd:
#   cd /var/www/blog.leadbase.vn && bash scripts/deploy-instance.sh
#
# Giả định thư mục này đã là git clone của repo site-engine (không phải unzip từ site-engine.zip)
# và đã có sẵn .env riêng của instance (KHÔNG đụng .env).
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN="$(basename "$PWD")"
APP_USER="site-engine"

echo "==> git pull"
git pull

echo "==> npm ci"
npm ci

echo "==> npm run build (prisma generate + tsc)"
npm run build

echo "==> prisma migrate deploy"
npx prisma migrate deploy

echo "==> chown ${APP_USER}"
chown -R "${APP_USER}:${APP_USER}" .

echo "==> restart site-engine-instance@${DOMAIN}"
systemctl restart "site-engine-instance@${DOMAIN}"

echo "==> xong"
