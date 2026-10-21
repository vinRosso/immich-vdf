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

- [Connect](#connect)
- [In a group](#in-a-group)
- [Match again](#match-again)
- [Unmatched files](#unmatched-files)

## Connect

Open **Immich**, enter your server URL and an API key, and select **Connect**. The key is stored on the server and never sent back to your browser.

Use the key of the Immich user whose library you want to clean. It lets immich-vdf stack and trash that user's photos. Enter your server's LAN address or Docker service name. `localhost` and `127.0.0.1` won't work.

## In a group

- **Stack best** and **Stack smallest** stack every group at once.
- **Stack selected**, **Add to stack** and **Merge stacks** work on the files you pick.
- **Remove from stack** appears when your selection is a single stack.
- **Keep best, trash rest** and **Trash selected** move files to Immich's trash.
- Choose a stack's cover from the filmstrip.

Files that aren't in a stack come first, then stacks. Within a stack, the cover comes first. Everything else is ordered by date taken.

A group that is already one stack is hidden. If a stack still has a loose duplicate, the group stays visible and shows the stack's other photos too.

## Match again

**Match again** refreshes how your groups line up with Immich, without a new scan. Use it after you change stacks in Immich. New files still need a scan.

## Unmatched files

A file can fail to link to a photo in Immich if its folder isn't available to immich-vdf, or Immich stored it under a different name. Make that folder available at the same path Immich uses (Compose volumes, or `VOLUME_BINDS` for [local development](dev-local#volume-binds)), then select **Match again**. The **Unmatched** page lists the affected files.

Next: [Scan](scan) and [Review](review).
