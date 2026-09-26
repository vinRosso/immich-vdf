# syntax=docker/dockerfile:1

# vdf-cli is built the same way as upstream VDF.CLI/Dockerfile (.NET 10, process-mode ffmpeg).
# Native FFmpeg bindings need FFmpeg 8 shared libraries and are not used.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS vdf
WORKDIR /src
COPY upstream/VDF.Core/VDF.Core.csproj VDF.Core/
COPY upstream/VDF.CLI/VDF.CLI.csproj VDF.CLI/
RUN dotnet restore VDF.CLI/VDF.CLI.csproj
COPY upstream/VDF.Core/ VDF.Core/
COPY upstream/VDF.CLI/ VDF.CLI/
RUN dotnet publish VDF.CLI/VDF.CLI.csproj -c Release -o /out --no-restore

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm test && npm run verify-fixture && npm run build

FROM mcr.microsoft.com/dotnet/runtime:10.0-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node:22-bookworm-slim /usr/local /usr/local
WORKDIR /app
COPY --from=vdf /out /opt/vdf
COPY --from=web /app /app
RUN rm -rf /app/upstream /app/agent-tools
ENV NODE_ENV=production \
  PORT=47821 \
  DATA_DIR=/data \
  VDF_CLI=/opt/vdf/vdf-cli \
  DOTNET_RUNNING_IN_CONTAINER=true \
  NEXT_TELEMETRY_DISABLED=1
# The CLI uses --db only when that directory already exists. The server creates
# /data/db/server and /data/db/immich before each scan. Inside this runtime image
# DOTNET_RUNNING_IN_CONTAINER skips the "database next to the exe" fallback, so a
# missing --db directory would land in $XDG_STATE_HOME/VDF instead.
RUN /opt/vdf/vdf-cli --help >/dev/null \
  && node --import tsx scripts/check-cli-help.ts \
  && node --import tsx scripts/verify-fixture.ts
EXPOSE 47821
CMD ["node", "--import", "tsx", "server.ts"]
