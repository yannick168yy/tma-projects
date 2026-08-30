#!/usr/bin/env bash
set -euo pipefail

SIGNING_DIR="${1:?用法: bash scripts/generate-ph-signing.sh <签名保存目录>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTORE="$SIGNING_DIR/betogo-ph-release.jks"
PASSWORD_FILE="$SIGNING_DIR/betogo-ph-release-password.txt"
PROPERTIES_FILE="$ROOT/android/keystore.properties"

if [[ -e "$KEYSTORE" || -e "$PASSWORD_FILE" || -e "$PROPERTIES_FILE" ]]; then
  echo "签名文件已存在，拒绝覆盖：$KEYSTORE"
  exit 1
fi

mkdir -p "$SIGNING_DIR"
umask 077
PASSWORD="$(openssl rand -hex 24)"

keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -storepass "$PASSWORD" \
  -keypass "$PASSWORD" \
  -alias betogo-ph \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=BETOGO Philippines, OU=Mobile, O=BETOGO, L=Manila, ST=Metro Manila, C=PH"

printf '%s\n' "$PASSWORD" > "$PASSWORD_FILE"
{
  printf 'storeFile=%s\n' "$KEYSTORE"
  printf 'storePassword=%s\n' "$PASSWORD"
  printf 'keyAlias=betogo-ph\n'
  printf 'keyPassword=%s\n' "$PASSWORD"
} > "$PROPERTIES_FILE"

echo "菲律宾签名已生成：$KEYSTORE"
echo "密码备份：$PASSWORD_FILE"
echo "Gradle 配置：$PROPERTIES_FILE"
