# syntax=docker/dockerfile:1

# vdf-cli is built from engine/ (.NET 10).
# Scans decode inside vdf-cli when the FFmpeg 8 shared libraries below are installed, about 4x faster than
# starting one ffmpeg program per frame. If they cannot be fetched the image still builds and scans use the program.
FROM debian:bookworm-slim AS ffmpeg-libs
# A dated release stays downloadable; "latest" does not. When this link stops working, take a newer
# autobuild tag and its checksum from https://github.com/BtbN/FFmpeg-Builds/releases (an 8.1 "linux64-gpl-shared" file).
ARG FFMPEG_LIBS_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-20-13-08/ffmpeg-n8.1.3-18-g46d899d7a0-linux64-gpl-shared-8.1.tar.xz
ARG FFMPEG_LIBS_SHA256=1550d95f723911d1bd356dabfc1c1b6d26b1e7adaa36a5eda203f8e089d2bbd2
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

FROM node:22-bookworm-slim AS web
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
COPY --from=node:22-bookworm-slim /usr/local /usr/local
WORKDIR /app
COPY --from=vdf /out /opt/vdf
COPY --from=ffmpeg-libs /opt/ffmpeg/lib /opt/ffmpeg/lib
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
ENV HOME=/tmp
EXPOSE 4747
# Docker runs HEALTHCHECK directly, not through ENTRYPOINT.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/app/scripts/docker-entrypoint.sh", "node", "scripts/healthcheck.mjs"]
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "server.ts"]
