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

immich-vdf runs as one Docker container. You don't need Node.js or the .NET SDK.

## You need

- Docker Engine with Compose v2
- Immich's upload folder, to use the **Immich** page
- The external library folder Immich reads, to use the **Files** page

## Set up

In an empty folder, save:

- [docker-compose.example.yml](https://github.com/vinRosso/immich-vdf/blob/main/docker-compose.example.yml) as `docker-compose.yml`
- [.env.example](https://github.com/vinRosso/immich-vdf/blob/main/.env.example) as `.env`

### Required

```bash
APP_PASSWORD=choose-a-long-password
MEDIA_PATH=/path/to/external-library
IMMICH_PATH=/path/to/immich/data/library
```

| Variable       | What to put                                                          |
| -------------- | -------------------------------------------------------------------- |
| `APP_PASSWORD` | The password you sign in with. At least 8 characters, and not `change-me`. |
| `MEDIA_PATH`   | Your external library. Mounted read-write at `/media`.               |
| `IMMICH_PATH`  | Immich's `UPLOAD_LOCATION`. Mounted read-only at `/immich`.          |

Immich sees its upload folder as `/data/library`. immich-vdf matches that to `/immich` for you. See [Two libraries](libraries) for what each folder is for.

`PUID` and `PGID` should match the account that owns `MEDIA_PATH` (defaults `1000` and `100`). That account needs to read `IMMICH_PATH` and to create a `.vdf-trash/` folder in `MEDIA_PATH`. On startup the container gives `./data` to the same id and, when the group or other accounts can read that folder, sets mode `700`. A folder already private to the owner is left as it is. Docker creates that host folder as root; startup changes the owner before the server listens. Leave `user:` unset in Compose.

### Optional

| Variable             | What to put                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `TRUSTED_PROXY_CIDR` | The address range of your reverse proxy. Leave empty on a home network.                               |
| `IMMICH_SCAN_ROOTS`  | Extra library folders, written the way Immich writes them. See below.                                 |
| `VOLUME_BINDS`       | For running locally with `npm run dev` only. See [Local app](dev-local#volume-binds). In Docker, use Compose `volumes`. |
| `PUID`               | User id that owns `MEDIA_PATH`. Default `1000`.                                                       |
| `PGID`               | Group id for that account. Default `100`.                                                             |

### Extra Immich library folders

Immich keeps uploaded originals under `/data/library/<storage label>/`. External libraries live at their own paths, for example `/mnt/photos`.

In Docker, mount each extra folder at the same path in Immich and in immich-vdf. If the API key can't list your libraries, also list those paths in `IMMICH_SCAN_ROOTS`:

```yaml
volumes:
  - ${IMMICH_PATH}:/immich:ro
  - /host/photos:/mnt/photos:ro
environment:
  IMMICH_SCAN_ROOTS: /immich,/mnt/photos
```

With `npm run dev`, use `VOLUME_BINDS` in `.env` when your folders don't match Immich's paths. See [Local app — Volume binds](dev-local#volume-binds).

### Reverse proxy

The app serves plain HTTP on port `4747`. Behind a proxy that handles HTTPS, set `TRUSTED_PROXY_CIDR` to the proxy's address range so the sign-in cookie is marked `Secure`. A range as wide as `0.0.0.0/0` is ignored. More in [Security](security).

### Run

```bash
docker compose up -d
```

Open `http://<host>:4747` and sign in. The image is `vinrosso/immich-vdf:latest`. Use `0` or `0.1` to follow the newest release in that line, or pin `0.1.0` to stay on one release.

## Where data lives

| Location                                      | What it holds                                         |
| --------------------------------------------- | ----------------------------------------------------- |
| `./data`, mounted at `/data`                  | Settings, scan data and saved results                 |
| `MEDIA_PATH`, mounted at `/media`             | Your external library. Trashed files go to `.vdf-trash/` inside it. |
| `IMMICH_PATH`, mounted at `/immich` read-only | Immich's originals. immich-vdf never renames them.    |

Immich and Files keep their scan data separately.

{: .warning }
`./data` grows with the number of files you scan, not their size. Tens of thousands of photos usually take about 100 MB. A few hundred thousand files can reach a few GB. Allow some extra room while a scan is saving.

## Update

```bash
docker compose pull
docker compose up -d
```
