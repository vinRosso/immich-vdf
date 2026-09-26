# VDF web

A small web app for [Video Duplicate Finder](https://github.com/0x90d/videoduplicatefinder). It scans a server folder or a mounted Immich library, shows the duplicate groups, and lets you compare them. Server deletes move files into `.vdf-trash/` on that same mount. Immich stack and trash go through the Immich API, so the library mount stays read-only.

Video Duplicate Finder stays an unmodified git submodule at `upstream/`, pinned to the release tag **v4.1.1** (commit `21ec967`). It is not pinned to `master` or to the moving `4.1.x` tag. The app runs `vdf-cli scan-and-compare --format json --output <file>` and does not patch upstream. Upstream is AGPLv3.

## Deploy

Install Docker, then from this directory:

```bash
cp .env.example .env
```

Edit `.env`:

- `APP_PASSWORD` is the single password for the UI. It is not baked into the image.
- `MEDIA_PATH` is the host folder of videos you want to scan. The container mounts it read-write at `/media`. Trash is a rename into `/media/.vdf-trash/`, so it does not fill the data volume.
- `IMMICH_LIBRARY_PATH` is the host path of the Immich library (often the upload directory, or an external library). The container mounts it **read-only** at `/immich`.
- `TRUSTED_PROXY_CIDR` is optional. Set it to the reverse proxy's address range if TLS ends at the proxy and you want the session cookie marked Secure when `X-Forwarded-Proto` is `https`. Leave it empty on a plain LAN. The header is ignored from any other address.

Start it:

```bash
docker compose up -d --build
```

Open `http://<host>:47821`. One Compose service publishes that port. Settings, results, thumbnails, and the two scan databases live in the `vdf-data` volume.

In Immich, set a path map from the asset `originalPath` prefix (often `/usr/src/app/upload`, or your external library path) to `/immich`. An API key only sees one user's assets. Files that do not match an asset are shown and cannot be stacked or trashed.

Run this on the LAN or behind your reverse proxy, the same way upstream describes its own web UI. The app can read every mounted file and trash an Immich library. The container sets `no-new-privileges`. Secrets stay in `.env` and on the data volume, not in git.

### Where the scan database goes

`vdf-cli` has a `--db <folder>` flag. In v4.1.1, `CoreUtils.ResolveDatabaseFolder` uses that folder only when it **already exists**. Otherwise, when `DOTNET_RUNNING_IN_CONTAINER` is true (set by the .NET runtime image, and set again in this image), the database falls back to `$XDG_STATE_HOME/VDF` or `~/.local/state/VDF`. Outside a container, a writable directory next to the executable wins over that fallback.

This app creates `/data/db/server` and `/data/db/immich` and passes `--db` to each, so the two sections do not share hashes and a rescan can reuse them. Do not point both sections at one database.

The image build runs `vdf-cli --help` and parses `fixtures/cli-results.json` through this app's parser. A missing CLI flag or a parser that cannot read that fixture fails the build.

FFmpeg is used in process mode (`ffmpeg` and `ffprobe` on `PATH`). The native binding wants FFmpeg 8 shared libraries and is not enabled.

## Pull upstream updates

Do not edit anything under `upstream/`.

```bash
./scripts/update-upstream.sh v4.1.2
docker compose up -d
```

The script fetches tags, checks out that release tag (detached, never `master`, `main`, or a rolling `*.x` tag), and rebuilds the image. Commit the submodule pointer if you want the repository to stay on the new tag. Then `docker compose up -d` restarts the container.

If upstream renames a flag or the JSON groups, the image build fails on `vdf-cli --help` or on `fixtures/cli-results.json`. Update the parser and the fixture together with the pin. Their code stays untouched.

## Local development

The UI runs without a scan. `vdf-cli` is only required when you press Scan.

```bash
npm install
APP_PASSWORD=local-dev npm run dev
```

The dev server listens on port **47821**. Empty folders `dev-media` and `dev-immich` are created for the default mounts. Point `MEDIA_ROOTS` and `IMMICH_LIBRARY` at real directories if you have them. Thumbnail and playback routes need `ffmpeg` and `ffprobe` on `PATH`.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```
