---
title: Installation
nav_order: 2
has_children: true
nav_prev: /
nav_prev_title: Home
nav_next: /usage
nav_next_title: Usage
---

# Installation

## On this page

- [You need](#you-need)
- [Set up](#set-up)
- [Where data lives](#where-data-lives)
- [Update](#update)

One container. Docker pulls the image. You do not need Node.js or the .NET SDK.

## You need

- Docker Engine with Compose v2
- Immich's upload folder, if you will use the **Immich** page
- The external library folder Immich reads, if you will use the **Files** page

## Set up

In an empty directory, save:

- [docker-compose.example.yml](https://github.com/vinRosso/immich-vdf/blob/main/docker-compose.example.yml) as `docker-compose.yml`
- [.env.example](https://github.com/vinRosso/immich-vdf/blob/main/.env.example) as `.env`.

### Required

```bash
APP_PASSWORD=choose-a-long-password
MEDIA_PATH=/path/to/external-library
IMMICH_PATH=/path/to/immich/data/library
```


| Variable       | What to put                                               |
| -------------- | --------------------------------------------------------- |
| `APP_PASSWORD` | At least 8 characters. `change-me` is refused.            |
| `MEDIA_PATH`   | External library. Mounted read-write at `/media`.         |
| `IMMICH_PATH`  | Immich `UPLOAD_LOCATION`. Mounted read-only at `/immich`. |


Immich mounts that folder at `/data/library` in its own container. This app maps paths under `/data/...` onto `/immich`. What each folder is for is on [Two libraries](libraries).

`PUID` and `PGID` are the account that owns `MEDIA_PATH`. Defaults are `1000` and `100`. That account must be able to read `IMMICH_PATH` and to create `.vdf-trash/` on `MEDIA_PATH`. On startup the container gives `./data` to the same id and, when the group or other accounts can read that folder, sets mode `700`. A folder already private to the owner is left as it is. Docker creates that host folder as root; startup changes the owner before the server listens. Leave `user:` unset in Compose.

### Optional


| Variable             | What to put                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `TRUSTED_PROXY_CIDR` | The reverse proxy's address range. Leave empty on a plain LAN.                               |
| `IMMICH_SCAN_ROOTS`  | Extra scan roots inside the container. Leave unset unless the API key cannot list libraries. |
| `PUID`               | User id that owns `MEDIA_PATH`. Default `1000`.                                               |
| `PGID`               | Group id for that account. Default `100`.                                                     |


The app speaks HTTP on port `4747`. A range as wide as `0.0.0.0/0` is ignored. When the proxy is trusted and `X-Forwarded-Proto` is `https`, the session cookie is marked `Secure`. What a signed-in session can reach is on [Security](security).

### Run

```bash
docker compose up -d
```

Open `http://<host>:4747` and sign in. The image is `vinrosso/immich-vdf:latest`. Pin a version, such as `0.1.0`, to stay on one release.

## Where data lives


| Location                                      | What it holds                                       |
| --------------------------------------------- | --------------------------------------------------- |
| `./data`, mounted at `/data`                  | Settings, session, scan databases, results          |
| `MEDIA_PATH`, mounted at `/media`             | External library. Trash is `.vdf-trash/` inside it. |
| `IMMICH_PATH`, mounted at `/immich` read-only | Immich originals. This app does not rename them.    |


Immich and Files keep separate scan databases under `/data/db/immich` and `/data/db/server`.

{: .warning }
`./data` grows with how many files you scan, not with how large those files are. Each database stores a small grayscale sample of every file so later scans can compare without reading the originals again. Tens of thousands of photos are usually around 100 MB. A few hundred thousand files can reach a few GB. A save in progress can briefly keep a second copy. AI partial matching adds about 25 KB per video.

## Update

```bash
docker compose pull
docker compose up -d
```

