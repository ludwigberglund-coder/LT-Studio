#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
cat rollands-source.tar.xz.b64.part* | base64 -d > rollands-source.tar.xz
echo "Created: $(pwd)/rollands-source.tar.xz"
echo "Verify with: sha256sum -c SHA256SUMS.txt"
echo "Extract with: tar -xJf rollands-source.tar.xz"
