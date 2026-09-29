# Fork

This repository vendors Video Duplicate Finder's engine and builds `vdf-cli` from that tree. It does not track upstream as a submodule and does not download official CLI releases.

| | |
| --- | --- |
| Upstream | https://github.com/0x90d/videoduplicatefinder |
| Vendored tag | v4.1.1 |
| Vendored commit | `21ec967e2e108bb9a2f09f937be000fb1e2c3615` |
| Trees | `engine/VDF.Core`, `engine/VDF.CLI` |

The engine is AGPLv3. Copyright headers in those files stay in place. `LICENSE` at the repo root is that license.

Later upstream changes are manual ports against the commit above, not a pull of the submodule.
