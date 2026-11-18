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
- [API key permissions](#api-key-permissions)
- [In a group](#in-a-group)
- [Match again](#match-again)
- [Unmatched files](#unmatched-files)

## Connect

Open **Immich**, enter your server URL and an API key, and select **Connect**. The key is stored on the server and never sent back to your browser.

Use the key of the Immich user whose library you want to clean. It lets immich-vdf stack and trash that user's photos. Enter your server's LAN address or Docker service name. `localhost` and `127.0.0.1` won't work.

## API key permissions

In Immich, create the key under **Account Settings → API Keys**. A key with **All** permissions works. To give it only what immich-vdf uses, tick the needed permissions and any optional ones you want.

### Needed

| Permission | What immich-vdf does with it | Without it |
| --- | --- | --- |
| `user.read` | Reads your user id and storage label, to find your folder in the upload library and to test the connection. | **Connect** fails. |
| `asset.read` | Searches your assets to link each scanned file to its Immich photo, and reads dates taken, archived and trashed state. | Files can't be matched to Immich. |
| `asset.view` | Shows Immich thumbnails and plays Immich's video copy in the compare view. | No Immich thumbnails or Immich playback. |
| `asset.delete` | **Keep best, trash rest** and **Trash selected**. Files go to Immich's trash, never deleted for good. | Trashing fails. |
| `stack.read` | Reads your existing stacks so groups keep them. | Existing stacks are ignored. |
| `stack.create` | **Stack best**, **Stack smallest**, **Stack selected**, **Add to stack**, **Merge stacks**. | Stacking fails. |
| `stack.update` | Changes a stack's cover and **Remove from stack**. | Those two actions fail. |

### Optional

| Permission | What immich-vdf does with it | Without it |
| --- | --- | --- |
| `asset.statistics` | Shows the size of your library after you connect. | The total is not shown. |
| `asset.download` | Opens the original file for photo compare when its folder isn't mounted in immich-vdf. | Those photos can't be compared. |
| `album.read` | Shows which albums each file is in. | No album tags. |
| `albumAsset.create` | Adds a file to an album from the compare view. | Adding fails. |
| `albumAsset.delete` | Removes a file from an album from the compare view. | Removing fails. |
| `library.read` | Lists your [external libraries'](install#extra-immich-library-folders) import paths, so they are scanned too. Immich allows this only for an admin's key. | Set those paths in `IMMICH_SCAN_ROOTS` instead. |

immich-vdf never deletes stacks, albums or assets for good, and never changes Immich settings or users.

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
