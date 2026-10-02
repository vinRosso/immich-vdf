---
title: Immich
parent: Usage
nav_order: 2
nav_prev: /libraries
nav_prev_title: Two libraries
nav_next: /files
nav_next_title: Files
---

# Immich

## On this page

- [In a group](#in-a-group)

Open **Immich**, save the server URL and an API key, and check the connection. The key stays on the data volume. The browser is told only that a key is saved.

Use the Immich user's key for the library you want to clean. It can stack and trash that user's assets. Use the server's LAN address or its Docker service name. `localhost` and `127.0.0.1` are refused.

Card posters for matched assets come from the Immich API. Playback still needs the original on the read-only mount.

## In a group

- **Stack all**, **Stack selected**, **Add to stack**, **Merge stacks**
- **Remove from stack** when the selection is one stack
- **Keep best, trash rest** and **Trash selected**
- Set the stack cover from the filmstrip

Loose items are shown before stacks. Inside a stack, the cover comes first. Items follow capture date.

A file can fail to match an asset when its path is outside the mount, or when Immich stored a collision name (`name+1.ext`). Mount that folder the same way Immich does, then match again.

Scanning and comparing are on [Scan](scan) and [Review](review).
