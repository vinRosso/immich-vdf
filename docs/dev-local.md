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

By default a scan starts one `ffmpeg` program for every frame it reads. With the FFmpeg 8 shared libraries it decodes inside `vdf-cli` instead, which was about four to five times faster on a test library of 300 images and 40 videos, with the same similarity scores.

You do not have to set anything up. Native decoding turns on by itself whenever the libraries can be loaded. When they cannot, the first scan downloads the matching build once (about 90 MB, checked against the published checksum) into the `vdf-cli` folder and uses it from then on. This works on Windows, Linux and macOS, for x64 and ARM. On Linux the download is a `.tar.xz`, so the `xz` tool (package `xz-utils`) must be installed; without it the scan skips the download and says so. If the download fails, for example offline, the scan uses the `ffmpeg` program and tries again a few hours later. To fetch the libraries ahead of time:

```bash
npm run install-ffmpeg
```

Set `VDF_NATIVE_FFMPEG=0` in `.env` to always use the `ffmpeg` program and never download. `VDF_NATIVE_FFMPEG=1` forces native mode without checking.

If a native scan fails before hashing finishes, it runs again with the `ffmpeg` program. A failure after that point, in the compare step, is reported as it is, because decoding is over by then.

## Run

```bash
npm run dev
```

The server listens on port **4747**. `npm run dev` builds `vdf-cli` from `engine/` when that binary is missing. Empty `dev-media` and `dev-immich` folders are created for the default mounts.

`MEDIA_ROOTS` and `IMMICH_PATH` / `IMMICH_LIBRARY` are for this checkout. The Docker image sets its own paths and ignores them.

## Volume binds

`VOLUME_BINDS` maps **Immich container paths** to **host folders** when you run `npm run dev`. There is no `/immich` directory on the host; the app reads `IMMICH_PATH` and uses these overrides for scan paths and asset matching.

Comma- or semicolon-separated entries, so a folder name that contains either cannot be used. Each entry is either `mount=host` or `host:mount` (Compose order, the host first). An optional `:ro` suffix is ignored. The app does not create the host folders: a typo is reported as a missing folder instead of leaving a new empty one on your share.

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
