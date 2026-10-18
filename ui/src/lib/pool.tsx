import { createContext, useContext, type ReactNode } from "react";
import type { PoolInfo, SetupStatus } from "./api";
import { useApi } from "./hooks";

interface PoolContextValue {
  pools: PoolInfo[];
  pool: PoolInfo | undefined;
  setup: SetupStatus | undefined;
  error: Error | undefined;
  loading: boolean;
}

const PoolContext = createContext<PoolContextValue>({ pools: [], pool: undefined, setup: undefined, error: undefined, loading: true });

/** Loads /api/pools and /api/setup; the UI shows the first enabled pool (a self-hosted setup normally has one) */
export function PoolProvider({ children }: { children: ReactNode }) {
  const { data, error, loading } = useApi<{ pools: PoolInfo[] }>("/api/pools", 15000);
  const setup = useApi<SetupStatus>("/api/setup", 60000);
  const pools = data?.pools ?? [];

  return (
    <PoolContext.Provider value={{ pools, pool: pools[0], setup: setup.data, error, loading: loading || setup.loading }}>
      {children}
    </PoolContext.Provider>
  );
}

export const usePool = () => useContext(PoolContext);
