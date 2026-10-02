---
title: Development
nav_order: 6
---

# Development

Users pull the Docker image. This page is for changing the app or the engine.

## Local app

Requirements: Node.js 22, .NET 10 SDK, `ffmpeg` and `ffprobe` on `PATH`.

```bash
npm install
cp .env.example .env
```

Set `APP_PASSWORD` in `.env`. Optional local paths:

```bash
VDF_CLI=./bin/vdf-cli/vdf-cli
MEDIA_ROOTS=./dev-media
IMMICH_LIBRARY=./dev-immich
```

On Windows the binary is `./bin/vdf-cli/vdf-cli.exe`.

```bash
npm run dev
```

The dev server listens on port **4747**. `npm run dev` builds `vdf-cli` from `engine/` when that binary is missing. Empty `dev-media` and `dev-immich` folders are created for the default mounts.

```bash
npm test
npm run lint
npm run typecheck
npm run check-cli
npm run verify-fixture
npm run test:engine
```

`check-cli` and `verify-fixture` fail when a `vdf-cli` flag this app passes disappears, or when `fixtures/cli-results.json` no longer matches the parser.

## Image

From this checkout:

```bash
docker compose up -d
```

`docker-compose.yml` builds `immich-vdf:local` from the local Dockerfile and sets `pull_policy: build`, so Compose does not contact Docker Hub. The Dockerfile compiles `vdf-cli` from `engine/`, runs the test suite and the fixture check, and sets the container paths. The healthcheck is on the image: it requests `/api/health` inside the container.

[docker-compose.example.yml](https://github.com/vinRosso/immich-vdf/blob/main/docker-compose.example.yml) is the file users copy. It only pulls `vinrosso/immich-vdf:latest`.

GitHub Actions (`.github/workflows/docker-publish.yml`) builds and pushes the image. A git tag `v0.1.0` publishes `0.1.0` and `latest`. Running the workflow by hand publishes `latest` only. The workflow needs repository secrets `DOCKERHUB_USERNAME` (`vinrosso`) and `DOCKERHUB_TOKEN`.

## Engine updates

```bash
npm run update-engine -- v4.1.1
```

See [Updating the VDF engine](https://github.com/vinRosso/immich-vdf/blob/main/FORK.md).

## Layout

| Path | Role |
| --- | --- |
| `engine/` | VDF.Core, VDF.CLI, and the upstream pin |
| `server.ts` | HTTP server, scheduler, scan job, ffmpeg streaming |
| `src/` | Next.js UI and JSON API |
| `fixtures/cli-results.json` | Parser contract for tests and the image build |
| `docs/immich-vdf-plan.md` | Design notes for larger changes |

`server.ts` is the process Compose starts. `next start` is not used.
