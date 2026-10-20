import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { Arrow, BUTTON, INPUT, LABEL, PageHeading, Plate, Rolling } from "../components/ui";
import { getJson, postJson, type PoolInfo, type SetupStatus } from "../lib/api";
import { ADDRESS_PATTERN, formatPercent, shortAddress } from "../lib/format";
import { refreshAll } from "../lib/hooks";
import { FADE_IN, FADE_OUT, SPRING } from "../lib/motion";
import { navigate } from "../lib/router";

type Phase = "idle" | "saving" | "restarting";

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={className}>
      <m.path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
    </svg>
  );
}

function Spinner() {
  return (
    <m.span aria-hidden className="block size-3.5 rounded-full border-2 border-border-strong border-t-brand"
      animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }} />
  );
}

/** One line of the restart checklist: done (a check on the gradient) or under way (a spinner) */
function ChecklistItem({ state, children }: { state: "done" | "active"; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`grid size-6 shrink-0 place-items-center rounded-full ${state === "done" ? "brand-gradient-mark text-black" : "border border-border-strong"}`}>
        {state === "done" ? <Check /> : <Spinner />}
      </span>
      {children}
    </li>
  );
}

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

  const valid = ADDRESS_PATTERN.test(value.trim());

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

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === "restarting" ? (
        <m.div key="restarting" role="status" className="flex flex-col gap-4"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: FADE_IN }} exit={{ opacity: 0, transition: FADE_OUT }}>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            <ChecklistItem state="done">Saved <span className="font-mono text-[13px]">{shortAddress(value)}</span></ChecklistItem>
            <ChecklistItem state="active">Restarting the pool to mine to it</ChecklistItem>
          </ol>
          <p className="text-[13px] text-muted">This takes a few seconds. The page continues on its own.</p>
        </m.div>
      ) : (
        <m.form key="form" onSubmit={submit} noValidate className="flex flex-col gap-3"
          initial={{ opacity: 0 }} animate={{ opacity: 1, transition: FADE_IN }} exit={{ opacity: 0, transition: FADE_OUT }}>
          <label htmlFor="address" className={LABEL}>Your LAX address</label>
          <div className="relative">
            <input id="address" value={value} onChange={e => { setValue(e.target.value); setError(null); }} placeholder="0x…"
              spellCheck={false} autoComplete="off" autoFocus aria-invalid={!!error} aria-describedby={error ? "address-error" : undefined}
              className={`${INPUT} min-h-12 pr-12`} />
            <AnimatePresence>
              {valid && (
                <m.span key="valid" aria-hidden className="brand-gradient-mark absolute top-1/2 right-3 grid size-6 -translate-y-1/2 place-items-center rounded-full text-black"
                  initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={SPRING}>
                  <Check />
                </m.span>
              )}
            </AnimatePresence>
          </div>
          {error && <span id="address-error" role="alert" className="text-[13px] text-critical">{error}</span>}
          <div className="pt-2">
            <button type="submit" disabled={phase === "saving"} className={`group ${BUTTON.primary}`}>
              {phase === "saving" ? "Saving…" : submitLabel}
              <Arrow />
            </button>
          </div>
        </m.form>
      )}
    </AnimatePresence>
  );
}

/** A centred panel for the first-run and waiting screens */
function Stage({ eyebrow, title, children }: { eyebrow: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="title" aria-live="polite" className="mx-auto flex w-full max-w-2xl flex-col gap-8 sm:pt-6">
      <PageHeading eyebrow={eyebrow} title={title} />
      <Plate lit className="flex flex-col gap-6 p-6 sm:p-8">{children}</Plate>
    </section>
  );
}

export function SetupPage() {
  return (
    <Stage eyebrow="First run" title="Set up your pool">
      <p className="text-[17px] text-muted">
        Enter the LAX address that should receive your block rewards. The node mines to it directly: every block you
        find pays this address, and the reward unlocks there after 100 blocks. No keys are stored on this device.
      </p>
      <AddressForm submitLabel="Start mining" />
      <p className="text-[13px] text-muted">
        Need an address? Create one with a Parallax wallet first, see <a href="https://parallaxprotocol.org/" target="_blank" rel="noreferrer" className="text-foreground underline">parallaxprotocol.org</a>.
      </p>
    </Stage>
  );
}

export function SettingsPage({ setup }: { setup: SetupStatus }) {
  return (
    <Stage eyebrow="Settings" title="Reward address">
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Currently mining to</span>
        <span className="font-mono text-[15px] break-all">{setup.address}</span>
      </div>
      <div className="h-px bg-border" />
      <p className="text-muted">
        New blocks pay the new address. Blocks found before the change keep maturing and unlock at the address they were mined to.
      </p>
      <AddressForm current={setup.address} submitLabel="Change address" />
      {setup.previousAddresses.length > 0 && (
        <p className="text-[13px] text-muted">Previously used: <span className="font-mono">{setup.previousAddresses.map(shortAddress).join(", ")}</span></p>
      )}
    </Stage>
  );
}

/** Shown until the pool is online: connecting to the node, or the node downloading the chain */
export function StartingPage({ pool }: { pool: PoolInfo }) {
  const progress = pool.networkStats.syncProgress;
  const peers = pool.networkStats.connectedPeers;

  if(pool.status === "syncing" && progress != null) {
    return (
      <Stage eyebrow="Syncing" title="Downloading the Parallax chain">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <span className="text-7xl leading-none font-semibold tracking-[-0.045em] tabular-nums sm:text-[88px]">
            <Rolling value={formatPercent(progress, 1)} />
          </span>
          <span className="pb-2 text-sm text-muted">{peers ? `from ${peers} ${peers === 1 ? "peer" : "peers"}` : "looking for peers"}</span>
        </div>
        <div role="progressbar" aria-label="Chain download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
          className="relative h-1.5 overflow-hidden bg-track">
          <m.div className="brand-gradient-mark absolute inset-y-0 left-0 overflow-hidden" initial={false}
            animate={{ width: `${progress * 100}%` }} transition={SPRING}>
            <span className="skeleton absolute inset-0 opacity-40 mix-blend-overlay" />
          </m.div>
        </div>
        <p className="text-muted">The pool starts as soon as the node has the whole chain. This page updates on its own.</p>
      </Stage>
    );
  }

  return (
    <Stage eyebrow={<><Spinner /> Starting</>} title="Connecting to the Parallax node">
      <p className="text-muted">
        A new node first has to find peers, then download the chain; after an address change it restarts to
        mine to <span className="font-mono text-foreground">{shortAddress(pool.address)}</span>. This page updates on its own.
      </p>
    </Stage>
  );
}
