const hashUnits = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s"];

/** 8060737370 -> "8.06 GH/s" */
export function formatHashrate(value: number | null | undefined, digits = 3): string {
  if(!value || !isFinite(value) || value <= 0)
    return "0 H/s";

  let unit = 0;

  while(value >= 1000 && unit < hashUnits.length - 1) {
    value /= 1000;
    unit++;
  }

  return `${formatSignificant(value, digits)} ${hashUnits[unit]}`;
}

/** splits a hashrate into number and unit, for typographic treatment */
export function hashrateParts(value: number | null | undefined): [string, string] {
  const [number, unit] = formatHashrate(value).split(" ");
  return [number, unit];
}

function formatSignificant(value: number, digits: number): string {
  return value >= 100 ? value.toFixed(0) : value.toPrecision(digits).replace(/\.?0+$/, "");
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en");

/** 4188280541303 -> "4.19T" */
export function formatCompact(value: number): string {
  return compact.format(value);
}

/** share difficulty: whole numbers when large, three significant digits when small */
export function formatShareDifficulty(value: number): string {
  return value >= 100 ? integer.format(Math.round(value)) : Number(value.toPrecision(3)).toString();
}

/** block subsidy at a height: 50 LAX, halving every 210,000 blocks */
export function blockReward(height: number): number {
  return 50 / 2 ** Math.floor(height / 210000);
}

export function formatInteger(value: number): string {
  return integer.format(Math.round(value));
}

/** LAX amounts: up to 4 decimals, no trailing zeros */
export function formatLax(value: number): string {
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: value < 1 ? 6 : 4 }).format(value)} LAX`;
}

export function formatPercent(value: number, digits = 1): string {
  if(!isFinite(value))
    return "–";

  return `${(value * 100).toFixed(value * 100 >= 100 ? 0 : digits)}%`;
}

/** a duration in seconds as words: "4 min", "3 h", "2.5 days" */
export function formatDuration(seconds: number): string {
  if(!isFinite(seconds) || seconds < 0)
    return "–";

  if(seconds < 60)
    return `${Math.round(seconds)} s`;

  if(seconds < 3600)
    return `${Math.round(seconds / 60)} min`;

  if(seconds < 86400 * 2)
    return `${(seconds / 3600).toFixed(seconds < 36000 ? 1 : 0).replace(/\.0$/, "")} h`;

  const days = seconds / 86400;

  if(days < 60)
    return `${days.toFixed(days < 10 ? 1 : 0).replace(/\.0$/, "")} days`;

  if(days < 730)
    return `${Math.round(days / 30.4)} months`;

  return `${(days / 365).toFixed(0)} years`;
}

/** time since an ISO timestamp, in words */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if(!iso)
    return "never";

  const seconds = (now - new Date(iso).getTime()) / 1000;

  if(seconds < 45)
    return "just now";

  return `${formatDuration(seconds)} ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** 0x1234567890abcdef... -> "0x1234…cdef" */
export function shortAddress(address: string | null | undefined): string {
  if(!address)
    return "";

  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
