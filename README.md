<img src="logo.svg" width="120" alt="Parallax">

# Parallax Pool

A mining pool for [Parallax (LAX)](https://parallaxprotocol.org/), the XHash proof-of-work chain.
Run it for a public pool, a private pool for friends, or to solo-mine against your own node.

Parallax Pool is a Parallax-only fork of [Miningcore](https://github.com/oliverw/miningcore): the
stratum server, share accounting, payout engine and API are Miningcore's; the multi-coin code is gone
and XHash validation, the halving reward schedule and the 100-block coinbase lockbox are built in.

## Features

- XHash share validation in native code (light cache by default, optional in-memory full dataset)
- EthereumStratum/1.0.0 (NiceHash) stratum, optional legacy eth-proxy protocol, TLS ports
- Adaptive share difficulty (vardiff) and static difficulty via the miner password (`d=0.5`)
- Direct rewards for solo mining: block rewards go straight to your wallet, no keys on the server
- PPLNS, PPLNSBF, PROP and SOLO payouts for shared pools, sent from the pool's node account
- Correct maturity handling: rewards are credited after the 100-block lockbox, same-height
  duplicates are orphaned
- REST API and WebSocket event stream (`/notifications`) for blocks, payments and hashrate
- Prometheus metrics, banning, e-mail/Pushover notifications, ZeroMQ share relays for multi-node setups
- Runs from environment variables alone and creates its database schema on first start

## Quick start (Docker Compose)

Runs a Parallax node, PostgreSQL and the pool. Needs Docker with the compose plugin, on amd64 or arm64.

```bash
git clone https://github.com/ParallaxProtocol/parallax-pool && cd parallax-pool
cp .env.example .env     # set POOL_ADDRESS and DB_PASSWORD
docker compose up -d
docker compose logs -f pool
```

The pool waits for the node to sync (about a minute on mainnet today), then accepts miners on port
4073. The API is on port 4000. The node's RPC and the database are not exposed outside the compose
project. Until release images are published, the first `up` reports that it can't pull
`parallaxprotocol/parallax-pool` and builds it locally instead.

### Payout modes

**`PAYOUT_MODE=direct`** (default) is for solo mining to your own wallet. The node mines to
`POOL_ADDRESS`, so every block reward lands there directly. The pool tracks your shares, hashrate and
blocks, and sends nothing. The server holds no keys.

**`PAYOUT_MODE=pool`** is for sharing the pool with other miners. Rewards land at `POOL_ADDRESS` and
are distributed with `PAYOUT_SCHEME` (PPLNS by default), minus `POOL_FEE_PERCENT`, as transactions
sent by the node. The node needs the key for `POOL_ADDRESS` and has to unlock it:

```bash
# password for the pool account, stored in the node's volume
docker compose run --rm --no-deps --entrypoint sh node -c \
  'umask 077 && head -c 24 /dev/urandom | base64 > /home/parallax/.parallax/pool-password.txt'

# create the pool account (or "import <keyfile>" to use an existing key)
docker compose run --rm --no-deps --entrypoint parallax-wallet node new \
  --datadir /home/parallax/.parallax --password /home/parallax/.parallax/pool-password.txt
```

Then set `POOL_ADDRESS` to the printed address, `PAYOUT_MODE=pool` and

```
NODE_EXTRA_ARGS=--unlock <POOL_ADDRESS> --password /home/parallax/.parallax/pool-password.txt --allow-insecure-unlock
```

in `.env`, and run `docker compose up -d` again. Back up the `keystore` directory and the password:
together they control the pool's funds.

### Environment variables

Without a config file, the pool is configured from these variables. Only the first two are required.

| Variable | Default | Meaning |
|---|---|---|
| `POOL_ADDRESS` | | Pool wallet; must be the node's `--miner.coinbase` (the pool refuses to start otherwise) |
| `DB_PASSWORD` | | PostgreSQL password |
| `PAYOUT_MODE` | `direct` | `direct` or `pool`, see above |
| `PAYOUT_SCHEME` | `PPLNS` | `PPLNS`, `PPLNSBF`, `PROP` or `SOLO` (pool mode) |
| `PPLNS_FACTOR` | `2` | PPLNS window, in multiples of the network difficulty |
| `BLOCK_FINDER_PERCENT` | `5` | PPLNSBF bonus for the block finder |
| `POOL_FEE_PERCENT` | `0` | Pool fee (pool mode) |
| `POOL_FEE_ADDRESS` | `POOL_ADDRESS` | Fee recipient |
| `MINIMUM_PAYMENT` | `1` | Minimum payout in LAX |
| `PAYMENT_INTERVAL` | `600` | Seconds between block checks and payout runs |
| `KEEP_TRANSACTION_FEES` | `false` | Keep block transaction fees instead of distributing them |
| `STRATUM_PORT` | `4073` | Stratum port |
| `STRATUM_DIFFICULTY` | `0.25` | Starting share difficulty (1.0 = 2<sup>32</sup> hashes) |
| `VARDIFF_ENABLED` | `true` | Adjust each miner's difficulty to its hashrate |
| `VARDIFF_MIN` / `VARDIFF_MAX` | `0.05` / none | Vardiff bounds |
| `VARDIFF_TARGET_TIME` | `15` | Target seconds between shares per miner |
| `API_PORT` | `4000` | API port |
| `API_RATE_LIMIT` | `20` | API requests per second per IP, `0` disables the limit |
| `NODE_HOST` / `NODE_RPC_PORT` | `127.0.0.1` / `8545` | `parallaxd` HTTP-RPC |
| `NODE_WS_PORT` | none | `parallaxd` WebSocket port, for instant new-block notifications |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_NAME` | `127.0.0.1` / `5432` / `pool` / `pool` | PostgreSQL |
| `POOL_ID` | `lax1` | Pool id used in the API |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `NODE_CACHE`, `NODE_P2P_PORT`, `NODE_EXTRA_ARGS` | | Compose only: node cache (MB), P2P port, extra `parallaxd` flags |

Run `docker compose exec pool ./parallax-pool -dc` to print the configuration as the pool understands it.

## Running without Compose

The image runs on its own against an existing node and database. The schema is created on first start:

```bash
docker run -d --name parallax-pool --network host \
  -e POOL_ADDRESS=0x... -e DB_PASSWORD=... -e NODE_WS_PORT=8546 \
  parallaxprotocol/parallax-pool
```

### Build from source

```bash
./build-linux.sh            # needs the .NET 10 SDK, make and g++; publishes into ./build
cd build && POOL_ADDRESS=0x... DB_PASSWORD=... ./parallax-pool
```

The native XHash library is compiled for a portable baseline so the binaries run on any CPU of the
same architecture. Set `CPU_FLAGS=-march=native` to tune it for the build machine instead.

### Config file

For more than one stratum port, TLS ports, notifications, share relays or several pools, use a config
file instead of environment variables: start from
[`examples/parallax_pool.json`](examples/parallax_pool.json) and run `./parallax-pool -c config.json`
(in Docker: mount it and pass `./parallax-pool -c config.json` as the command).
[`config.schema.json`](src/Miningcore/config.schema.json) lists every option. Set
`paymentProcessing.directRewards` to `true` for direct rewards.

### Node setup

```bash
parallaxd --http --http.addr 127.0.0.1 --http.api eth,net,web3 \
  --ws --ws.addr 127.0.0.1 --ws.api eth,net,web3 \
  --mine --miner.threads 0 --miner.coinbase <POOL_ADDRESS>
```

`--miner.threads 0` keeps the node's own CPU miner off, so it only serves work to the pool. For pool
mode, add `--unlock <POOL_ADDRESS> --password <password-file> --allow-insecure-unlock`, and keep the
RPC bound to localhost: anyone who can reach it can spend from the unlocked account.

## Connecting miners

Use your LAX address as the username, optionally followed by a worker name. With
[Hashwarp](https://github.com/microstack-tech/hashwarp):

```bash
hashwarp -P stratum2+tcp://<LAX_ADDRESS>.<worker>@<pool-host>:4073
```

## API

| Endpoint | Content |
|---|---|
| `GET /api/pools` | All pools with network and pool stats |
| `GET /api/pools/{id}/blocks` | Blocks found, with confirmation progress |
| `GET /api/pools/{id}/payments` | Payouts |
| `GET /api/pools/{id}/miners/{address}` | Miner balance, hashrate and workers |
| `ws://<host>:4000/notifications` | Live events: block found, block unlocked, payment, hashrate |

## Credits and license

Based on [Miningcore](https://github.com/oliverw/miningcore) by Oliver Weichhold and the
[blackmennewstyle/miningcore](https://github.com/blackmennewstyle/miningcore) fork. The XHash library
in `src/Native/libxhash` comes from [ParallaxProtocol/xhash](https://github.com/ParallaxProtocol/xhash)
(Apache-2.0). Licensed under the [MIT License](LICENSE).
