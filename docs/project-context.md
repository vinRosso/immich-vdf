# Project context (vdf-web)

This file mirrors the Cursor **Project** context so a local checkout on Windows (or any machine) carries the same goals and constraints. The live Project may also keep notes in Cursor’s cloud **Context** tab; treat this `docs/` folder as the git-backed copy.

## Goal

Web UI for [Video Duplicate Finder](https://github.com/0x90d/videoduplicatefinder) with two modes:

1. **Server** — scan media on the host, compare duplicates, stream previews, move losers to `.vdf-trash/`.
2. **Immich** — scan a read-only library mount, map paths to assets via API key, stack or trash duplicates through Immich.

Deploy with Docker on a home server. Pull upstream VDF via the `upstream/` submodule and `scripts/update-upstream.sh` (no patches inside `upstream/`).

## Key docs

- [vdf-web-plan.md](./vdf-web-plan.md) — full product and architecture plan.
- [../README.md](../README.md) — deploy, env vars, local dev, upstream updates.

## Repo layout

| Path | Role |
|------|------|
| `upstream/` | Submodule, pinned VDF release tag |
| `server.ts` | Custom Node server (scheduler, scans, streaming) |
| `src/` | Next.js UI and API routes |
| `fixtures/cli-results.json` | Parser contract for CI / Docker build |
| `scripts/update-upstream.sh` | Bump submodule tag and rebuild |

## Local development (Windows)

- Open this folder in Cursor.
- `npm install`, copy `.env.example` → `.env`, `npm run dev` → http://localhost:47821
- ffmpeg/ffprobe on PATH for thumbnails and playback; Docker for full `vdf-cli` scans.
- Clone on Windows use `C:\...\02_vdf-web` via `/mnt/c/...` in WSL is wrong; use real `C:\` paths in PowerShell.

## Origin remote

Project git remote (Cursor Origin):

`https://origin.cursor.com/git/kevin-rosso/tmp-eb081e15f50468e6.git`

Authenticate with `origin auth login` before `git clone` / `git pull`.

## Later: cached remux for playback

Keep live streaming for now. The measured stall is fragmented MP4 over a live ffmpeg pipe (`frag_keyframe`): the browser waits for a full GOP before the first frame, every open and every filmstrip seek restarts ffmpeg, and there is no `Content-Length` so seeking stays custom.

When we revisit speed, pre-remux browser-safe codecs in a non-MP4 container (for example H.264+AAC MKV) once at scan finish: `ffmpeg -i in.mkv -c copy -movflags +faststart` into `dataDir/media/<cacheKey>.mp4`, then serve that file with byte ranges like direct playback. Cost is disk about the size of the source, once per file. True transcodes (HEVC and similar) stay on demand, or get the same cache at a capped resolution if we want that too.

## Agent conventions

- Do not modify files under `upstream/`.
- Minimize diff scope; match existing TypeScript and UI patterns.
- Security: path jail, no shell string interpolation for paths, never return Immich API key to the client.
