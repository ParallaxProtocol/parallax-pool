import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BlockStatus } from "../lib/api";

// --- status ----------------------------------------------------------------------------

const statusLabel: Record<BlockStatus, string> = {
  pending: "Maturing",
  confirmed: "Confirmed",
  orphaned: "Orphaned",
};

/** Block status: icon + label, never color alone */
export function Status({ status }: { status: BlockStatus }) {
  return (
    <span className="status">
      <StatusIcon status={status} />
      {statusLabel[status]}
    </span>
  );
}

function StatusIcon({ status }: { status: BlockStatus }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true } as const;

  switch(status) {
    case "confirmed":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="7" fill="var(--good)" />
          <path d="M4 7.2l2 2 4-4.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "pending":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" fill="none" stroke="var(--warning)" strokeWidth="2" />
          <path d="M7 1a6 6 0 0 1 6 6H7z" fill="var(--warning)" />
        </svg>
      );
    case "orphaned":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="7" fill="var(--critical)" />
          <path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

// --- copy ------------------------------------------------------------------------------

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
    catch {
      // clipboard needs a secure context (https or localhost); the text stays selectable
    }
  };

  return (
    <div className="copy-field">
      <code aria-label={label}>{value}</code>
      <button type="button" className="button" onClick={copy} aria-live="polite">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// --- tooltip ---------------------------------------------------------------------------

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Positioned next to the pointer (or focused element), flipped to stay inside the viewport */
export function Tooltip({ state }: { state: TooltipState | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if(!state || !ref.current)
      return;

    const { width, height } = ref.current.getBoundingClientRect();
    const left = state.x + 14 + width > window.innerWidth - 8 ? state.x - 14 - width : state.x + 14;
    const top = Math.min(Math.max(8, state.y - height - 10), window.innerHeight - height - 8);
    setPosition({ left: Math.max(8, left), top });
  }, [state]);

  if(!state)
    return null;

  return (
    <div ref={ref} className="tooltip" role="tooltip" style={position}>
      {state.content}
    </div>
  );
}

// --- toasts ----------------------------------------------------------------------------

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts(t => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 8000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className="toast">{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// --- states ----------------------------------------------------------------------------

export function ErrorNotice({ error, what }: { error: Error; what: string }) {
  return (
    <div className="notice" data-tone="error" role="alert">
      <strong>Couldn't load {what}.</strong>
      <span className="muted">{error.message}. The pool may be restarting; this page retries on its own.</span>
    </div>
  );
}
