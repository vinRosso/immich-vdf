---
title: Local app
parent: Development
nav_order: 1
nav_prev: /development
nav_prev_title: Development
nav_next: /dev-checks
nav_next_title: Checks
---

# Local app

## On this page

- [Requirements](#requirements)
- [Run](#run)

## Requirements

You need Node.js 22, the .NET 10 SDK, and `ffmpeg` and `ffprobe` on `PATH`.

```bash
npm install
cp .env.example .env
```

Set `APP_PASSWORD` in `.env`. Optional paths:

```bash
VDF_CLI=./bin/vdf-cli/vdf-cli
MEDIA_ROOTS=./dev-media
IMMICH_LIBRARY=./dev-immich
```

On Windows the binary is `./bin/vdf-cli/vdf-cli.exe`.

## Run

```bash
npm run dev
```

The server listens on port **4747**. `npm run dev` builds `vdf-cli` from `engine/` when that binary is missing. Empty `dev-media` and `dev-immich` folders are created for the default mounts.

`MEDIA_ROOTS` and `IMMICH_LIBRARY` are for this checkout. The Docker image sets its own paths and ignores them.
