import { createContext, useContext, type ReactNode } from "react";
import type { PoolInfo } from "./api";
import { useApi } from "./hooks";

interface PoolContextValue {
  pools: PoolInfo[];
  pool: PoolInfo | undefined;
  error: Error | undefined;
  loading: boolean;
}

const PoolContext = createContext<PoolContextValue>({ pools: [], pool: undefined, error: undefined, loading: true });

/** Loads /api/pools; the UI shows the first enabled pool (a self-hosted setup normally has one) */
export function PoolProvider({ children }: { children: ReactNode }) {
  const { data, error, loading } = useApi<{ pools: PoolInfo[] }>("/api/pools", 15000);
  const pools = data?.pools ?? [];

  return (
    <PoolContext.Provider value={{ pools, pool: pools[0], error, loading }}>
      {children}
    </PoolContext.Provider>
  );
}

export const usePool = () => useContext(PoolContext);
