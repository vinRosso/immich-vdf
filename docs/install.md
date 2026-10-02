---
title: Install
nav_order: 2
---

# Install

immich-vdf runs as one container. Docker pulls the image. You do not need Node.js, the .NET SDK, or the Video Duplicate Finder source.

## Requirements

- Docker Engine with Compose v2
- A host folder of media, if you want the Files section
- An Immich library on the same machine, if you want the Immich section. The container needs the upload folder Immich already uses, and it needs to reach the Immich API over HTTP.

## Start

Create an empty directory. Copy [docker-compose.example.yml](https://github.com/vinRosso/immich-vdf/blob/main/docker-compose.example.yml) into it as `docker-compose.yml`, and [.env.example](https://github.com/vinRosso/immich-vdf/blob/main/.env.example) as `.env`.

Edit `.env`:

```bash
APP_PASSWORD=choose-a-long-password
MEDIA_PATH=/path/to/videos
IMMICH_PATH=/path/to/immich/upload
```

`APP_PASSWORD` must be at least 8 characters. `change-me` is refused. `IMMICH_PATH` is the host path Immich calls `UPLOAD_LOCATION`. Immich mounts that folder at `/data` inside its own container. This app mounts it read-only at `/immich` and translates Immich paths under `/data/...` onto that mount.

```bash
docker compose up -d
```

Open `http://<host>:4747` and sign in with `APP_PASSWORD`.

That Compose file pulls `vinrosso/immich-vdf:latest`. It has no build step. GitHub Actions publishes the image from a `v*` tag. Replace `latest` with a version, such as `0.1.0`, when you want to stay on one release.

## What is stored

| Location | Contents |
| --- | --- |
| `vdf-data` volume, mounted at `/data` | Settings, session secret, scan databases, results, generated thumbnails |
| `MEDIA_PATH`, mounted at `/media` | Your files. Trash is `.vdf-trash/` inside this folder. |
| `IMMICH_PATH`, mounted at `/immich` read-only | Immich originals. This app does not rename them. |

Files and Immich keep separate scan databases under `/data/db/server` and `/data/db/immich`.

## Updates

```bash
docker compose pull
docker compose up -d
```

Change the image tag in your copy of `docker-compose.yml` when you want a specific release instead of `latest`.

## Extra Immich folders

If Immich keeps an external library on a path outside the upload folder, add the same host and container path to your `docker-compose.yml`, read-only:

```yaml
- /home/user/photos:/home/user/photos:ro
```

If Immich overlays one user folder from a different host directory, mount that directory on top of the matching path under `/immich`, for example `/storage/photos:/immich/library/admin:ro`. A symlink works when its target is also visible at that path inside this container.

Set `IMMICH_SCAN_ROOTS` only when the API key cannot list libraries. The usual case is to leave it unset and let the app read `GET /api/libraries` after you save the API key.
