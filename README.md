# VDF web

A small web app for [Video Duplicate Finder](https://github.com/0x90d/videoduplicatefinder). It scans local files or a mounted Immich library, shows the duplicate groups, and lets you compare them. Files deletes move items into `.vdf-trash/` on that same mount. Immich stack and trash go through the Immich API, so the library mount stays read-only.

This repo is a fork of Video Duplicate Finder. `engine/VDF.Core` and `engine/VDF.CLI` are the v4.1.1 sources (commit `21ec967`), and the image builds `vdf-cli` from them. See [FORK.md](FORK.md). The app runs `vdf-cli scan` and then `vdf-cli compare --format json`. The engine is AGPLv3 (`LICENSE`).

## Project docs (Cursor context in-repo)

- [docs/project-context.md](docs/project-context.md) — goals, layout, Windows dev notes.
- [docs/vdf-web-plan.md](docs/vdf-web-plan.md) — full architecture and feature plan.
- [.cursor/rules/vdf-web.mdc](.cursor/rules/vdf-web.mdc) — agent rules for this repo.

## Deploy

Install Docker, then from this directory:

```bash
cp .env.example .env
```

Edit `.env`:

- `APP_PASSWORD` is the single password for the UI. It is not baked into the image.
- `MEDIA_PATH` is the host folder of videos you want to scan. The container mounts it read-write at `/media`. Trash is a rename into `/media/.vdf-trash/`, so it does not fill the data volume.
- `IMMICH_PATH` must be the same host path as `UPLOAD_LOCATION` in the Immich `.env`. Immich mounts that folder at `/data`; this app maps `originalPath` `/data/...` onto it. Originals are in `library/<storageLabel>/`. The admin user's folder is `admin`, not their display name. If Immich bind-mounts that folder from somewhere else (`/storage/kevin/2_memories:/data/library/admin`), set `IMMICH_BINDS=/data/library/admin=/host/path` so the scan reads the real folder.
- External libraries: add the same `host:container` volume lines as in Immich. After you connect with an API key, scan roots are read from Immich (`GET /api/libraries` → `importPaths`), plus `/immich` for uploads. Optional `IMMICH_SCAN_ROOTS` in `.env` is only a fallback if the key cannot list libraries.
- `TRUSTED_PROXY_CIDR` is optional. Set it to the reverse proxy's address range if TLS ends at the proxy and you want the session cookie marked Secure when `X-Forwarded-Proto` is `https`. Leave it empty on a plain LAN. The header is ignored from any other address.

Start it:

```bash
docker compose up -d --build
```

Open `http://<host>:47821`. One Compose service publishes that port. Settings, results, thumbnails, and the two scan databases live in the `vdf-data` volume.

Mirror Immich’s volume layout in `docker-compose.yml`; only host paths live in `.env`. An API key only sees one user's assets. Matched items use Immich thumbnails; unmatched files cannot be stacked or trashed.

Run this on the LAN or behind your reverse proxy, the same way upstream describes its own web UI. The app can read every mounted file and trash an Immich library. The container sets `no-new-privileges`. Secrets stay in `.env` and on the data volume, not in git.

### Where the scan database goes

`vdf-cli` has a `--db <folder>` flag. In v4.1.1, `CoreUtils.ResolveDatabaseFolder` uses that folder only when it **already exists**. Otherwise, when `DOTNET_RUNNING_IN_CONTAINER` is true (set by the .NET runtime image, and set again in this image), the database falls back to `$XDG_STATE_HOME/VDF` or `~/.local/state/VDF`. Outside a container, a writable directory next to the executable wins over that fallback.

This app creates `/data/db/server` and `/data/db/immich` and passes `--db` to each, so the two sections do not share hashes and a rescan can reuse them. Do not point both sections at one database.

The image build runs `vdf-cli --help` and parses `fixtures/cli-results.json` through this app's parser. A missing CLI flag or a parser that cannot read that fixture fails the build.

FFmpeg is used in process mode (`ffmpeg` and `ffprobe` on `PATH`). The native binding wants FFmpeg 8 shared libraries and is not enabled.

## Engine

`docker compose up -d --build` is the deploy. A checkout already contains `engine/`, so the build does not need `git submodule update`. The runtime image ships the published `vdf-cli`, not the .NET SDK. Pair scores (`PairScores.db`) sit next to `ScannedFiles.db` on the data volume and survive an image rebuild.

If a CLI flag this app passes disappears, the image build fails on `vdf-cli --help` or on `fixtures/cli-results.json`.

## Local development

Runs without Docker. The UI works before any scan; `vdf-cli` is required when you press Scan.

```bash
npm install
cp .env.example .env   # set APP_PASSWORD
npm run build:cli      # needs .NET 10 SDK; writes bin/vdf-cli/
```

In `.env`, point `VDF_CLI` at `./bin/vdf-cli/vdf-cli.exe` (Windows) or `./bin/vdf-cli/vdf-cli` (Linux/macOS). `npm run dev` builds the CLI automatically if that binary is missing.

```bash
npm run dev
```

The dev server listens on port **47821**. Empty folders `dev-media` and `dev-immich` are created for the default mounts. Point `MEDIA_ROOTS` and `IMMICH_LIBRARY` (or `IMMICH_PATH`) at real directories if you have them. Thumbnail and playback routes need `ffmpeg` and `ffprobe` on `PATH`.

```bash
npm run check-cli      # uses VDF_CLI from .env
npm run test:engine    # fork engine unit tests
```

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
