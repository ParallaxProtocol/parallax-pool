# The web UI is static files, built once on the build machine for every target architecture
FROM --platform=$BUILDPLATFORM node:24-alpine AS ui

WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

# The build stage always runs on the build machine's own architecture and cross-compiles
# for the target (.NET publish -a, plus a cross C++ toolchain for libxhash), so arm64
# images don't need the whole build to run under emulation.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS builder

ARG TARGETARCH

RUN apt-get update && \
    apt-get -y install --no-install-recommends make g++ && \
    case "$TARGETARCH:$(dpkg --print-architecture)" in \
        arm64:arm64|amd64:amd64) ;; \
        arm64:*) apt-get -y install --no-install-recommends g++-aarch64-linux-gnu ;; \
        amd64:*) apt-get -y install --no-install-recommends g++-x86-64-linux-gnu ;; \
        *) echo "unsupported target architecture $TARGETARCH" && exit 1 ;; \
    esac && \
    rm -rf /var/lib/apt/lists/*

# GitVersion needs the .git directory, which is not part of the build context:
# the version comes from the build argument instead (set by CI from the release tag)
ARG VERSION=0.0.0-dev

WORKDIR /src
COPY . .
RUN case "$TARGETARCH:$(dpkg --print-architecture)" in \
        arm64:amd64) export CC=aarch64-linux-gnu-gcc CXX=aarch64-linux-gnu-g++ ;; \
        amd64:arm64) export CC=x86_64-linux-gnu-gcc CXX=x86_64-linux-gnu-g++ ;; \
    esac && \
    case "$TARGETARCH" in amd64) arch=x64 ;; *) arch=$TARGETARCH ;; esac && \
    cd src/Miningcore && \
    dotnet publish -c Release -a $arch --self-contained false -o /build \
        -p:DisableGitVersionTask=true -p:Version=$VERSION

FROM mcr.microsoft.com/dotnet/aspnet:10.0

# libzmq5: share relays (ZeroMQ); curl: container health checks
RUN apt-get update && \
    apt-get -y install --no-install-recommends libzmq5 curl && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir /data && chown app:app /data

WORKDIR /app

# Kestrel endpoints come from the pool config (api.listenAddress / api.port)
ENV ASPNETCORE_HTTP_PORTS=
# writable location for the share recovery file (mount /data to keep it)
ENV SHARE_RECOVERY_FILE=/data/recovered-shares.txt

COPY --from=builder /build ./
COPY --from=ui /ui/dist ./wwwroot

USER app

# 4000: API (+ /notifications websocket), 4073: default stratum port
EXPOSE 4000 4073

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -fs "http://127.0.0.1:${API_PORT:-4000}/api/health-check" > /dev/null || exit 1

# with a config file: docker run -v ./config.json:/app/config.json ... ./parallax-pool -c config.json
# without one, the pool is configured from environment variables (see README)
CMD ["./parallax-pool"]
