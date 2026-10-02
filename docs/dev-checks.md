---
title: Checks
parent: Development
nav_order: 2
nav_prev: /dev-local
nav_prev_title: Local app
nav_next: /dev-image
nav_next_title: Image
---

# Checks

```bash
npm test
npm run lint
npm run typecheck
npm run check-cli
npm run verify-fixture
npm run test:engine
```

`check-cli` fails when a `vdf-cli` flag this app passes disappears. `verify-fixture` fails when `fixtures/cli-results.json` no longer matches the parser. The image build runs those two, so a CLI change fails in Docker instead of on a scan later.

`npm run test:engine` is the C# tests under `engine/VDF.ForkTests`.
