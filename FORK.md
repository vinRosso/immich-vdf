# Updating the VDF engine

immich-vdf builds `vdf-cli` from source in `engine/`. The pin is [`engine/UPSTREAM.json`](engine/UPSTREAM.json):

| | |
| --- | --- |
| Upstream | https://github.com/0x90d/videoduplicatefinder |
| Tag | v4.1.1 |
| Commit | `21ec967e2e108bb9a2f09f937be000fb1e2c3615` |
| Trees | `engine/VDF.Core`, `engine/VDF.CLI` |

This repository is not a Git branch of the Video Duplicate Finder desktop app. The desktop UI is not part of the image. `engine/VDF.ForkTests` is ours and is left in place when the engine is updated.

## What the fork changes

`npm run update-engine` replaces `VDF.Core` and `VDF.CLI`, so these changes have to be applied again afterwards. `git diff` between the previous tree and the new one shows each place.

| Where | Change |
| --- | --- |
| `VDF.Core/TimeWindow.cs` (new) | Capture-time windows: fixed tiles of W days from 2000-01-01, each padded on both sides. |
| `VDF.Core/PairScoreStore.cs` (new) | `PairScores.db` next to `ScannedFiles.db`. Keeps gray scores of 85% and above (and AI scores), the covered files and the window they were compared in. `PairSession` is the per-run view the matching threads use. |
| `VDF.Core/Utils/CaptureTimeReader.cs` (new) | Capture dates from EXIF, or from the container tag for HEIC and video, plus the JSON files that carry dates. |
| `VDF.Core/Settings.cs` | `TimeWindowDays`, `IncrementalCompare` |
| `VDF.Core/FileEntry.cs` | `captureOverride` and `CaptureTime`: a date used instead of `DateCreated` for one compare. Not saved. |
| `VDF.Core/ScanEngine.cs` | `CaptureTimeOverrides`; capture time in `ComparePair`'s window check and the date-sorted loop with a cut-off in `CompareImages`; the pair store wired through `TryCheckDuplicate`, `RememberGray`, the compare set-up and the end of `ScanForDuplicates`; the gray early-exit limit in `TryCompareGrayVideos`; and the incremental compare: `CompareImages`, `CompareVideosLinear` and `CompareEntry` leave out pairs of files whose saved scores still apply and visit only new or changed files and stored matches (`VisitCandidatePositions`). |
| `VDF.Core/Utils/DatabaseUtils.cs` | `ExportImageTimes`, behind `db times` |
| `VDF.Core/VDF.Core.csproj` | `InternalsVisibleTo` for `VDF.ForkTests` |
| `VDF.CLI/Commands/SharedOptions.cs` | `--time-window-days` on `scan` and `compare` |
| `VDF.CLI/Commands/DatabaseCommand.cs` | `db times` |
| `VDF.CLI/Commands/CompareCommand.cs` | `--times <file.json>`, the capture dates for the window, and an exit code |
| `VDF.CLI/Commands/ExifCommand.cs` (new), `VDF.CLI/Program.cs` | `exif --paths <list> --output <json>` |
| `VDF.CLI/Commands/FfmpegCommand.cs` (new), `VDF.CLI/Program.cs` | `ffmpeg status` (exit 0 when `FFmpegHelper.CanLoadNativeLibraries`) and `ffmpeg install` (the engine's own `FfmpegDownloader`, one build per OS and CPU). The app runs these before each scan to decide on `--native-ffmpeg`. |

The pair store keeps nothing for pHash or combined matching, or for a percent under 85. A row is used only while both files still have the size, modified time and capture date they had when it was scored, and the saved settings match: ignore black and white pixels, mirrored compare, thumbnail count, sampling length, the duration limits and the folder rule. When most files are covered by saved scores, a compare only scores pairs that involve a new or changed file and replays the stored matches, in the order a full compare would have used. That needs the saved window to equal the current one (or the whole library), and AI scores to be saved when AI matching is on at the same or a lower AI percent (the store keeps the AI percent it was compared at, `AiFloorPercent`); otherwise every pair is scored. A run that meets a new or changed file only claims the window it used, so a later wider compare scores that file's pairs outside the window instead of skipping them. `IncrementalCompare = false` turns it off. `ForkTests` covers the store, the per-run session and whole compares run twice, so run `npm run test:engine` after every update.

## Pull a newer tag

```bash
npm run update-engine -- v4.2.0
```

The script downloads that GitHub tag, replaces `VDF.Core`, `VDF.CLI`, and `Directory.Build.props`, and writes `engine/UPSTREAM.json` plus `engine/fork-version.txt`. Then:

```bash
npm run build:cli
npm test
npm run test:engine
```

Review the diff before committing. A CLI flag this app passes, or a compare JSON shape the parser cannot read, fails `npm run check-cli` and `npm run verify-fixture`.

Do not download an official `vdf-cli` release. The image and `npm run dev` both compile the tree in `engine/`.

The engine is AGPL-3.0. Copyright headers in those files stay in place. `LICENSE` at the repository root is that license.
