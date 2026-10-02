---
title: Development
nav_order: 4
has_children: true
nav_prev: /shortcuts
nav_prev_title: Shortcuts
nav_next: /dev-local
nav_next_title: Local app
---

# Development

Users pull the Docker image. This section is for changing the app or the engine.

```mermaid
flowchart LR
  local["Run locally"] --> change["Edit src or server.ts"]
  change --> checks["Tests and CLI checks"]
  checks --> image["Local image"]
  image --> publish["Tag to publish"]
  checks --> engine["Update engine"]
```

| Step | Page |
| --- | --- |
| Run the app on your machine | [Local app](dev-local) |
| Prove a change | [Checks](dev-checks) |
| Build what Compose runs here | [Image](dev-image) |
| Pull a newer Video Duplicate Finder tag | [Engine](dev-engine) |
| Find the module that owns a behavior | [Code](code) |

`server.ts` is the process Compose starts. `next start` is not used.

| Path | Role |
| --- | --- |
| `engine/` | VDF.Core, VDF.CLI, and the upstream pin |
| `server.ts` | HTTP server, scheduler, scan job, ffmpeg streaming |
| `src/` | Next.js UI and JSON API |
| `fixtures/cli-results.json` | Parser contract for tests and the image build |
| `docs/immich-vdf-plan.md` | Design notes. Not published on the docs site. |
