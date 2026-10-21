---
title: Files
parent: Usage
nav_order: 3
nav_prev: /immich
nav_prev_title: Immich
nav_next: /scan
nav_next_title: Scan
---

# Files

## On this page

- [Trash](#trash)
- [Ignore](#ignore)

Set your external library as `MEDIA_PATH`. On the Files page, add that folder (or a subfolder) and scan it. This page doesn't use Immich.

## Trash

Trashing a file moves it into a `.vdf-trash/` folder in the same library. **Restore** puts it back. The container's user must be allowed to rename files there.

Immich keeps showing the photo until it rescans that library.

## Ignore

Ignoring a group keeps it out of later scans. The files stay where they are, and you can restore the group from **Ignored**.

In a group, **Keep best, trash rest** and **Keep smallest, trash rest** trash everything else. **Keep selected** trashes every file you didn't select.
