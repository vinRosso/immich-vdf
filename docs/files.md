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

Set the external library as `MEDIA_PATH`. On the Files page, include that folder (or a subfolder) and scan it. This page does not call the Immich API.

## Trash

Trashing a file renames it into `.vdf-trash/` on the same folder. Restoring moves it back. The container user must be allowed to rename files there.

Immich keeps the asset until its next scan of that library.

## Ignore

Ignoring a file or a group keeps it out of later compares on this page. The file stays where it is.

In a group, **Keep best** and **Keep smallest** trash the other files. **Keep selected** trashes everything you did not select.
