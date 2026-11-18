# syntax=docker/dockerfile:1

# vdf-cli is built from engine/ (.NET 10).
# Scans decode inside vdf-cli when the FFmpeg 8 shared libraries below are installed, about 4x faster than
# starting one ffmpeg program per frame. If they cannot be fetched the image still builds and scans use the program.
FROM debian:bookworm-slim AS ffmpeg-libs
# A dated release keeps one checksum, but BtbN deletes dated releases after about a month ("latest" changes daily).
# Before a release, take a newer autobuild tag and its checksum from https://github.com/BtbN/FFmpeg-Builds/releases
# (an 8.1 "linux64-gpl-shared" file; GitHub shows each file's SHA-256).
ARG FFMPEG_LIBS_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-18-12-39/ffmpeg-n8.1.3-36-ge22a4510c9-linux64-gpl-shared-8.1.tar.xz
ARG FFMPEG_LIBS_SHA256=700803775cd1b6ba1cad0c91d5ec4ac6897814b34d9d7d69186d95844a62cba4
# A link that no longer downloads leaves the image without the libraries (scans use the ffmpeg program). A download that
# does not match the checksum stops the build: that is a changed or damaged file, not a missing one.
RUN set -eu; \
  mkdir -p /opt/ffmpeg/lib; \
  apt-get update; \
  apt-get install -y --no-install-recommends curl ca-certificates xz-utils; \
  if curl -fsSL -o /tmp/ffmpeg.tar.xz "$FFMPEG_LIBS_URL"; then \
    echo "$FFMPEG_LIBS_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg/lib --strip-components=2 --wildcards '*/lib/*.so*'; \
  else \
    echo "FFmpeg 8 libraries not downloaded: scans will use the ffmpeg program"; \
  fi

# AI matching needs the ONNX Runtime library. The engine downloads it from microsoft/onnxruntime on GitHub, which
# now returns 404, so the image carries it. NuGet keeps every version; ONNXRUNTIME_VERSION must match
# AiComponents.RuntimeVersion in the engine. The checksum is of the whole .nupkg (NuGet publishes its SHA-512).
FROM debian:bookworm-slim AS onnxruntime
ARG ONNXRUNTIME_VERSION=1.23.2
ARG ONNXRUNTIME_NUPKG_SHA256=25fe172f7fcdf34f2b5b02c8b997f6b88abc282956849d4af4335af23d0c4e4a
# Same rule as FFmpeg: a link that no longer downloads leaves AI matching to the engine's own download; a
# checksum mismatch stops the build.
RUN set -eu; \
  mkdir -p /opt/onnxruntime; \
  apt-get update; \
  apt-get install -y --no-install-recommends curl ca-certificates unzip; \
  if curl -fsSL -o /tmp/ort.nupkg "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/$ONNXRUNTIME_VERSION/microsoft.ml.onnxruntime.$ONNXRUNTIME_VERSION.nupkg"; then \
    echo "$ONNXRUNTIME_NUPKG_SHA256  /tmp/ort.nupkg" | sha256sum -c -; \
    unzip -j -q /tmp/ort.nupkg 'runtimes/linux-x64/native/*' -d /opt/onnxruntime; \
    echo "$ONNXRUNTIME_VERSION" > /opt/onnxruntime/runtime.version; \
  else \
    echo "ONNX Runtime not downloaded: AI matching will try the engine's own download"; \
  fi

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS vdf
WORKDIR /src
COPY engine/VDF.Core/VDF.Core.csproj VDF.Core/
COPY engine/VDF.CLI/VDF.CLI.csproj VDF.CLI/
COPY engine/Directory.Build.props ./
RUN dotnet restore VDF.CLI/VDF.CLI.csproj
COPY engine/VDF.Core/ VDF.Core/
COPY engine/VDF.CLI/ VDF.CLI/
COPY engine/fork-version.txt ./
# Same override as an upstream tagged release: source stays 4.1.0, the build is stamped with the vendored tag.
RUN version=$(tr -d '[:space:]' < fork-version.txt) \
  && dotnet publish VDF.CLI/VDF.CLI.csproj -c Release -o /out --no-restore -p:VersionPrefix=$version

FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm test && npm run verify-fixture && npm run build

# .NET 10 ships Ubuntu images. Debian tags such as 10.0-bookworm-slim are not published.
FROM mcr.microsoft.com/dotnet/runtime:10.0-noble
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates util-linux \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node:24-bookworm-slim /usr/local /usr/local
WORKDIR /app
COPY --from=vdf /out /opt/vdf
COPY --from=ffmpeg-libs /opt/ffmpeg/lib /opt/ffmpeg/lib
COPY --from=onnxruntime /opt/onnxruntime /opt/onnxruntime
COPY --from=web /app /app
RUN rm -rf /app/upstream /app/engine /app/agent-tools
ENV NODE_ENV=production \
  PORT=4747 \
  DATA_DIR=/data \
  MEDIA_ROOTS=/media \
  IMMICH_LIBRARY=/immich \
  VDF_CLI=/opt/vdf/vdf-cli \
  VDF_FFMPEG_LIBS=/opt/ffmpeg/lib \
  DOTNET_RUNNING_IN_CONTAINER=true \
  NEXT_TELEMETRY_DISABLED=1
# The CLI uses --db only when that directory already exists. The server creates
# /data/db/server and /data/db/immich before each scan. Inside this runtime image
# DOTNET_RUNNING_IN_CONTAINER skips the "database next to the exe" fallback, so a
# missing --db directory would land in $XDG_STATE_HOME/VDF instead.
RUN /opt/vdf/vdf-cli --help >/dev/null \
  && node --import tsx scripts/check-cli-help.ts \
  && node --import tsx scripts/verify-fixture.ts \
  && mkdir -p /data \
  && chmod 1777 /data \
  && chmod 755 /app/scripts/docker-entrypoint.sh \
  && command -v setpriv >/dev/null
# The engine keeps the AI runtime and model and its log.txt in $XDG_STATE_HOME/VDF. Under /data they survive a new
# container; the entrypoint copies the runtime from /opt/onnxruntime there. Set after the build-time CLI run above,
# so the image has no root-owned /data/state.
ENV HOME=/tmp \
  XDG_STATE_HOME=/data/state
EXPOSE 4747
# Docker runs HEALTHCHECK directly, not through ENTRYPOINT.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/app/scripts/docker-entrypoint.sh", "node", "scripts/healthcheck.mjs"]
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "server.ts"]
