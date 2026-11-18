---
title: Image
parent: Development
nav_order: 3
nav_prev: /dev-checks
nav_prev_title: Checks
nav_next: /dev-engine
nav_next_title: Engine
---

# Image

## On this page

- [This checkout](#this-checkout)
- [FFmpeg libraries](#ffmpeg-libraries)
- [ONNX Runtime](#onnx-runtime)
- [Publish](#publish)

## This checkout

From this checkout:

```bash
docker compose up -d
```

`docker-compose.yml` builds `immich-vdf:local` and sets `pull_policy: build`, so Compose does not pull from Docker Hub. The Dockerfile compiles `vdf-cli` from `engine/`, runs the test suite and the fixture check, and sets the container paths. The image healthcheck requests `/api/health`.

## FFmpeg libraries

The Dockerfile downloads the FFmpeg 8 shared libraries from a dated BtbN release, checks them against a pinned SHA-256 and keeps them in `/opt/ffmpeg/lib` (`VDF_FFMPEG_LIBS`). With them, scans decode inside `vdf-cli`.

- When the link no longer downloads (a 404), the image still builds without the libraries. Such an image scans with the `ffmpeg` program and never tries to download them at run time, because the installer writes next to `vdf-cli`, a folder the container user cannot write. The scan log says so.
- When the download does not match the checksum, the build fails.
- To update, take a newer `autobuild` tag and its checksum from [FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) (an 8.1 `linux64-gpl-shared` file) and change `FFMPEG_LIBS_URL` and `FFMPEG_LIBS_SHA256`. `docker build --target ffmpeg-libs .` builds only that stage.

## ONNX Runtime

AI match and AI partial need the ONNX Runtime library. The engine would download it from `microsoft/onnxruntime` on GitHub, but that repository returns 404, so the image carries it. The Dockerfile takes the `Microsoft.ML.OnnxRuntime` package from NuGet, checks it against a pinned SHA-256 and keeps the `linux-x64` libraries in `/opt/onnxruntime`.

- At start, the entrypoint copies them to `$XDG_STATE_HOME/VDF/ai`, which is `/data/state/VDF/ai`, once per version. The engine downloads the model there on the first AI scan, so it stays across new containers. The engine's `log.txt` is in `/data/state/VDF` too.
- When the link no longer downloads, the image still builds and the engine tries its own download, which fails. When the download does not match the checksum, the build fails.
- `ONNXRUNTIME_VERSION` must match `AiComponents.RuntimeVersion` in the engine. To update, change both and set `ONNXRUNTIME_NUPKG_SHA256` to the `sha256sum` of the new `.nupkg` (NuGet publishes its SHA-512 to compare against). `docker build --target onnxruntime .` builds only that stage.

## Publish

[docker-compose.example.yml](https://github.com/vinRosso/immich-vdf/blob/main/docker-compose.example.yml) is what users copy. It only pulls `vinrosso/immich-vdf:latest`.

GitHub Actions (`.github/workflows/docker-publish.yml`) builds and pushes the image. Pushing a git tag `v0.1.0` builds that commit and publishes `0.1.0`, `0.1`, `0`, and `latest`. Running the workflow by hand builds the branch you select. It publishes that same set for the highest `vMAJOR.MINOR.PATCH` tag in the repository, or `latest` only when no such tag exists. The workflow needs repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
