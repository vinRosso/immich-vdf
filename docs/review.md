---
title: Review
parent: Usage
nav_order: 5
has_children: true
nav_prev: /schedule
nav_prev_title: Schedule and webhook
nav_next: /photos
nav_next_title: Photos
---

# Review

## On this page

- [Keys](#keys)
- [Keep one file](#keep-one-file)
- [After an action](#after-an-action)
- [Undo](#undo)

Open a group from the results. [Photos](photos) covers zoom and difference. [Groups](groups) covers merging and extracting.

![A photo group, with Extract group and the filmstrip](images/review.jpg)

## Keys

| Key | Action |
| --- | --- |
| `Left` | Previous group |
| `Right` | Next group |

These don't work while you're typing in a field. When the video slider is focused, `Left` and `Right` move through the clip instead. More keys are on [Shortcuts](shortcuts).

## After an action

| What you did | What you see next |
| --- | --- |
| Stacked, trashed or ignored, and the group still has files | The same group |
| The group is gone | The next group |
| Closed the group | The results. Nothing changes. |

Videos play in your browser. If the browser can't play a file directly, it's converted as it plays. Videos in a group play side by side and stay in sync. Photos show one at a time.

## Keep one file

In a group, **Keep best** keeps the best file and trashes the rest. **Keep smallest** does the same with the smallest file. On Immich the button reads **Keep best, trash rest**. **Keep selected** trashes every file you didn't select.

On the results, **Keep best, trash rest** and **Keep smallest, trash rest** do this for every group at once. A confirmation asks first. On Files, the trashed copies can be restored from **Trash**.

## Undo

Ignoring a group, or moving files to the Files trash, shows a notice at the bottom of the screen with an **Undo** link. The link works for 10 minutes, and only until a newer scan replaces the results.

To bring back a file trashed in Immich, restore it from Immich's trash.
