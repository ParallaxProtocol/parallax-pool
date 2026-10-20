import type { ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { CopyField, INPUT, LABEL, Notice, PageHeading, Plate } from "../components/ui";
import { DIFF1, type PoolInfo } from "../lib/api";
import { ADDRESS_PATTERN, formatHashrate, shortAddress } from "../lib/format";
import { useStoredState } from "../lib/hooks";
import { SPRING } from "../lib/motion";
import { Link } from "../lib/router";

export const ADDRESS_KEY = "parallax-pool:address";

/**
 * One step of the timeline: a numbered marker that fills with the logo's gradient and draws a check once the
 * step is done, and a rail down to the next step that fills behind it.
 */
function Step({ n, title, done = false, last = false, children }: { n: number; title: string; done?: boolean; last?: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4">
      <div className="flex flex-col items-center">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-border-strong bg-plate font-mono text-xs font-medium">
          <AnimatePresence initial={false}>
            {done && (
              <m.span key="done" className="brand-gradient-mark absolute -inset-px grid place-items-center rounded-full text-black"
                initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={SPRING}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <m.path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.1 }} />
                </svg>
              </m.span>
            )}
          </AnimatePresence>
          <span className={done ? "invisible" : ""}>{n}</span>
          {done && <span className="sr-only">done</span>}
        </span>
        {!last && (
          <span aria-hidden className="relative my-2 w-px flex-1 bg-border-strong">
            <m.span className="absolute inset-0 origin-top bg-[linear-gradient(to_bottom,var(--mark-from),var(--mark-to))]"
              initial={false} animate={{ scaleY: done ? 1 : 0 }} transition={SPRING} />
          </span>
        )}
      </div>
      <div className={`flex min-w-0 flex-col gap-3 ${last ? "" : "pb-10"}`}>
        <h2 className="pt-0.5 text-[22px] leading-tight">{title}</h2>
        {children}
      </div>
    </li>
  );
}

export function ConnectPage({ pool }: { pool: PoolInfo }) {
  const [address, setAddress] = useStoredState(ADDRESS_KEY);
  const [worker, setWorker] = useStoredState("parallax-pool:worker", "rig1");

  const host = location.hostname;
  const ports = Object.entries(pool.ports).sort(([a], [b]) => Number(a) - Number(b));
  const [mainPort, main] = ports[0] ?? ["4073", { difficulty: 0.25, tls: false }];
  const server = `${host}:${mainPort}`;
  // the URL form other EthereumStratum/1.0.0 miners take
  const url = `${main.tls ? "stratum2+ssl" : "stratum2+tcp"}://${server}`;
  const validAddress = ADDRESS_PATTERN.test(address);
  // Hashwarp v2's own options (docs/MINING.md): it builds the stratum login, address.worker, itself and tries
  // EthereumStratum/1.0.0 first, which is what this pool speaks
  const command = [
    `hashwarp --pool ${server}`,
    main.tls && "--tls",
    `--wallet ${validAddress ? address : "0xYourAddress"}`,
    worker && `--worker ${worker}`,
  ].filter(Boolean).join(" ");
  const direct = pool.paymentProcessing.directRewards;

  return (
    <section aria-labelledby="title" className="flex flex-col gap-10">
      <PageHeading eyebrow="Connect" title="Start mining in four steps">
        Point any XHash miner at this pool. Your address and worker name go into the command below as you type.
      </PageHeading>

      {direct && (
        <Notice title={`Rewards from this pool go to ${shortAddress(pool.address)}.`}>
          It's set up for solo mining: whoever connects mines for that address. Use your own address below so your rigs show up under your name.
        </Notice>
      )}

      <div className="flex flex-wrap items-start gap-x-14 gap-y-12">
        <ol className="m-0 flex min-w-0 flex-[3_1_520px] list-none flex-col p-0">
          <Step n={1} title="Enter your LAX address" done={validAddress}>
            <label className="flex flex-col gap-2 text-[13px] text-muted">
              The address shares are credited to{direct ? "" : " and payouts are sent to"}
              <input value={address} onChange={e => setAddress(e.target.value.trim())} placeholder="0x…" spellCheck={false}
                autoComplete="off" aria-invalid={address !== "" && !validAddress} className={INPUT} />
            </label>
            {address !== "" && !validAddress && <span className="text-[13px] text-critical">That isn't a LAX address: it should be 0x followed by 40 hex characters.</span>}
            <label className="flex flex-col gap-2 text-[13px] text-muted">
              Worker name, to tell rigs apart
              <input value={worker} onChange={e => setWorker(e.target.value.replace(/[^\w-]/g, ""))} placeholder="rig1" spellCheck={false} className={`${INPUT} max-w-xs`} />
            </label>
          </Step>
          <Step n={2} title="Install Hashwarp">
            <p className="text-muted">
              Hashwarp is the XHash GPU miner for Parallax (CUDA and OpenCL). Get version 2.0.0 or newer from its{" "}
              <a href="https://github.com/ParallaxProtocol/hashwarp/releases" target="_blank" rel="noreferrer" className="text-foreground underline">releases page</a>.
            </p>
          </Step>
          <Step n={3} title="Start mining">
            <CopyField value={command} label="Hashwarp command" terminal />
            <p className="text-[13px] text-muted">
              Other miners that speak EthereumStratum/1.0.0 connect to <code className="font-mono text-foreground">{url}</code> with your address and worker as the user, <code className="font-mono text-foreground">address.worker</code>.
            </p>
          </Step>
          <Step n={4} title="Check your rig" last>
            <p className="text-muted">
              Shares show up within a minute or two.{" "}
              {validAddress ? <Link href={`/miners/${address}`} className="text-foreground underline">Open your miner page</Link> : "Your miner page appears once you've entered your address."}
            </p>
          </Step>
        </ol>

        <Plate as="aside" aria-labelledby="server-title" className="flex min-w-0 flex-[2_1_340px] flex-col gap-5 p-6">
          <h2 id="server-title" className={LABEL}>Server</h2>
          <CopyField value={server} label="Stratum server" />
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {ports.map(([port, p]) => (
              <li key={port} className="flex flex-col gap-1 border border-border bg-background px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-lg font-medium">{port}</span>
                  <span className={LABEL}>{p.tls ? "TLS" : "Plain TCP"}</span>
                </div>
                <span className="text-[13px] text-muted">
                  Starts at difficulty <span className="text-foreground tabular-nums" title={`${formatHashrate((p.difficulty * DIFF1) / 15)} for one share every 15 s`}>{p.difficulty}</span>
                  {p.varDiff ? `, adjusts toward a share every ${p.varDiff.targetTime} s` : ", fixed"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted">
            To pin a difficulty instead, set the password to <code className="font-mono text-foreground">d=0.5</code> (any value above the port's minimum); with Hashwarp, add <code className="font-mono text-foreground">--password d=0.5</code>.
          </p>
        </Plate>
      </div>
    </section>
  );
}
