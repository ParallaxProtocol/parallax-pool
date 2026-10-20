/** A status mark beside a value, in the status colour; the text beside it carries the meaning */
export function Indicator({ tone, className = "" }: { tone: "good" | "warning" | "critical"; className?: string }) {
  const colour = { good: "bg-good", warning: "bg-warning", critical: "bg-critical" }[tone];
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${colour} ${className}`} />;
}
