FROM mcr.microsoft.com/dotnet/sdk:10.0 AS builder

RUN apt-get update && \
    apt-get -y install --no-install-recommends make g++ && \
    rm -rf /var/lib/apt/lists/*

# GitVersion needs the .git directory, which is not part of the build context:
# the version comes from the build argument instead (set by CI from the release tag)
ARG VERSION=0.0.0-dev

WORKDIR /src
COPY . .
RUN cd src/Miningcore && \
    dotnet publish -c Release -o /build -p:DisableGitVersionTask=true -p:Version=$VERSION

FROM mcr.microsoft.com/dotnet/aspnet:10.0

# libzmq5: share relays (ZeroMQ); curl: container health checks
RUN apt-get update && \
    apt-get -y install --no-install-recommends libzmq5 curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Kestrel endpoints come from the pool config (api.listenAddress / api.port)
ENV ASPNETCORE_HTTP_PORTS=

COPY --from=builder /build ./

USER app

# 4000: API (+ /notifications websocket), 4073: default stratum port
EXPOSE 4000 4073
CMD ["./parallax-pool", "-c", "config.json"]
