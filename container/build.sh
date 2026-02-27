#!/usr/bin/env bash
# Build the mdclaw container image
# Run from the project root: ./container/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "Building mdclaw container image..."
docker build -t mdclaw -f container/Dockerfile .
echo "Done. Image: mdclaw"
