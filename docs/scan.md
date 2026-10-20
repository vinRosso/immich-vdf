---
title: Scan
parent: Usage
nav_order: 4
has_children: true
nav_prev: /files
nav_prev_title: Files
nav_next: /schedule
nav_next_title: Schedule and webhook
---

# Scan

## On this page

- [Which profile](#which-profile)
- [Knobs worth leaving alone](#knobs-worth-leaving-alone)

Open **Immich** or **Files**, pick a profile, and press **Scan**. Only one scan runs at a time, on either page.

![Scan profiles and the Scan button](images/scan.jpg)

A scan first lists the media files in your folders. If no file and no matching setting changed since the last run, both `vdf-cli` steps are skipped and the previous groups stay. Otherwise it runs `vdf-cli scan-and-compare` as one process, so compare reuses what the scan just read. Changing Parallel does not count as a change. The log ends with how long each step took, and the run keeps those timings.

The engine also keeps the pair scores it computed (`PairScores.db`, next to the scan database). When most files are unchanged, a repeat compare only scores pairs that involve a new or changed file and replays the stored matches. That is skipped for pHash and combined matching, for a percent under 85, and when the saved capture window or AI percent does not cover the current one, so those runs score every pair. The first scan after an upgrade that changes the file is a full compare.

## Which profile

| Profile | Use it when | Cost |
| --- | --- | --- |
| **Exact & near** | Copies, renames, and re-encodes. Percent 98. | Fastest |
| **Edited & altered** | Crops, watermarks, flips, quality changes. Percent 92. Mirrored on. | Recommended first pass |
| **AI scan** | Re-edited copies and clips cut from longer videos, without decoding audio. | First run downloads about 100 MB |
| **Deep clean** | Everything above, plus audio fingerprints for a clip inside a longer file. | Slowest |

> Start with **Edited & altered**. Move to **AI scan** when crops and re-edits are still missing. Use **Deep clean** only when you need those partial clips.

## Knobs worth leaving alone

| Control | Suggestion |
| --- | --- |
| Threshold | Leave at 5. Lower is stricter and drops real duplicates. |
| Percent | Let the profile set it (98 or 92). A much lower percent fills the grid with weak matches. |
| Window | Immich defaults to 7 days, so a burst of the same event is compared. Files defaults to 0, the whole library. Raise the Immich window only when the same photo was imported months apart. The date is the one Immich shows, including dates you edited there. The app asks Immich only for dates changed since the last scan, and lists every asset again once a week, so moved and deleted assets are forgotten. Files Immich does not know use the date inside the file (EXIF, or the video's creation tag), then the file's own date. |
| Prefix | Also group images taken within this many seconds when their original file names share a prefix, even if they are not visual duplicates. Default is 5. 0 turns it off. |
| Parallel | Use the suggested value for the CPUs inside the container. |
| Images | Leave on unless you only care about video. |
| pHash | Off unless you already know you want perceptual hashes instead of frame samples. |

**Reset defaults** returns the knobs to the built-in baseline, which is not the same as a profile. Pick the profile again after a reset.

Include at least one folder. Exclude a folder when you know it should never be compared.

A schedule is separate from the controls on the page. See [Schedule and webhook](schedule).
