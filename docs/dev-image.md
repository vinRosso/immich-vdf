---
title: Image
parent: Development
nav_order: 3
nav_prev: /dev-checks
nav_prev_title: Checks
nav_next: /dev-engine
nav_next_title: Engine
---

# Image

## On this page

- [This checkout](#this-checkout)
- [Publish](#publish)

## This checkout

From this checkout:

```bash
docker compose up -d
```

`docker-compose.yml` builds `immich-vdf:local` and sets `pull_policy: build`, so Compose does not pull from Docker Hub. The Dockerfile compiles `vdf-cli` from `engine/`, runs the test suite and the fixture check, and sets the container paths. The image healthcheck requests `/api/health`.

## Publish

[docker-compose.example.yml](https://github.com/vinRosso/immich-vdf/blob/main/docker-compose.example.yml) is what users copy. It only pulls `vinrosso/immich-vdf:latest`.

GitHub Actions (`.github/workflows/docker-publish.yml`) builds and pushes the image. Pushing a git tag `v0.1.0` builds that commit and publishes `0.1.0`, `0.1`, `0`, and `latest`. Running the workflow by hand builds the branch you select. It publishes that same set for the highest `vMAJOR.MINOR.PATCH` tag in the repository, or `latest` only when no such tag exists. The workflow needs repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
