"""End-to-end driver for tests/e2e/run.sh.

Runs on the test's Docker network: peers the two nodes, mines through the pool's stratum port
with CPU miners (XHash via the pool image's own libxhash.so), and waits until blocks have matured
and (in pool mode) been paid out, then checks the results against the chain.
"""
import ctypes, json, os, socket, sys, threading, time, urllib.request
from decimal import Decimal

MODE = os.environ.get("MODE", "pool")                 # pool | direct
POOL_ADDRESS = os.environ["POOL_ADDRESS"].lower()
NODE1, NODE2 = "http://pp-e2e-node1:8545", "http://pp-e2e-node2:8545"
API = "http://pp-e2e-pool:4000"
STRATUM = ("pp-e2e-pool", 4073)
MINERS = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"]
THREADS_PER_MINER = int(os.environ.get("THREADS_PER_MINER", "2"))
TIMEOUT = int(os.environ.get("TIMEOUT", "900"))
MIN_CONFIRMED = int(os.environ.get("MIN_CONFIRMED", "3"))
FOREVER = os.environ.get("FOREVER") == "1"           # make dev: keep mining, no checks
WEI = 10 ** 18

started = time.time()
stats = {"accepted": 0, "rejected": 0}
stats_lock = threading.Lock()
stop = threading.Event()


def log(msg):
    print(f"[{time.time() - started:6.0f}s] {msg}", flush=True)


def fail(msg):
    log(f"FAIL: {msg}")
    stop.set()
    sys.exit(1)


def rpc(url, method, params=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        reply = json.load(r)
    if reply.get("error"):
        raise RuntimeError(f"{method}: {reply['error']}")
    return reply["result"]


def api(path):
    with urllib.request.urlopen(API + path, timeout=10) as r:
        # amounts as Decimal, so LAX converts to wei exactly
        return r.status, json.load(r, parse_float=Decimal) if r.status != 204 else None


def wait(what, check, timeout=180, every=2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            result = check()
            if result:
                return result
        except Exception:
            pass
        time.sleep(every)
    fail(f"timed out waiting for {what}")


# --- XHash miner ---------------------------------------------------------------------------

LIB = ctypes.CDLL("/e2e/libxhash.so")


class XhashResult(ctypes.Structure):
    _fields_ = [("result", ctypes.c_ubyte * 32), ("mix", ctypes.c_ubyte * 32), ("success", ctypes.c_bool)]


LIB.xhash_light_new_export.restype = ctypes.c_void_p
LIB.xhash_light_new_export.argtypes = [ctypes.c_uint64]
LIB.xhash_light_compute_export.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint64, ctypes.POINTER(XhashResult)]
LIB.xhash_get_seedhash_export.argtypes = [ctypes.c_uint64, ctypes.c_void_p]

contexts, contexts_lock = {}, threading.Lock()


def light_context(seed):
    """light cache for the epoch whose seed hash matches the job's"""
    with contexts_lock:
        if seed not in contexts:
            buf = (ctypes.c_ubyte * 32)()
            for epoch in range(4096):
                LIB.xhash_get_seedhash_export(epoch * 720, buf)
                if bytes(buf).hex() == seed:
                    break
            contexts[seed] = LIB.xhash_light_new_export(epoch * 720)
        return contexts[seed]


def miner(address, worker):
    """EthereumStratum/1.0.0 client (the protocol Hashwarp uses)"""
    sock = socket.create_connection(STRATUM)
    f = sock.makefile("rw")
    state = {"job": None, "diff": 1.0, "extranonce": ""}
    send_lock = threading.Lock()

    def send(msg):
        with send_lock:
            f.write(json.dumps(msg) + "\n")
            f.flush()

    def reader():
        for line in f:
            msg = json.loads(line)
            if msg.get("method") == "mining.notify":
                state["job"] = msg["params"]
            elif msg.get("method") == "mining.set_difficulty":
                state["diff"] = msg["params"][0]
            elif msg.get("id") == 1:
                state["extranonce"] = msg["result"][1]
            elif msg.get("id") == 3:
                with stats_lock:
                    stats["accepted" if msg.get("result") is True else "rejected"] += 1
                if msg.get("result") is not True:
                    log(f"share rejected: {msg.get('error')}")

    send({"id": 1, "method": "mining.subscribe", "params": ["e2e-miner/1.0", "EthereumStratum/1.0.0"]})
    send({"id": 2, "method": "mining.authorize", "params": [f"{address}.{worker}", "x"]})
    threading.Thread(target=reader, daemon=True).start()

    while state["job"] is None or not state["extranonce"]:
        time.sleep(0.1)

    nonce = 0
    while not stop.is_set():
        job = state["job"]
        job_id, seed, header = job[0], job[1].lower(), bytes.fromhex(job[2])
        en1 = state["extranonce"]
        width = 16 - len(en1)
        target = int(2 ** 256 / (state["diff"] * 2 ** 32))
        ctx = light_context(seed)
        result = XhashResult()

        for _ in range(64):
            LIB.xhash_light_compute_export(ctx, header, int(en1 + format(nonce, f"0{width}x"), 16), ctypes.byref(result))
            if int.from_bytes(bytes(result.result), "big") <= target:
                send({"id": 3, "method": "mining.submit", "params": [f"{address}.{worker}", job_id, format(nonce, f"0{width}x")]})
            nonce += 1
            if state["job"] is not job:
                break

    sock.close()


# --- the test --------------------------------------------------------------------------------

def main():
    log(f"mode {MODE}, pool address {POOL_ADDRESS}")

    for url in (NODE1, NODE2):
        wait(f"{url}", lambda: rpc(url, "net_version"))

    enode = rpc(NODE2, "admin_nodeInfo")["enode"]
    node2_ip = socket.gethostbyname("pp-e2e-node2")
    enode = enode.split("@")[0] + "@" + node2_ip + ":" + enode.split("@")[1].split(":")[1].split("?")[0]
    rpc(NODE1, "admin_addPeer", [enode])
    wait("the nodes to peer", lambda: int(rpc(NODE1, "net_peerCount"), 16) > 0)
    log("nodes peered")

    wait("the pool to come online", lambda: api("/api/pools")[1]["pools"][0]["status"] == "online", timeout=240)
    log("pool online")

    balances_before = {a: int(rpc(NODE1, "eth_getBalance", [a, "latest"]), 16) for a in MINERS + [POOL_ADDRESS]}

    for address in MINERS:
        for i in range(THREADS_PER_MINER):
            threading.Thread(target=miner, args=(address, f"cpu{i}"), daemon=True).start()

    if FOREVER:
        log("mining until stopped")
        while True:
            time.sleep(30)
            blocks = api("/api/pools/lax1/blocks?pageSize=500")[1]
            counts = {s: sum(b["status"] == s for b in blocks) for s in ("pending", "confirmed", "orphaned")}
            log(f"height {int(rpc(NODE1, 'eth_blockNumber'), 16)}, blocks {counts}, shares {stats}")

    deadline = time.time() + TIMEOUT
    last_report = 0

    while time.time() < deadline:
        time.sleep(5)
        blocks = api("/api/pools/lax1/blocks?pageSize=500")[1]
        confirmed = [b for b in blocks if b["status"] == "confirmed"]
        payments = api("/api/pools/lax1/payments?pageSize=500")[1]

        if time.time() - last_report > 20:
            counts = {s: sum(b["status"] == s for b in blocks) for s in ("pending", "confirmed", "orphaned")}
            height = int(rpc(NODE1, "eth_blockNumber"), 16)
            log(f"height {height}, blocks {counts}, shares {stats}, payments {len(payments)}")
            last_report = time.time()

        if len(confirmed) < MIN_CONFIRMED:
            continue

        if MODE == "pool":
            paid = {a: sum((p["amount"] for p in payments if p["address"].lower() == a), Decimal(0)) for a in MINERS}
            if not all(paid.values()):
                continue
            # the pool records a payout when it sends the transaction: keep mining until it's in a block
            if any(rpc(NODE1, "eth_getTransactionReceipt", [p["transactionConfirmationData"]]) is None for p in payments):
                continue
            # ... and until the pool has seen every miner's payout through to confirmed
            if not all(any(p["status"] == "confirmed" for p in payments if p["address"].lower() == a) for a in MINERS):
                continue
            stop.set()
            return check_pool_mode(blocks, payments, paid, balances_before)

        stop.set()
        return check_direct_mode(blocks, payments, balances_before)

    fail(f"timed out after {TIMEOUT}s")


def check_common(blocks):
    if stats["rejected"]:
        fail(f"{stats['rejected']} shares were rejected")
    if not stats["accepted"]:
        fail("no shares were accepted")

    for path in ["/api/pools", "/api/pools/lax1", "/api/pools/lax1/performance", "/api/pools/lax1/miners",
                 "/api/v2/pools/lax1/blocks", "/api/v2/pools/lax1/payments", f"/api/pools/lax1/miners/{MINERS[0]}",
                 "/api/setup", "/api/widgets/summary"]:
        status, _ = api(path)
        if status != 200:
            fail(f"{path} answered {status}")

    for block in blocks:
        if block["status"] == "confirmed" and block["reward"] <= 0:
            fail(f"confirmed block {block['blockHeight']} has no reward")


def check_pool_mode(blocks, payments, paid, balances_before):
    check_common(blocks)

    # mining has stopped, so the chain is frozen: compare against exactly the payouts in it
    # (one sent in the last moment is still pending and can't have moved any balance)
    time.sleep(3)
    payments = api("/api/pools/lax1/payments?pageSize=500")[1]
    mined = []

    for p in payments:
        if p["status"] not in ("pending", "confirmed"):
            fail(f"payment of {p['amount']} to {p['address']} is {p['status']}")
        receipt = rpc(NODE1, "eth_getTransactionReceipt", [p["transactionConfirmationData"]])
        if receipt is None:
            if p["status"] == "confirmed":
                fail(f"payment {p['transactionConfirmationData']} is confirmed but not on-chain")
            continue
        if receipt["status"] != "0x1":
            fail(f"payment {p['transactionConfirmationData']} failed on-chain")
        mined.append(p)

    paid = {a: sum((p["amount"] for p in mined if p["address"].lower() == a), Decimal(0)) for a in MINERS}
    payments = mined

    for address in MINERS:
        received = int(rpc(NODE1, "eth_getBalance", [address, "latest"]), 16) - balances_before[address]
        expected = int(paid[address] * WEI)
        if received != expected:
            fail(f"{address} received {received / WEI} LAX on-chain, the API says {paid[address]}")

    log(f"OK: {sum(b['status'] == 'confirmed' for b in blocks)} blocks confirmed, "
        f"{sum(b['status'] == 'orphaned' for b in blocks)} orphaned, {len(payments)} payments "
        f"({', '.join(f'{a[:6]}… {v} LAX' for a, v in paid.items())}) match the chain, {stats['accepted']} shares accepted")


def check_direct_mode(blocks, payments, balances_before):
    check_common(blocks)

    if payments:
        fail(f"direct rewards mode sent {len(payments)} payments")

    confirmed = sum(b["status"] == "confirmed" for b in blocks)
    received = int(rpc(NODE1, "eth_getBalance", [POOL_ADDRESS, "latest"]), 16) - balances_before[POOL_ADDRESS]

    if received < confirmed * 50 * WEI:
        fail(f"pool address received {received / WEI} LAX for {confirmed} confirmed blocks")

    log(f"OK: {confirmed} blocks confirmed, rewards at the pool address (+{received / WEI} LAX), "
        f"no payments, {stats['accepted']} shares accepted")


if __name__ == "__main__":
    main()
