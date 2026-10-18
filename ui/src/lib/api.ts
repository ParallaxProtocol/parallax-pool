// Types for the pool's REST API (src/Miningcore/Api/Responses) and its /notifications events.

export interface CoinConfig {
  type: string;
  name: string;
  symbol: string;
  website?: string;
  family: string;
  algorithm: string;
}

export interface VarDiffConfig {
  minDiff: number;
  maxDiff?: number | null;
  targetTime: number;
}

export interface PoolEndpoint {
  name?: string;
  listenAddress?: string;
  difficulty: number;
  varDiff?: VarDiffConfig | null;
  tls: boolean;
}

export interface PaymentProcessing {
  enabled: boolean;
  minimumPayment: number;
  payoutScheme: string;
  directRewards: boolean;
  payoutSchemeConfig?: { factor?: number; blockFinderPercentage?: number };
}

export interface PoolStats {
  connectedMiners: number;
  poolHashrate: number;
  sharesPerSecond: number;
}

export interface NetworkStats {
  networkType: string;
  networkHashrate: number;
  networkDifficulty: number;
  lastNetworkBlockTime?: string | null;
  blockHeight: number;
  connectedPeers: number;
  nodeVersion: string;
  /** 0..1 while the node is still downloading the chain */
  syncProgress?: number | null;
}

export interface MinerPerformance {
  miner: string;
  hashrate: number;
  sharesPerSecond: number;
}

export type PoolStatus = "starting" | "syncing" | "online";

export interface PoolInfo {
  status: PoolStatus;
  id: string;
  coin: CoinConfig;
  ports: Record<string, PoolEndpoint>;
  paymentProcessing: PaymentProcessing;
  poolFeePercent: number;
  address: string;
  addressInfoLink?: string;
  poolStats: PoolStats;
  networkStats: NetworkStats;
  topMiners: MinerPerformance[];
  totalPaid: number;
  totalBlocks: number;
  totalConfirmedBlocks: number;
  totalPendingBlocks: number;
  blockReward: number;
  lastPoolBlockTime?: string | null;
  poolEffort: number;
}

export type BlockStatus = "pending" | "confirmed" | "orphaned";

export interface Block {
  poolId: string;
  blockHeight: number;
  networkDifficulty: number;
  status: BlockStatus;
  confirmationProgress: number;
  effort?: number | null;
  minerEffort?: number | null;
  reward: number;
  infoLink?: string;
  hash?: string;
  miner: string;
  created: string;
}

export interface Payment {
  address: string;
  addressInfoLink?: string;
  amount: number;
  transactionConfirmationData: string;
  transactionInfoLink?: string;
  created: string;
}

export interface PerformanceSample {
  poolHashrate: number;
  connectedMiners: number;
  validSharesPerSecond: number;
  networkHashrate: number;
  networkDifficulty: number;
  created: string;
}

export interface WorkerPerformance {
  hashrate: number;
  sharesPerSecond: number;
}

export interface WorkerPerformanceContainer {
  created: string;
  workers: Record<string, WorkerPerformance>;
}

export interface MinerStats {
  pendingShares: number;
  pendingBalance: number;
  totalPaid: number;
  todayPaid: number;
  minerEffort: number;
  lastPayment?: string | null;
  lastPaymentLink?: string | null;
  performance?: WorkerPerformanceContainer | null;
  totalConfirmedBlocks: number;
  totalPendingBlocks: number;
}

export interface Paged<T> {
  itemCount: number;
  pageCount: number;
  result: T[];
}

export type PoolEvent =
  | { type: "greeting" }
  | { type: "newchainheight"; poolId: string; blockHeight: number }
  | { type: "blockfound"; poolId: string; blockHeight: number; miner: string }
  | { type: "blockunlocked"; poolId: string; blockHeight: number; status: BlockStatus; reward: number; miner: string }
  | { type: "blockunlockprogress"; poolId: string; blockHeight: number; progress: number }
  | { type: "payment"; poolId: string; amount: number; recipientsCount: number; error?: string | null }
  | { type: "hashrateupdated"; poolId: string; hashrate: number; miner?: string | null; worker?: string | null };

/** First-run setup (only enabled where the deployment protects the UI, e.g. umbrelOS) */
export interface SetupStatus {
  enabled: boolean;
  configured: boolean;
  address?: string | null;
  previousAddresses: string[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: "application/json" } });

  if(!response.ok)
    throw new ApiError(response.status, `${path} answered ${response.status}`);

  // the API answers 204 when there is nothing to report (e.g. a miner it has never seen)
  if(response.status === 204)
    return null as T;

  return response.json() as Promise<T>;
}

/** Number of blocks a coinbase reward stays locked (Parallax consensus, kernel/chainparams) */
export const LOCKBOX_BLOCKS = 100;

/** Target block interval of the Parallax chain, in seconds */
export const BLOCK_TIME = 600;

/** Stratum difficulty 1.0 corresponds to 2^32 hashes */
export const DIFF1 = 2 ** 32;

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });

  // the API answers errors with a plain-text message
  if(!response.ok)
    throw new ApiError(response.status, (await response.text()) || `${path} answered ${response.status}`);

  return response.json() as Promise<T>;
}
