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
| Folder | `IMMICH_PATH`, Immich's `UPLOAD_LOCATION` | `MEDIA_PATH`, the external library |
| Mount | Read-only at `/immich` | Read-write at `/media` |
| Delete | Immich trash, via the API | `.vdf-trash/` on that folder |
| Stacks | Yes | No |
| Database | `/data/db/immich` | `/data/db/server` |

The Immich page scans `library/<storage label>/`. The admin folder is `admin`, even when the display name is different. Generated folders (`thumbs`, `encoded-video`, `profile`, `backups`) are skipped.

The container user must be able to read the Immich folder and to rename files on the external library.
