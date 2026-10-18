import { useEffect, useState, type FormEvent } from "react";
import { ErrorNotice, ToastProvider, useToast } from "./components/ui";
import { ADDRESS_PATTERN, formatInteger, formatLax, shortAddress } from "./lib/format";
import { refreshAll, useLiveConnection, usePoolEvents, useStoredState } from "./lib/hooks";
import { PoolProvider, usePool } from "./lib/pool";
import { Link, navigate, usePath } from "./lib/router";
import { ADDRESS_KEY, ConnectPage } from "./pages/Connect";
import { BlocksPage, PaymentsPage } from "./pages/Lists";
import { MinerPage } from "./pages/Miner";
import { Overview } from "./pages/Overview";

export function App() {
  return (
    <ToastProvider>
      <PoolProvider>
        <Shell />
      </PoolProvider>
    </ToastProvider>
  );
}

function Shell() {
  const path = usePath();
  const { pool, error, loading } = usePool();
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
        toast(`Block ${formatInteger(event.blockHeight)} found by ${shortAddress(event.miner)}`);
        break;

      case "blockunlocked":
        refreshAll();

        if(event.status === "confirmed")
          toast(`Block ${formatInteger(event.blockHeight)} unlocked: ${formatLax(event.reward)}`);
        break;
    }
  });

  useEffect(() => {
    const titles: Record<string, string> = { "/blocks": "Blocks", "/payments": "Payments", "/connect": "Connect" };
    const page = path.startsWith("/miners/") ? `Miner ${shortAddress(path.slice(8))}` : titles[path];
    document.title = page ? `${page} | Parallax Pool` : "Parallax Pool";
  }, [path]);

  let content;

  if(!pool) {
    content = error
      ? <ErrorNotice error={error} what="the pool" />
      : <p className="muted">{loading ? "Loading…" : "This pool has no enabled pools configured."}</p>;
  }
  else if(path === "/" || path === "")
    content = <Overview pool={pool} />;
  else if(path === "/blocks")
    content = <BlocksPage pool={pool} />;
  else if(path === "/payments")
    content = <PaymentsPage pool={pool} />;
  else if(path === "/connect")
    content = <ConnectPage pool={pool} />;
  else if(path.startsWith("/miners/"))
    content = <MinerPage key={path} pool={pool} address={decodeURIComponent(path.slice(8))} />;
  else
    content = (
      <section className="section">
        <h1>Page not found</h1>
        <p className="muted"><Link href="/">Go to the overview</Link></p>
      </section>
    );

  const nav = [["/", "Overview"], ["/blocks", "Blocks"], ["/payments", "Payments"], ["/connect", "Connect"]];

  return (
    <div className="shell">
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="brand">
            <img src="/logo.svg" alt="" />
            Parallax Pool
          </Link>
          {pool && (
            <span className="network" title={live ? "Live updates connected" : "Live updates disconnected, refreshing periodically"}>
              <span className="live-dot" data-live={live} />
              {pool.networkStats.networkType}
            </span>
          )}
          <nav className="nav" aria-label="Main">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
            ))}
          </nav>
          <Lookup />
        </div>
      </header>

      <main className="main" id="content">{content}</main>

      <footer className="footer">
        <div className="footer-inner">
          <span>Parallax Pool</span>
          {pool && <span>{pool.paymentProcessing.directRewards ? "Direct rewards" : `${pool.paymentProcessing.payoutScheme} payouts`}</span>}
          <a href="https://parallaxprotocol.org/" target="_blank" rel="noreferrer">About Parallax</a>
          <a href="https://github.com/ParallaxProtocol/parallax-pool" target="_blank" rel="noreferrer">Source</a>
        </div>
      </footer>
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
    <form className="lookup" role="search" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="lookup">Look up a miner by address</label>
      <input id="lookup" value={value} onChange={e => { setValue(e.target.value); setInvalid(false); }}
        placeholder="Look up your address (0x…)" spellCheck={false} autoComplete="off"
        aria-invalid={invalid} title={invalid ? "Enter a LAX address: 0x followed by 40 hex characters" : undefined} />
    </form>
  );
}
