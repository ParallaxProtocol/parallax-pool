import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, LazyMotion, m, MotionConfig } from "motion/react";
import { ErrorNotice, INPUT, LiveDot, Skeleton, ToastProvider, useToast } from "./components/ui";
import { BLOCK_TIME } from "./lib/api";
import { ADDRESS_PATTERN, formatInteger, formatLax, shortAddress } from "./lib/format";
import { refreshAll, useLiveConnection, useNow, usePoolEvents, useStoredState } from "./lib/hooks";
import { ENTER, FADE_OUT, SPRING } from "./lib/motion";
import { PoolProvider, usePool } from "./lib/pool";
import { Link, navigate, usePath } from "./lib/router";
import { ADDRESS_KEY, ConnectPage } from "./pages/Connect";
import { BlocksPage, PaymentsPage } from "./pages/Lists";
import { MinerPage } from "./pages/Miner";
import { Overview } from "./pages/Overview";
import { SettingsPage, SetupPage, StartingPage } from "./pages/Setup";

const loadFeatures = () => import("./lib/motion-features").then(module => module.default);

export function App() {
  return (
    // strict: only the lightweight `m` components, with the features loaded once here, in a chunk of their own.
    // Every animation follows the viewer's reduced motion setting: transforms jump, fades stay
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <PoolProvider>
            <Shell />
          </PoolProvider>
        </ToastProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

function Shell() {
  const path = usePath();
  const { pool, setup, error, loading } = usePool();
  const live = useLiveConnection();
  const toast = useToast();

  usePoolEvents(event => {
    switch(event.type) {
      case "newchainheight":
      case "payment":
        refreshAll();
        break;

      case "blockfound":
        refreshAll();
        toast({ kicker: "Block found", title: `#${formatInteger(event.blockHeight)}`, detail: <>by <span className="font-mono text-foreground">{shortAddress(event.miner)}</span> · unlocks in 100 blocks</> });
        break;

      case "blockunlocked":
        refreshAll();

        if(event.status === "confirmed")
          toast({ kicker: "Reward unlocked", title: `#${formatInteger(event.blockHeight)}`, detail: `${formatLax(event.reward)} is now spendable` });
        break;
    }
  });

  useEffect(() => {
    const titles: Record<string, string> = { "/blocks": "Blocks", "/payments": "Payments", "/connect": "Connect", "/settings": "Settings" };
    const page = path.startsWith("/miners/") ? `Miner ${shortAddress(path.slice(8))}` : titles[path];
    document.title = page ? `${page} | Parallax Pool` : "Parallax Pool";
  }, [path]);

  const setupPending = !!setup?.enabled && !setup.configured;
  let view: string;
  let content;

  if(setupPending) {
    view = "setup";
    content = <SetupPage />;
  }
  else if(path === "/settings" && setup?.enabled && setup.canChange) {
    view = path;
    content = <SettingsPage setup={setup} />;
  }
  else if(pool && pool.status !== "online" && path !== "/connect") {
    view = "starting";
    content = <StartingPage pool={pool} />;
  }
  else if(!pool) {
    view = "loading";
    content = error
      ? <ErrorNotice error={error} what="the pool" />
      : loading ? <LoadingPage /> : <p className="text-muted">This pool has no enabled pools configured.</p>;
  }
  else {
    view = path;

    if(path === "/" || path === "")
      content = <Overview pool={pool} />;
    else if(path === "/blocks")
      content = <BlocksPage pool={pool} />;
    else if(path === "/payments")
      content = <PaymentsPage pool={pool} />;
    else if(path === "/connect")
      content = <ConnectPage pool={pool} />;
    else if(path.startsWith("/miners/"))
      content = <MinerPage pool={pool} address={decodeURIComponent(path.slice(8))} />;
    else
      content = (
        <section className="flex flex-col gap-4">
          <h1 className="text-[40px]">Page not found</h1>
          <p className="text-muted"><Link href="/" className="text-foreground underline">Go to the overview</Link></p>
        </section>
      );
  }

  const nav = [["/", "Overview"], ["/blocks", "Blocks"], ["/payments", "Payments"], ["/connect", "Connect"]];

  if(setup?.enabled && setup.configured && setup.canChange)
    nav.push(["/settings", "Settings"]);

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-20 border-b border-border bg-header backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-7 gap-y-3 px-4 pt-3 sm:px-6 lg:min-h-16 lg:pt-0">
          {/* The main site's mark and name, at its header's size: a 32px mark, the name at 30px */}
          <Link href="/" className="flex items-center gap-3 text-[30px] leading-none font-medium tracking-[-0.04em] no-underline">
            <img src="/logo.svg" alt="" className="size-8" />
            Parallax Pool
          </Link>

          {pool?.status === "online" && (
            <span className="inline-flex items-center gap-2 border border-border px-2.5 py-[3px] font-mono text-[11px] tracking-[0.12em] text-muted uppercase"
              title={live ? "Live updates connected" : "Live updates disconnected, refreshing periodically"}>
              <LiveDot live={live} />
              {pool.networkStats.networkType} · {live ? "live" : "polling"}
            </span>
          )}

          {!setupPending && (
            <>
              <nav aria-label="Main" className="order-last -mx-3 flex w-[calc(100%+24px)] overflow-x-auto [scrollbar-width:none] lg:order-none lg:mx-0 lg:w-auto">
                {nav.map(([href, label]) => {
                  const current = href === "/" ? path === "/" || path === "" : path.startsWith(href);

                  return (
                    <Link key={href} href={href} aria-current={current ? "page" : undefined}
                      className={`relative px-3 py-3 font-medium whitespace-nowrap no-underline transition-colors duration-200 lg:py-5 ${current ? "text-foreground" : "text-muted hover:text-foreground"}`}>
                      {label}
                      {/* One underline, gliding to the current page */}
                      {current && <m.span layoutId="nav-underline" className="brand-gradient-mark absolute inset-x-3 -bottom-px h-0.5" transition={SPRING} />}
                    </Link>
                  );
                })}
              </nav>
              <Lookup />
            </>
          )}
        </div>
        {pool?.status === "online" && <HeaderClock lastBlockTime={pool.networkStats.lastNetworkBlockTime} />}
      </header>

      <main id="content" className="mx-auto w-full max-w-[1240px] flex-1 px-4 pt-10 pb-24 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={view} className="flex flex-col gap-14"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: ENTER }} exit={{ opacity: 0, transition: FADE_OUT }}>
            {content}
          </m.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap gap-x-5 gap-y-2 px-4 py-6 font-mono text-xs tracking-[0.08em] text-muted uppercase sm:px-6">
          <span>Parallax Pool</span>
          {pool && <span>{pool.paymentProcessing.directRewards ? "Direct rewards" : `${pool.paymentProcessing.payoutScheme} payouts`}</span>}
          <a href="https://parallaxprotocol.org/" target="_blank" rel="noreferrer" className="hover:text-foreground">About Parallax</a>
          <a href="https://github.com/ParallaxProtocol/parallax-pool" target="_blank" rel="noreferrer" className="hover:text-foreground">Source</a>
        </div>
      </footer>

      {/* The site-wide grain, as on parallax-stats. Left out on touch screens, where a full-screen SVG filter is
          redrawn whenever the address bar resizes the viewport */}
      <svg aria-hidden className="pointer-events-none fixed inset-0 z-50 size-full opacity-[0.02] [@media(pointer:coarse)]:hidden">
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" /></filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
}

/**
 * Time since the last block, as a hairline along the header's bottom edge filling toward three target
 * intervals. It ticks on its own, so the page under it does not re-render every second.
 */
function HeaderClock({ lastBlockTime }: { lastBlockTime?: string | null }) {
  const now = useNow(1000);
  const elapsed = lastBlockTime ? Math.max(0, (now - new Date(lastBlockTime).getTime()) / 1000) : 0;

  return (
    <div aria-hidden className="relative h-0.5 bg-track">
      {/* keyed by the block, so a new one starts the fill afresh rather than draining it back */}
      <div key={lastBlockTime ?? ""} className="brand-gradient-mark absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear"
        style={{ width: `${Math.min(1, elapsed / (3 * BLOCK_TIME)) * 100}%` }} />
    </div>
  );
}

/** The overview's shape while the pool's first answer is on its way */
function LoadingPage() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-wrap gap-6">
      <Skeleton className="h-[440px] min-w-0 flex-[1_1_560px]" />
      <Skeleton className="h-[440px] min-w-0 flex-[1_1_400px]" />
    </div>
  );
}

function Lookup() {
  const [stored] = useStoredState(ADDRESS_KEY);
  const [value, setValue] = useState(stored);
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const address = value.trim();

    if(!ADDRESS_PATTERN.test(address)) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    navigate(`/miners/${address}`);
  };

  return (
    <form role="search" onSubmit={submit} className="ml-auto flex min-w-48 flex-[1_1_220px] lg:flex-[0_1_300px]">
      <label className="sr-only" htmlFor="lookup">Look up a miner by address</label>
      <input id="lookup" value={value} onChange={e => { setValue(e.target.value); setInvalid(false); }}
        placeholder="Look up an address (0x…)" spellCheck={false} autoComplete="off" className={INPUT}
        aria-invalid={invalid} title={invalid ? "Enter a LAX address: 0x followed by 40 hex characters" : undefined} />
    </form>
  );
}
