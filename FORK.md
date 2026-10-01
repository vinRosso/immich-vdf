# Updating the VDF engine

immich-vdf builds `vdf-cli` from source in `engine/`. The pin is [`engine/UPSTREAM.json`](engine/UPSTREAM.json):

| | |
| --- | --- |
| Upstream | https://github.com/0x90d/videoduplicatefinder |
| Tag | v4.1.1 |
| Commit | `21ec967e2e108bb9a2f09f937be000fb1e2c3615` |
| Trees | `engine/VDF.Core`, `engine/VDF.CLI` |

This repository is not a Git branch of the Video Duplicate Finder desktop app. The desktop UI is not part of the image. `engine/VDF.ForkTests` is ours and is left in place when the engine is updated.

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
