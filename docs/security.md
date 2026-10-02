---
title: Security
parent: Installation
nav_order: 1
nav_prev: /install
nav_prev_title: Installation
nav_next: /usage
nav_next_title: Usage
---

# Security

## On this page

- [What a signed-in session can do](#what-a-signed-in-session-can-do)
- [Network](#network)
- [Container](#container)
- [Engine license](#engine-license)

immich-vdf is a single-user tool for a machine you administer. The password is the whole account.

## What a signed-in session can do

- Read every file under the mounted folders that appears in a scan, and stream it through ffmpeg.
- Rename files into `.vdf-trash/` on `MEDIA_PATH`, and restore them.
- Call the Immich API with the saved key: list assets, stack, and trash.
- Change the Immich URL, the API key, and the webhook URL. Those requests are sent by the server.

Someone who can sign in can reach the media you mounted and the Immich user that key belongs to. `APP_PASSWORD` must be at least 8 characters. `.env.example` ships `change-me`, and the server refuses to start until that value is replaced.

The Immich API key and the session secret are stored on the `vdf-data` volume, not in the image and not in git. The browser receives `apiKeyConfigured`, not the key.

## Network

The container listens with HTTP on port 4747. On a LAN the session cookie is not marked `Secure`. When a reverse proxy terminates HTTPS, set `TRUSTED_PROXY_CIDR` to that proxy's address range so the cookie is marked `Secure` if `X-Forwarded-Proto` is `https`. A catch-all range such as `0.0.0.0/0` is ignored. `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` are removed when the TCP peer is outside that range.

State-changing requests must send an `Origin` or `Referer` whose host matches the request host. The browser does this for the UI.

Login failures are limited to 5 tries per address in a 10 minute window. The count is stored on the data volume and still applies after a restart.

Sessions last 12 hours. Logging out revokes that session. Changing `APP_PASSWORD` and restarting revokes every session. The return path after sign-in can only be a path on this app.

The Immich URL and the webhook URL cannot target loopback, link-local, or cloud metadata addresses. Private LAN addresses such as `192.168.x.x` still work, which is how a home Immich server is reached.

Responses send `X-Frame-Options: DENY`, a `Content-Security-Policy` with `frame-ancestors 'none'`, and `X-Content-Type-Options: nosniff`.

## Container

Compose runs the container as the `user:` id in the Compose file and drops all capabilities. The process never starts as root. Set that line to the account that owns the media: it must be able to read `IMMICH_PATH` and to create `.vdf-trash/` on `MEDIA_PATH`. `/data` is writable by that id, so a new data volume does not have to be chowned first.

FFmpeg decodes the files you mount. A hostile media file is still a risk to that process. Do not point the mounts at collections you do not trust.

## Engine license

The server is AGPL-3.0, including the Video Duplicate Finder engine it builds. Anyone who can use the running app is entitled to the corresponding source.
