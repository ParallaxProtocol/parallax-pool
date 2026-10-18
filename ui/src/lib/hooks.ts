import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getJson, type PoolEvent } from "./api";

// --- live events -------------------------------------------------------------------------

const events = new EventTarget();
let socket: WebSocket | null = null;
let listeners = 0;
let retry = 0;
let connected = false;
const connectionListeners = new Set<() => void>();

function setConnected(value: boolean) {
  connected = value;
  connectionListeners.forEach(l => l());
}

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/notifications`;
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    retry = 0;
    setConnected(true);
  };

  ws.onmessage = e => {
    try {
      const event = JSON.parse(e.data) as PoolEvent;
      events.dispatchEvent(new CustomEvent("pool", { detail: event }));
    }
    catch {
      // not an event
    }
  };

  ws.onclose = () => {
    setConnected(false);

    if(socket !== ws || listeners === 0)
      return;

    // back off up to 30s, the pool may be restarting
    const delay = Math.min(30000, 1000 * 2 ** retry++);
    setTimeout(() => listeners > 0 && socket === ws && connect(), delay);
  };
}

/** Subscribes to the pool's /notifications stream (one shared socket for the whole app) */
export function usePoolEvents(handler: (event: PoolEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const listener = (e: Event) => ref.current((e as CustomEvent<PoolEvent>).detail);
    events.addEventListener("pool", listener);

    if(listeners++ === 0)
      connect();

    return () => {
      events.removeEventListener("pool", listener);

      if(--listeners === 0) {
        const ws = socket;
        socket = null;
        ws?.close();
      }
    };
  }, []);
}

export function useLiveConnection(): boolean {
  return useSyncExternalStore(
    l => { connectionListeners.add(l); return () => connectionListeners.delete(l); },
    () => connected);
}

// --- data --------------------------------------------------------------------------------

const refreshes = new EventTarget();

/** Asks every mounted useApi to refetch (e.g. when a new block arrives) */
export function refreshAll() {
  refreshes.dispatchEvent(new Event("refresh"));
}

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/**
 * Fetches a JSON endpoint and refetches it every `intervalMs` and on refreshAll().
 * While refetching, the previous data stays in place (no flash of empty content).
 */
export function useApi<T>(path: string | null, intervalMs = 30000): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: undefined, error: undefined, loading: path != null });
  const pathRef = useRef(path);

  const load = useCallback(async (signal?: AbortSignal) => {
    if(!path)
      return;

    setState(s => ({ ...s, loading: true }));

    try {
      const data = await getJson<T>(path, signal);

      if(pathRef.current === path)
        setState({ data, error: undefined, loading: false });
    }
    catch(error) {
      if((error as Error).name !== "AbortError" && pathRef.current === path)
        setState(s => ({ ...s, error: error as Error, loading: false }));
    }
  }, [path]);

  useEffect(() => {
    pathRef.current = path;
    setState({ data: undefined, error: undefined, loading: path != null });

    if(!path)
      return;

    const controller = new AbortController();
    load(controller.signal);

    const timer = setInterval(() => document.visibilityState === "visible" && load(), intervalMs);
    const onRefresh = () => load();
    refreshes.addEventListener("refresh", onRefresh);

    return () => {
      controller.abort();
      clearInterval(timer);
      refreshes.removeEventListener("refresh", onRefresh);
    };
  }, [path, intervalMs, load]);

  return state;
}

/** Current time, ticking every `intervalMs` (for "4 min ago" style labels) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** Persisted per-viewer preference (the miner's own address, for example) */
export function useStoredState(key: string, initial = ""): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    }
    catch {
      return initial;
    }
  });

  const update = useCallback((next: string) => {
    setValue(next);

    try {
      if(next)
        localStorage.setItem(key, next);
      else
        localStorage.removeItem(key);
    }
    catch {
      // private mode or storage disabled: keep it for this visit only
    }
  }, [key]);

  return [value, update];
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
