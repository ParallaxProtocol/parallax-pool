import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ElementType, type ReactNode, type Ref } from "react";
import { AnimatePresence, m, type PanInfo } from "motion/react";
import type { BlockStatus } from "../lib/api";
import { prefersReducedMotion } from "../lib/hooks";
import { FADE_OUT, ROLL, SPRING } from "../lib/motion";
import { Link } from "../lib/router";

// --- surfaces and type -----------------------------------------------------------------

/**
 * The structural surface, as on parallax-stats: square corners, a hairline border, and brand corner brackets
 * that surface on hover (or stay, `lit`). `flash` replays a brief glow of the border whenever it changes.
 */
export function Plate({ as: Tag = "div", className = "", lit = false, flash, children, ...rest }: {
  as?: ElementType;
  className?: string;
  lit?: boolean;
  flash?: string | number | null;
  children: ReactNode;
  [attr: `aria-${string}`]: string | undefined;
  id?: string;
}) {
  return (
    <Tag data-lit={lit || undefined} {...rest}
      className={`group/plate relative border border-border bg-plate shadow-plate transition-colors duration-300 hover:border-border-strong ${className}`}>
      <span aria-hidden className="plate-brackets brackets" />
      {flash != null && <span key={flash} aria-hidden className="plate-flash" />}
      {children}
    </Tag>
  );
}

/** The site's small heading: mono, uppercase, widely tracked */
export const LABEL = "font-mono text-[11px] tracking-[0.15em] text-muted uppercase";

export function Label({ as: Tag = "span", className = "", children, ...rest }: { as?: ElementType; className?: string; children: ReactNode; id?: string }) {
  return <Tag className={`${LABEL} ${className}`} {...rest}>{children}</Tag>;
}

/** Section opener: the index in corner brackets, a serif title, a scale's ticks running to the row's end */
export function SectionHeading({ id, index, title, action }: { id: string; index: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="section-index brackets inline-grid h-6 min-w-7 place-items-center px-1 font-mono text-xs text-brand">{index}</span>
      <h2 id={id} className="text-[28px] leading-tight sm:text-[30px]">{title}</h2>
      <span aria-hidden className="section-rule min-w-6 flex-1" />
      {action}
    </div>
  );
}

/** A page's opener: a mono kicker, a serif title and a standfirst */
export function PageHeading({ eyebrow, title, children }: { eyebrow: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <Label className="inline-flex items-center gap-2">{eyebrow}</Label>
      <h1 id="title" className="text-[40px] leading-[1.05] text-balance sm:text-[52px]">{title}</h1>
      {children && <p className="max-w-[62ch] text-[17px] text-muted">{children}</p>}
    </div>
  );
}

// --- controls ---------------------------------------------------------------------------

const CONTROL = "inline-flex items-center justify-center gap-2 rounded-[4px] font-medium whitespace-nowrap transition-colors duration-200 disabled:cursor-default disabled:opacity-50";

export const BUTTON = {
  /** the logo's gradient, for the one call to action on a screen */
  primary: `${CONTROL} brand-gradient min-h-11 px-5 text-brand-foreground hover:brightness-110`,
  outline: `${CONTROL} min-h-11 border border-border px-5 hover:border-border-strong hover:bg-accent`,
  small: `${CONTROL} min-h-9 border border-border px-3 text-[13px] hover:border-border-strong hover:bg-accent disabled:hover:bg-transparent`,
};

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden
      className="transition-transform duration-300 group-hover:translate-x-0.5">
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The primary call to action, ending in an arrow that nudges on hover */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className={`group ${BUTTON.primary} no-underline`}>{children}<Arrow /></Link>;
}

export const INPUT = "min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-plate px-3.5 font-mono text-[13px] text-foreground placeholder:text-muted transition-colors duration-200 hover:border-border-strong focus:border-brand focus:outline-none aria-invalid:border-critical";

// --- live marks -------------------------------------------------------------------------

/** A status dot; while live, a ring keeps spreading from it */
export function LiveDot({ live = true, className = "" }: { live?: boolean; className?: string }) {
  return (
    <span aria-hidden className={`relative inline-flex size-[7px] shrink-0 ${className}`}>
      {live && <span className="absolute inset-0 animate-ping-slow rounded-full bg-brand opacity-60" />}
      <span className={`absolute inset-0 rounded-full ${live ? "bg-brand" : "bg-muted"}`} />
    </span>
  );
}

const DIGIT = /\d/;

/**
 * A figure whose digits roll when it changes: the old digit rises out as the new one rises in. Slots are keyed
 * from the right, so a unit after the number stays put and a number gaining a digit only moves the digits that
 * changed. What it shows on first render does not move. (parallax-stats: src/components/rolling.tsx)
 */
export function Rolling({ value }: { value: string }) {
  const chars = [...value];

  return (
    <span>
      <span className="sr-only">{value}</span>
      <span aria-hidden>
        {chars.map((char, i) => {
          const slot = chars.length - i;

          return DIGIT.test(char) ? (
            <span key={slot} className="relative inline-block">
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span key={char} className="inline-block"
                  initial={{ y: "0.5em", opacity: 0, filter: "blur(2px)" }}
                  animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                  exit={{ y: "-0.5em", opacity: 0, filter: "blur(2px)" }}
                  transition={ROLL}>
                  {char}
                </m.span>
              </AnimatePresence>
            </span>
          ) : <span key={slot}>{char}</span>;
        })}
      </span>
    </span>
  );
}

// --- status ----------------------------------------------------------------------------

const statusLabel: Record<BlockStatus, string> = {
  pending: "Maturing",
  confirmed: "Confirmed",
  orphaned: "Orphaned",
};

const statusTone: Record<BlockStatus, string> = {
  pending: "bg-warning-wash text-warning",
  confirmed: "bg-good-wash text-good",
  orphaned: "bg-critical-wash text-critical",
};

/** Block status: a pill with a dot and a label, never colour alone */
export function Status({ status }: { status: BlockStatus }) {
  return (
    <span className={`inline-flex w-max items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-medium ${statusTone[status]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {statusLabel[status]}
    </span>
  );
}

// --- copy ------------------------------------------------------------------------------

function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.svg key={copied ? "done" : "copy"} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={SPRING}>
        {copied
          ? <m.path d="M3.5 8.5l3 3 6-7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
          : <><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>}
      </m.svg>
    </AnimatePresence>
  );
}

/** A value to copy, in mono, with a copy button that turns into a check; `terminal` marks a shell command */
export function CopyField({ value, label, terminal = false }: { value: string; label: string; terminal?: boolean }) {
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
    <div className={`flex min-w-0 items-center gap-2 rounded-[4px] border border-border p-1.5 pl-3.5 ${terminal ? "bg-background" : "bg-plate"}`}>
      {terminal && <span aria-hidden className="self-start py-1 font-mono text-[13px] text-brand select-none">$</span>}
      {/* a command wraps, so all of it shows; a single value scrolls instead */}
      <code aria-label={label} className={`min-w-0 flex-1 font-mono text-[13px] ${terminal ? "py-1 [overflow-wrap:anywhere]" : "overflow-x-auto whitespace-nowrap [scrollbar-width:thin]"}`}>{value}</code>
      <button type="button" onClick={copy} aria-live="polite" className={`${BUTTON.small} min-w-24 ${copied ? "border-brand/50 text-brand" : ""}`}>
        <CopyIcon copied={copied} />
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
  const [position, setPosition] = useState({ left: -9999, top: 0 });

  useLayoutEffect(() => {
    if(!state || !ref.current)
      return;

    const { width, height } = ref.current.getBoundingClientRect();
    const left = state.x + 16 + width > window.innerWidth - 8 ? state.x - 16 - width : state.x + 16;
    const top = Math.min(Math.max(8, state.y - height - 12), window.innerHeight - height - 8);
    setPosition({ left: Math.max(8, left), top });
  }, [state]);

  return (
    <AnimatePresence>
      {state && (
        <m.div ref={ref} role="tooltip" style={position}
          className="pointer-events-none fixed z-30 flex max-w-72 flex-col gap-0.5 rounded-[4px] border border-border-strong bg-popover px-3 py-2 text-[13px] shadow-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.12 } }} exit={{ opacity: 0, transition: FADE_OUT }}>
          {state.content}
        </m.div>
      )}
    </AnimatePresence>
  );
}

// --- toasts ----------------------------------------------------------------------------

export interface ToastMessage {
  /** the mono kicker: "Block found" */
  kicker: string;
  title: string;
  detail?: ReactNode;
}

interface ToastItem extends ToastMessage {
  id: number;
}

const SHOW_MS = 8000;
const SWIPE_PX = 80;
const SWIPE_SPEED = 500;

const ToastContext = createContext<(toast: ToastMessage) => void>(() => {});

/**
 * A toast slides in from the right; one leaving fades in place while the ones below close the gap. Swiped
 * right, it goes. Its countdown bar's end dismisses it, so hovering pauses both; without animations a timer
 * does it instead. (parallax-stats: src/components/block-toast.tsx)
 */
function Toast({ toast, onDismiss, ref }: { toast: ToastItem; onDismiss: (id: number) => void; ref?: Ref<HTMLLIElement> }) {
  const leave = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id]);

  useEffect(() => {
    if(!prefersReducedMotion())
      return;

    const timer = setTimeout(leave, SHOW_MS);
    return () => clearTimeout(timer);
  }, [leave]);

  const onDragEnd = (_: unknown, { offset, velocity }: PanInfo) => {
    if(offset.x >= SWIPE_PX || velocity.x >= SWIPE_SPEED)
      leave();
  };

  return (
    <m.li ref={ref} layout
      className="group pointer-events-auto relative cursor-grab overflow-hidden rounded-lg border border-border-strong bg-popover/90 shadow-overlay backdrop-blur-md active:cursor-grabbing"
      initial={{ opacity: 0, x: 24, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: FADE_OUT }} transition={SPRING}
      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0, right: 0.9 }} onDragEnd={onDragEnd}>
      <span aria-hidden className="brand-gradient-mark absolute inset-x-0 top-0 h-0.5" />
      <div className="flex items-start gap-3 p-4 pb-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-wash text-brand">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" strokeLinejoin="round" />
            <path d="M4 7.5 12 12l8-4.5M12 12v9" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[10px] tracking-[0.15em] text-brand uppercase">{toast.kicker}</span>
          <span className="text-xl leading-tight font-semibold tabular-nums">{toast.title}</span>
          {toast.detail && <span className="text-[13px] text-muted">{toast.detail}</span>}
        </div>
        <button type="button" onClick={leave} aria-label="Dismiss"
          className="-mt-1.5 -mr-1.5 grid size-8 shrink-0 place-items-center rounded-[4px] text-muted transition-colors hover:bg-accent hover:text-foreground">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <span aria-hidden className="countdown block h-0.5 bg-brand/50" style={{ animationDuration: `${SHOW_MS}ms` }} onAnimationEnd={leave} />
    </m.li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((toast: ToastMessage) => {
    const id = nextId.current++;

    // the pool can report one block twice (a reorg); a toast already up for it stays the only one
    setToasts(t => t.some(x => x.kicker === toast.kicker && x.title === toast.title) ? t : [{ ...toast, id }, ...t].slice(0, 3));
  }, []);

  const dismiss = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <ol role="status" aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[min(340px,calc(100vw-32px))] flex-col-reverse gap-2 sm:top-24 sm:bottom-auto sm:flex-col">
        <AnimatePresence initial={false}>
          {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={dismiss} />)}
        </AnimatePresence>
      </ol>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// --- states ----------------------------------------------------------------------------

/** A quiet message in place of content: an empty list, a missing miner */
export function Notice({ title, children, tone, className = "" }: { title?: ReactNode; children?: ReactNode; tone?: "error"; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : undefined}
      className={`flex max-w-3xl flex-col gap-1.5 border bg-plate px-5 py-4 shadow-plate ${tone === "error" ? "border-critical/50 bg-[linear-gradient(to_bottom,var(--critical-wash),transparent_60%)]" : "border-border"} ${className}`}>
      {title && <strong className="font-medium">{title}</strong>}
      {children && <span className="text-muted">{children}</span>}
    </div>
  );
}

export function ErrorNotice({ error, what, className }: { error: Error; what: string; className?: string }) {
  return (
    <Notice tone="error" title={`Couldn't load ${what}.`} className={className}>
      {error.message}. The pool may be restarting; this page retries on its own.
    </Notice>
  );
}

/** A placeholder block with a sheen, sized like what it stands in for */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block rounded-[4px] ${className}`} />;
}
