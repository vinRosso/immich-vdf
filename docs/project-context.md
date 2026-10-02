# Project context (immich-vdf)

Goals and constraints for this repository. The GitHub remote is [vinRosso/immich-vdf](https://github.com/vinRosso/immich-vdf).

## Goal

immich-vdf is a web UI for [Video Duplicate Finder](https://github.com/0x90d/videoduplicatefinder) with two modes:

1. **Immich** — the Immich upload library. Read-only mount, stack or trash through the API.
2. **Files** — an external library Immich already reads. Deletes rename files into `.vdf-trash/` on that folder.

Users copy `docker-compose.example.yml` and pull `vinrosso/immich-vdf`. In this checkout, `docker compose up -d` builds `immich-vdf:local` and does not pull from Docker Hub. Developers can also run `npm run dev`. A newer VDF tag is pulled into `engine/` with `npm run update-engine`. Do not download an official CLI binary. GitHub Actions publishes the Hub image.

## Key docs

- [immich-vdf-plan.md](./immich-vdf-plan.md) — full product and architecture plan.
- [../README.md](../README.md) — what it is, and the user quick start.
- Sidebar sections: Installation (`install.md`, `security.md`), Usage, Development (`dev-*.md`, `code.md`).
- [development.md](./development.md) — local build and image publish.
- [../FORK.md](../FORK.md) — how to pull a newer upstream VDF tag.
- [security.md](./security.md) — operator threat model.

## Repo layout

| Path | Role |
|------|------|
| `engine/` | Vendored VDF.Core and VDF.CLI (see FORK.md) |
| `server.ts` | Custom Node server (scheduler, scans, streaming) |
| `src/` | Next.js UI and API routes |
| `fixtures/cli-results.json` | Parser contract for CI / Docker build |

## Local development (Windows)

- `npm install`, copy `.env.example` → `.env`, `npm run build:cli` (`.NET 10 SDK`), set `VDF_CLI=./bin/vdf-cli/vdf-cli.exe`, `npm run dev` → http://localhost:4747
- ffmpeg/ffprobe on PATH for thumbnails and playback; fork `vdf-cli` from `engine/` for scans (no official CLI download).
- Clone on Windows: use the real `C:\` path in PowerShell. A `/mnt/c/...` path from WSL is the wrong checkout.

## Later: cached remux for playback

Keep live streaming for now. The measured stall is fragmented MP4 over a live ffmpeg pipe (`frag_keyframe`): the browser waits for a full GOP before the first frame, every open and every filmstrip seek restarts ffmpeg, and there is no `Content-Length` so seeking stays custom.

When we revisit speed, pre-remux browser-safe codecs in a non-MP4 container (for example H.264+AAC MKV) once at scan finish: `ffmpeg -i in.mkv -c copy -movflags +faststart` into `dataDir/media/<cacheKey>.mp4`, then serve that file with byte ranges like direct playback. Cost is disk about the size of the source, once per file. True transcodes (HEVC and similar) stay on demand, or get the same cache at a capped resolution if we want that too.

## Agent conventions

- The engine in `engine/` is ours. Keep its AGPL copyright headers.
- Minimize diff scope; match existing TypeScript and UI patterns.
- Security: path jail, no shell string interpolation for paths, never return Immich API key to the client.
