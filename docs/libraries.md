---
title: Two libraries
parent: Usage
nav_order: 1
nav_prev: /usage
nav_prev_title: Usage
nav_next: /immich
nav_next_title: Immich
---

# Two libraries

| | Immich | Files |
| --- | --- | --- |
| Folder | `IMMICH_PATH`, Immich's `UPLOAD_LOCATION` | `MEDIA_PATH`, your external library |
| Access | Read-only, at `/immich` | Read-write, at `/media` |
| Removing a duplicate | Immich trash | `.vdf-trash/` in that folder |
| Stacks | Yes | No |

The Immich page scans `library/<storage label>/`. The admin folder is called `admin`, even if the account has a different display name. Folders Immich generates (`thumbs`, `encoded-video`, `profile`, `backups`) are skipped.

External Immich libraries have their own paths. In Docker, mount each one read-only in immich-vdf at the same path as in Immich. With `npm run dev`, use `VOLUME_BINDS` ([Local app](dev-local#volume-binds)).

The container's user must be able to read the Immich folder, and to rename files in the external library.
