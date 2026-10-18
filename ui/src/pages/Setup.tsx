import { useEffect, useState, type FormEvent } from "react";
import { getJson, postJson, type PoolInfo, type SetupStatus } from "../lib/api";
import { ADDRESS_PATTERN, formatPercent, shortAddress } from "../lib/format";
import { refreshAll } from "../lib/hooks";
import { navigate } from "../lib/router";

type Phase = "idle" | "saving" | "restarting";

/** Saves the reward address, then waits for the pool to come back with it */
function AddressForm({ current, submitLabel }: { current?: string | null; submitLabel: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if(phase !== "restarting")
      return;

    // the pool restarts to apply the address; poll until it reports it
    const timer = setInterval(async () => {
      try {
        const [setup, pools] = await Promise.all([
          getJson<SetupStatus>("/api/setup"),
          getJson<{ pools: PoolInfo[] }>("/api/pools"),
        ]);

        if(setup.address?.toLowerCase() === value.toLowerCase() && pools.pools[0]?.address.toLowerCase() === value.toLowerCase()) {
          clearInterval(timer);
          refreshAll();
          navigate("/");
        }
      }
      catch {
        // still restarting
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [phase, value]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = value.trim();

    if(!ADDRESS_PATTERN.test(address)) {
      setError("That isn't a LAX address: it should be 0x followed by 40 hex characters.");
      return;
    }

    if(current && address.toLowerCase() === current.toLowerCase()) {
      setError("That's already the reward address.");
      return;
    }

    setError(null);
    setPhase("saving");

    try {
      await postJson<SetupStatus>("/api/setup", { address });
      setValue(address);
      setPhase("restarting");
    }
    catch(err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  };

  if(phase === "restarting") {
    return (
      <div className="notice" role="status">
        <strong>Saved. Restarting the pool to mine to {shortAddress(value)}…</strong>
        <span className="muted">This takes a few seconds. The page continues on its own.</span>
      </div>
    );
  }

  return (
    <form className="setup-form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Your LAX address</span>
        <input value={value} onChange={e => { setValue(e.target.value); setError(null); }} placeholder="0x…"
          spellCheck={false} autoComplete="off" autoFocus aria-invalid={!!error} aria-describedby={error ? "address-error" : undefined} />
      </label>
      {error && <span id="address-error" className="field-error" role="alert">{error}</span>}
      <div>
        <button type="submit" className="button button-primary" disabled={phase === "saving"}>
          {phase === "saving" ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function SetupPage() {
  return (
    <section className="section setup" aria-labelledby="title">
      <h1 id="title">Set up your pool</h1>
      <p className="hero-lede">
        Enter the LAX address that should receive your block rewards. The node mines to it directly:
        every block you find pays this address, and the reward unlocks there after 100 blocks.
        No keys are stored on this device.
      </p>
      <AddressForm submitLabel="Start mining" />
      <p className="muted">
        Need an address? Create one with a Parallax wallet first, see <a href="https://parallaxprotocol.org/" target="_blank" rel="noreferrer">parallaxprotocol.org</a>.
      </p>
    </section>
  );
}

export function SettingsPage({ setup }: { setup: SetupStatus }) {
  return (
    <section className="section setup" aria-labelledby="title">
      <h1 id="title">Settings</h1>

      <dl className="facts">
        <div><dt>Reward address</dt><dd className="mono">{setup.address}</dd></div>
      </dl>

      <h2>Change the reward address</h2>
      <p className="muted">
        New blocks pay the new address. Blocks found before the change keep maturing and unlock at the address they were mined to.
      </p>
      <AddressForm current={setup.address} submitLabel="Change address" />

      {setup.previousAddresses.length > 0 && (
        <p className="muted">Previously used: {setup.previousAddresses.map(shortAddress).join(", ")}</p>
      )}
    </section>
  );
}

/** Shown until the pool is online: connecting to the node, or the node downloading the chain */
export function StartingPage({ pool }: { pool: PoolInfo }) {
  const progress = pool.networkStats.syncProgress;

  return (
    <section className="section setup" aria-labelledby="title" aria-live="polite">
      {pool.status === "syncing" && progress != null ? (
        <>
          <h1 id="title">Syncing the Parallax node</h1>
          <p className="hero-lede">The pool starts as soon as the node has downloaded the whole chain. This page updates on its own.</p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <p>{formatPercent(progress, 1)} downloaded{pool.networkStats.connectedPeers ? `, from ${pool.networkStats.connectedPeers} peers` : ""}</p>
        </>
      ) : (
        <>
          <h1 id="title">Starting the pool</h1>
          <p className="hero-lede">
            Connecting to the Parallax node. A new node first has to find peers, then download the chain; after an
            address change it restarts to mine to {shortAddress(pool.address)}. This page updates on its own.
          </p>
        </>
      )}
    </section>
  );
}
