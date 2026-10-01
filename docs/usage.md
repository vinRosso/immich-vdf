# Using immich-vdf

Sign in with `APP_PASSWORD`. The home page shows a preview of the latest Files group and the latest Immich group.

## Scan

Open **Files** or **Immich**, check the folders, and start a scan.

A scan runs `vdf-cli scan` and then `vdf-cli compare`. If the files and the scan settings have not changed, compare is skipped and the previous groups stay. Files and Immich never share a database, so one section cannot reuse the other's hashes.

Immich scans the signed-in user's originals under the upload mount: `library/<storage label>/`. The admin user's folder is `admin`, even when the display name is different. Generated folders (`thumbs`, `encoded-video`, `profile`, `backups`) are skipped. Immich's own thumbnail cache is not read.

Only one scan runs at a time.

## Review

Open a group to compare its files. Arrow keys move between groups. Playback is the original file when the browser can play it, and an ffmpeg stream otherwise. Filmstrip frames are cut from that file.

For a matched Immich asset, the card poster is the Immich thumbnail for that asset. Unmatched files and the filmstrip still need the mounted original.

## Files trash

Trashing a file in **Files** renames it into `.vdf-trash/` on the same mount. Restoring moves it back. The mount must be writable by the user running the container.

## Immich actions

These use the API key and do not change the read-only mount:

- stack the selected assets
- remove selected assets from their stack, leaving them as loose items in the group
- set the stack cover
- trash assets in Immich

Loose items are shown before stacks. Within a stack, the cover comes first. Items are ordered by capture date.

After an action the viewer stays on that group when the group still exists. It advances only when the group is gone. Closing the viewer is the action that leaves the group without changing it.

## Ignore

Ignoring a file keeps it out of later compares for that section. The file stays where it is.

## Unmatched Immich files

A file in the scan can fail to match an Immich asset when its path is outside the mounted folders, or when Immich stored a collision name (`name+1.ext`). Mount the missing folder the same way Immich does, then match again. The API key has to be able to see the asset.
