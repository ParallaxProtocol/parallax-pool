import { CopyField } from "../components/ui";
import { DIFF1, type PoolInfo } from "../lib/api";
import { ADDRESS_PATTERN, formatHashrate, shortAddress } from "../lib/format";
import { useStoredState } from "../lib/hooks";
import { Link } from "../lib/router";

export const ADDRESS_KEY = "parallax-pool:address";

export function ConnectPage({ pool }: { pool: PoolInfo }) {
  const [address, setAddress] = useStoredState(ADDRESS_KEY);
  const [worker, setWorker] = useStoredState("parallax-pool:worker", "rig1");

  const host = location.hostname;
  const ports = Object.entries(pool.ports).sort(([a], [b]) => Number(a) - Number(b));
  const [mainPort, main] = ports[0] ?? ["4073", { difficulty: 0.25, tls: false }];
  const scheme = main.tls ? "stratum2+tls" : "stratum2+tcp";
  const validAddress = ADDRESS_PATTERN.test(address);
  const user = `${validAddress ? address : "0xYourAddress"}${worker ? `.${worker}` : ""}`;
  const command = `hashwarp -P ${scheme}://${user}@${host}:${mainPort}`;
  const direct = pool.paymentProcessing.directRewards;

  return (
    <section className="section" aria-labelledby="title">
      <div className="section-head">
        <h1 id="title">Connect a miner</h1>
      </div>

      {direct && (
        <div className="notice">
          <strong>Rewards from this pool go to {shortAddress(pool.address)}.</strong>
          <span>It's set up for solo mining: whoever connects mines for that address. Use your own address below so your rigs show up under your name.</span>
        </div>
      )}

      <div className="connect-grid">
        <ol className="steps">
          <li>
            <span>Enter your LAX address</span>
            <label className="field">
              <span>The address shares are credited to{direct ? "" : " and payouts are sent to"}</span>
              <input value={address} onChange={e => setAddress(e.target.value.trim())} placeholder="0x…" spellCheck={false}
                autoComplete="off" aria-invalid={address !== "" && !validAddress} />
            </label>
            {address !== "" && !validAddress && <span className="muted">That isn't a LAX address: it should be 0x followed by 40 hex characters.</span>}
            <label className="field">
              <span>Worker name, to tell rigs apart</span>
              <input value={worker} onChange={e => setWorker(e.target.value.replace(/[^\w-]/g, ""))} placeholder="rig1" spellCheck={false} />
            </label>
          </li>
          <li>
            <span>Install Hashwarp</span>
            <p className="muted">
              Hashwarp is the XHash GPU miner for Parallax (CUDA and OpenCL). Download it from its{" "}
              <a href="https://github.com/microstack-tech/hashwarp/releases" target="_blank" rel="noreferrer">releases page</a>.
            </p>
          </li>
          <li>
            <span>Start mining</span>
            <CopyField value={command} label="Hashwarp command" />
            <p className="muted">Any miner that speaks EthereumStratum/1.0.0 works with the same address, worker and server.</p>
          </li>
          <li>
            <span>Check your rig</span>
            <p className="muted">
              Shares show up within a minute or two.{" "}
              {validAddress ? <Link href={`/miners/${address}`}>Open your miner page</Link> : "Your miner page appears once you've entered your address."}
            </p>
          </li>
        </ol>

        <div className="section">
          <h2>Server</h2>
          <CopyField value={`${scheme}://${host}:${mainPort}`} label="Stratum server" />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Port</th><th>Connection</th><th className="right">Start difficulty</th><th>Adjusts</th></tr></thead>
              <tbody>
                {ports.map(([port, p]) => (
                  <tr key={port}>
                    <td className="num">{port}</td>
                    <td>{p.tls ? "TLS" : "Plain TCP"}</td>
                    <td className="right num" title={`${formatHashrate((p.difficulty * DIFF1) / 15)} for one share every 15 s`}>{p.difficulty}</td>
                    <td>{p.varDiff ? `Yes, ${p.varDiff.targetTime} s between shares` : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            To pin a difficulty instead, set the miner's password to <code>d=0.5</code> (any value above the port's minimum).
          </p>
        </div>
      </div>
    </section>
  );
}
