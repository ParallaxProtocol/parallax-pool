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
- PPLNS, PPLNSBF, PROP and SOLO payouts, sent as plain transactions from the pool's node account
- Correct maturity handling: rewards are credited after the 100-block lockbox, same-height
  duplicates are orphaned
- REST API and WebSocket event stream (`/notifications`) for blocks, payments and hashrate
- Prometheus metrics, banning, e-mail/Pushover notifications, ZeroMQ share relays for multi-node setups

## Requirements

- A synced `parallaxd` node with HTTP-RPC enabled, at least one peer, and the pool's payout account
  unlocked (see [Node setup](#node-setup))
- PostgreSQL 11 or newer
- Docker, or the .NET 10 SDK plus `make` and `g++` to build from source

## Quick start (Docker)

```bash
docker build -t parallax-pool .

# create the database schema once
psql -h <db-host> -U <db-user> -d <db-name> -f src/Miningcore/Persistence/Postgres/Scripts/createdb.sql

cp examples/parallax_pool.json config.json   # then edit it, see below
docker run -d --name parallax-pool --network host \
  -v "$PWD/config.json:/app/config.json:ro" parallax-pool
```

The API listens on port 4000 and the example stratum port is 4073.

## Build from source

```bash
./build-linux.sh            # publishes into ./build
cd build && ./parallax-pool -c ../config.json
```

The native XHash library is compiled for a portable baseline so the binaries run on any CPU of the
same architecture. Set `CPU_FLAGS=-march=native` to tune it for the build machine instead.

## Configuration

Start from [`examples/parallax_pool.json`](examples/parallax_pool.json). The settings you must change:

| Setting | Meaning |
|---|---|
| `persistence.postgres` | Database connection |
| `pools[].address` | The pool wallet. Must be the node's `--miner.coinbase` and unlocked in the node, because block rewards land there and payouts are sent from it |
| `pools[].rewardRecipients` | Pool fee recipients; percentages of each block reward |
| `pools[].daemons` | `parallaxd` HTTP-RPC endpoint |
| `pools[].ports` | Stratum ports with their starting difficulty and vardiff settings |
| `pools[].paymentProcessing` | `payoutScheme` (`PPLNS`, `PPLNSBF`, `PROP`, `SOLO`) and `minimumPayment` in LAX |

Run `./parallax-pool -c config.json -dc` to print the configuration as the pool understands it.

### Node setup

```bash
parallaxd --http --http.addr 127.0.0.1 --http.api eth,net,web3 \
  --mine --miner.threads 0 --miner.coinbase <POOL_ADDRESS> \
  --unlock <POOL_ADDRESS> --password <password-file> --allow-insecure-unlock
```

`--miner.threads 0` keeps the node's own CPU miner off, so it only serves work to the pool. Keep the
RPC port bound to localhost: anyone who can reach it can spend from the unlocked account.

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
