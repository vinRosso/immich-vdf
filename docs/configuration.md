# Configuration

Users change `.env`, the `user:` id, and, when needed, volume lines in their Compose file. Paths inside the container (`/media`, `/immich`, `/data`, the `vdf-cli` binary) are set in the image. The sample `user: "1000:1000"` is only a starting id. Replace it with the account that owns `MEDIA_PATH`.

## `.env`

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_PASSWORD` | yes | Single password for the UI. At least 8 characters. `change-me` is refused at startup. |
| `MEDIA_PATH` | yes | Host folder mounted read-write at `/media`. |
| `IMMICH_PATH` | yes | Host upload folder mounted read-only at `/immich`. |
| `TRUSTED_PROXY_CIDR` | no | Network of a reverse proxy that may set `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. Use the proxy's own range, a `/8` or tighter. `0.0.0.0/0` is ignored. Leave empty on a plain LAN. |
| `IMMICH_SCAN_ROOTS` | no | Comma-separated scan roots inside the container. Fallback when the API key cannot list libraries. |

Local development uses extra variables. Docker ignores them because they are not passed into the container. See [Development](development.md).

## In the web UI

After sign-in, open **Immich** and save the Immich URL and an API key. The key stays on the data volume. The browser is told only that a key is saved.

The key should belong to the Immich user whose library you want to clean. It can stack and trash that user's assets. It does not see other users' assets.

Use the Immich server's LAN address or its Docker service name. `localhost` and `127.0.0.1` are refused, including from inside this container.

**Files** and **Immich** each have:

- folders to include
- a similarity and scan profile
- how many jobs run at once
- a schedule and a time zone, defaulting to UTC

A schedule runs that section only. A scan already in progress is not started again.

## Reverse proxy

The app speaks HTTP. On a LAN, publish port `4747` and leave `TRUSTED_PROXY_CIDR` empty. If a reverse proxy terminates HTTPS in front of it, set `TRUSTED_PROXY_CIDR` to that proxy's address range so the session cookie is marked `Secure` when `X-Forwarded-Proto` is `https`. The header is ignored from any other address.

## Time and hardware

Schedules use the time zone you pick in the UI, not the host's zone, unless you pick that zone.

Parallel work is capped from the CPU count visible inside the container. Give the container the CPUs you want it to use. FFmpeg for playback and thumbnails shares that same limit.
