#!/usr/bin/env bash
# Move the unmodified Video Duplicate Finder submodule to a release tag and rebuild.
# Tags that move (master, the rolling 4.1.x release) are refused.
set -euo pipefail

TAG="${1:-v4.1.1}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

case "$TAG" in
  master|main|HEAD|*/*|*.x)
    echo "Refusing to pin upstream to '$TAG'. Pass an immutable release tag such as v4.1.1." >&2
    exit 1
    ;;
esac

git -C upstream fetch origin --tags
if ! git -C upstream rev-parse --verify --quiet "refs/tags/${TAG}^{}" >/dev/null; then
  echo "Tag ${TAG} was not found. This script only checks out release tags, never a branch." >&2
  exit 1
fi

git -C upstream checkout --detach "refs/tags/${TAG}"
echo "upstream is $(git -C upstream describe --tags --exact-match) ($(git -C upstream rev-parse --short HEAD))"
echo "Commit the submodule pointer if you want the repository to remember this tag."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not on PATH. From the repo root, run: docker compose build && docker compose up -d" >&2
  exit 1
fi

docker compose build
echo "Image rebuilt. Start it with: docker compose up -d"
