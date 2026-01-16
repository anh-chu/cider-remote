#!/bin/bash
# Use Podman to build for Windows using the official Electron Builder image (contains Wine)
# We map the current directory to /project inside the container.
# We use --userns=keep-id to map permissions correctly (important for Podman).

echo "Starting Build with Podman..."
podman run --rm -it \
  --userns=keep-id \
  -v "$(pwd):/project" \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -c "npm install && npm run electron:build-win"

echo "Build complete! Check dist_electron/"
