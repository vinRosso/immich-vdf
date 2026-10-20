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
- [Volume binds](#volume-binds)

## Requirements

You need Node.js 22, the .NET 10 SDK, and `ffmpeg` and `ffprobe` on `PATH`.

```bash
npm install
cp .env.example .env
```

Set `APP_PASSWORD` in `.env`. Point `IMMICH_PATH` (or `IMMICH_LIBRARY`) at Immich’s upload folder on the host. Optional paths:

```bash
VDF_CLI=./bin/vdf-cli/vdf-cli
MEDIA_ROOTS=./dev-media
IMMICH_PATH=//server/share/immich
```

On Windows the binary is `./bin/vdf-cli/vdf-cli.exe`.

### Faster scans

By default a scan starts one `ffmpeg` program for every frame it reads. With the FFmpeg 8 shared libraries next to `vdf-cli`, it decodes inside the process instead, which was about four times faster on a test library of 300 images and 40 videos, with the same similarity scores. Download a `win64-gpl-shared` 8.x build (for example from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases)), copy its `bin/*.dll` files next to `vdf-cli.exe`, and set this in `.env`:

```bash
VDF_NATIVE_FFMPEG=1
```

Leave it unset to keep using the `ffmpeg` program. If the libraries are missing or fail to load, the scan runs again without them.

## Run

```bash
npm run dev
```

The server listens on port **4747**. `npm run dev` builds `vdf-cli` from `engine/` when that binary is missing. Empty `dev-media` and `dev-immich` folders are created for the default mounts.

`MEDIA_ROOTS` and `IMMICH_PATH` / `IMMICH_LIBRARY` are for this checkout. The Docker image sets its own paths and ignores them.

## Volume binds

`VOLUME_BINDS` maps **Immich container paths** to **host folders** when you run `npm run dev`. There is no `/immich` directory on the host; the app reads `IMMICH_PATH` and uses these overrides for scan paths and asset matching.

Comma-separated entries. Each entry is either `mount=host` or `host:mount` (Compose-style). An optional `:ro` suffix is ignored.

```bash
# Upload library admin folder lives on another share
VOLUME_BINDS=/data/library/admin=/my/local/path

# External library: use the import path from Immich → Libraries
VOLUME_BINDS=/data/library/admin=//share/memories,/mnt/photos=//share/photos
```

Use paths Immich actually reports:

- Upload originals: `/data/library/<storage label>/` (admin is the usual label).
- When `IMMICH_PATH` is the full upload root mounted at `/immich` in Docker, the same folder is also `/immich/library/admin` in that layout. On local dev with `IMMICH_PATH` set to the `library` folder on disk, prefer **`/data/library/admin`** in `VOLUME_BINDS`, not `/immich/admin`.

In **Docker**, prefer real `volumes:` lines in `docker-compose.yml` and `IMMICH_SCAN_ROOTS` instead of `VOLUME_BINDS`. See [Installation — Extra Immich library paths](install#extra-immich-library-paths).
