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
| `VDF.Core/Settings.cs` | `TimeWindowDays` |
| `VDF.Core/ScanEngine.cs` | Time-window check in `ComparePair`, date-sorted loop with a cut-off in `CompareImages`, the pair store wired through `TryCheckDuplicate`, `RememberGray`, the compare set-up and the end of `ScanForDuplicates`, and the gray early-exit limit in `TryCompareGrayVideos`. |
| `VDF.Core/Utils/DatabaseUtils.cs` | `ExportImageTimes`, behind `db times` |
| `VDF.Core/VDF.Core.csproj` | `InternalsVisibleTo` for `VDF.ForkTests` |
| `VDF.CLI/Commands/SharedOptions.cs` | `--time-window-days` on `scan` and `compare` |
| `VDF.CLI/Commands/DatabaseCommand.cs` | `db times` |

The pair store keeps nothing for pHash or combined matching, or for a percent under 85. A row is used only while both files still have the size and modified time they had when it was scored, and the saved settings match: ignore black and white pixels, mirrored compare, thumbnail count, sampling length, the duration limits and the folder rule. `ForkTests` covers the store, the per-run session and whole compares run twice, so run `npm run test:engine` after every update.

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
