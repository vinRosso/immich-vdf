---
title: Engine
parent: Development
nav_order: 4
nav_prev: /dev-image
nav_prev_title: Image
nav_next: /code
nav_next_title: Code
---

# Engine

## On this page

- [What is vendored](#what-is-vendored)
- [Update](#update)

## What is vendored

`engine/` is a vendored copy of Video Duplicate Finder's CLI, not a fork of the desktop app. Do not download an official `vdf-cli` binary. `npm run dev` and the image both compile this tree.

## Update

```bash
npm run update-engine -- v4.1.1
npm run build:cli
npm test
npm run test:engine
```

The script replaces `VDF.Core` and `VDF.CLI` from that upstream tag and writes `engine/UPSTREAM.json`. Review the diff before committing. The longer steps are in [Updating the VDF engine](https://github.com/vinRosso/immich-vdf/blob/main/FORK.md).
