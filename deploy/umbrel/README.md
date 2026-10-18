# Parallax Pool for umbrelOS

`parallax-pool/` is the umbrelOS app package: a Parallax node, PostgreSQL and the pool, with the web
UI behind Umbrel's login. This directory is laid out as an Umbrel community app store (store id
`parallax`), and the same package directory is what gets submitted to the official
[Umbrel App Store](https://github.com/getumbrel/umbrel-apps).

## How it works

- **First run.** On first open the pool asks for a LAX address. It's saved under
  `data/settings`. The pool restarts to use it, and the node's startup loop restarts `parallaxd` with
  `--miner.coinbase` set to it, and again whenever it's changed under **Settings**.
- **Direct rewards.** Block rewards go straight to that address. No keys or wallets live on the device.
- **No privileged node RPC.** The node's RPC only serves the public `eth`, `net` and `web3`
  namespaces. Umbrel's app network is shared with other apps, so it exposes no accounts and no
  `miner` or `admin` controls.
- **Ports.**
  - `3473` is the web UI, through `app_proxy`.
  - `4073` is stratum, for miners.
  - `32110` (TCP and UDP) is the node's P2P port.
- **Data.** Everything lives in `data/` (node, db, pool, settings). The chain data in `data/node` is
  excluded from backups, since it can be downloaded again.

## Releasing

The package pins every image by tag and multi-arch digest, which umbrelOS requires.

1. **Publish the pool image.** Tag a release (`git tag v0.1.0 && git push --tags`). The Docker
   workflow publishes `parallaxprotocol/parallax-pool:0.1.0` for amd64 and arm64. It needs the
   `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository secrets.
2. **Pin the digest.** Run `docker buildx imagetools inspect parallaxprotocol/parallax-pool:0.1.0`,
   confirm that both `linux/amd64` and `linux/arm64` are listed, and put the top-level `Digest:` into
   `parallax-pool/docker-compose.yml` in place of the all-zero placeholder.
3. **Match the versions.** Set `version` in `umbrel-app.yml` to the same release.

## Community app store

Publish this directory (`umbrel-app-store.yml` plus `parallax-pool/`) as the root of a public Git
repository. In umbrelOS, open the App Store, choose **Community App Stores** and add the repository
URL. The app shows up as **Parallax Pool** in the "Parallax" store. For a community store, an `icon:`
URL can be added to the manifest.

## Official App Store

Copy `parallax-pool/` into a fork of
[getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps). Run its linter
(`npm run lint:apps -- parallax-pool --check-images`), test the package through umbrelOS as that
repository's `umbrel-test-app` guide describes, and open a pull request. Then set `submission` in the
manifest to the pull request URL; the linter requires it. Screenshots and the logo go in the pull
request description, not into the package.
