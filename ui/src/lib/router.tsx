import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A tiny History-API router: the pool serves index.html for every non-API path.

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(to: string) {
  if(to === location.pathname + location.search)
    return;

  history.pushState(null, "", to);
  listeners.forEach(l => l());
  window.scrollTo(0, 0);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);

    // let the browser handle new tabs, downloads and external links
    if(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !href.startsWith("/"))
      return;

    e.preventDefault();
    navigate(href);
  };

  return <a href={href} onClick={handle} {...props} />;
}
