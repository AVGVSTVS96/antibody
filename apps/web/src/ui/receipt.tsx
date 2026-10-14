import type { Bundle, Claim } from "@antibody/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadClaims } from "../lib/data.ts";
import { sourceName } from "../lib/format.ts";
import { ReceiptDrawer } from "./ReceiptDrawer.tsx";

export interface OpenOptions {
  /** One line naming the mark the reader opened, shown above the claim. */
  label?: string;
  /** Which of `ids` to show first. */
  at?: number;
}

interface Receipt {
  /** The bill's claims; null until its sidecar has loaded. */
  claims: Record<string, Claim> | null;
  /** Opens the drawer on the first id; previous and next walk the rest, in the order given. */
  open: (ids: string | readonly string[], options?: OpenOptions) => void;
  close: () => void;
}

const Ctx = createContext<Receipt>({ claims: null, open() {}, close() {} });
export const useReceipt = () => useContext(Ctx);

interface Walk {
  ids: readonly string[];
  at: number;
}

interface Session {
  /** The last walk is the one on screen; earlier ones are where "back" returns to. */
  walks: Walk[];
  label?: string;
  closing: boolean;
}

const EXIT_MS = 220;

/** Wraps one bill's pages: loads its claims and owns the receipt drawer every source chip and mark opens. */
export function ReceiptProvider({ bundle, children }: { bundle: Bundle; children: ReactNode }) {
  const [claims, setClaims] = useState<Record<string, Claim> | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const opener = useRef<Element | null>(null);
  const isOpen = session !== null;

  useEffect(() => {
    let live = true;
    setClaims(null);
    loadClaims(bundle.bill.id)
      .then((c) => live && setClaims(c))
      .catch(() => live && setClaims({}));
    return () => {
      live = false;
    };
  }, [bundle.bill.id]);

  const open = useCallback<Receipt["open"]>((ids, options = {}) => {
    const list = typeof ids === "string" ? [ids] : ids;
    if (!list.length) return;
    opener.current = document.activeElement;
    const at = Math.min(Math.max(options.at ?? 0, 0), list.length - 1);
    setSession({ walks: [{ ids: list, at }], label: options.label, closing: false });
  }, []);

  const dismiss = useCallback(() => setSession((s) => s && { ...s, closing: true }), []);

  const close = useCallback(() => {
    dismiss();
    if (history.state?.receipt) history.back();
  }, [dismiss]);

  const closing = session?.closing;
  useEffect(() => {
    if (!isOpen) return;
    history.pushState({ ...history.state, receipt: true }, "");
    addEventListener("popstate", dismiss);
    return () => removeEventListener("popstate", dismiss);
  }, [isOpen, dismiss]);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setSession(null), EXIT_MS);
    return () => clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!isOpen) return;
    const root = document.getElementById("root");
    root?.toggleAttribute("inert", true);
    return () => {
      root?.removeAttribute("inert");
      if (opener.current instanceof HTMLElement && opener.current.isConnected)
        opener.current.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const api = useMemo<Receipt>(() => ({ claims, open, close }), [claims, open, close]);
  const walk = session?.walks.at(-1);

  const step = (delta: number) =>
    setSession((s) => {
      if (!s) return s;
      const top = s.walks.at(-1)!;
      const at = Math.min(Math.max(top.at + delta, 0), top.ids.length - 1);
      return { ...s, walks: [...s.walks.slice(0, -1), { ...top, at }] };
    });

  const openRest = (i: number) =>
    setSession((s) => {
      if (!s) return s;
      const top = s.walks.at(-1)!;
      const rests = claims?.[top.ids[top.at]!]?.restsOn;
      return rests?.length ? { ...s, walks: [...s.walks, { ids: rests, at: i }] } : s;
    });

  return (
    <Ctx.Provider value={api}>
      {children}
      {session &&
        walk &&
        createPortal(
          <ReceiptDrawer
            claims={claims}
            rules={bundle.rules}
            walk={walk}
            label={session.walks.length === 1 ? session.label : undefined}
            nested={session.walks.length > 1}
            closing={session.closing}
            onClose={close}
            onBack={() => setSession((s) => s && { ...s, walks: s.walks.slice(0, -1) })}
            onStep={step}
            onRest={openRest}
          />,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/**
 * A source chip: the record behind one claim, or behind a mark made of several. Click opens the receipt;
 * the link itself still points at the record, so middle-click and copy-link work.
 */
export function Src({
  ids,
  label,
  context,
  at,
}: {
  ids: string | readonly string[];
  label?: ReactNode;
  context?: string;
  at?: number;
}) {
  const { claims, open } = useReceipt();
  const list = typeof ids === "string" ? [ids] : ids;
  if (!claims)
    return (
      <span className="src ghost" aria-hidden="true">
        {label ?? "source"}
      </span>
    );
  const found = list.map((id) => claims[id]).filter((c): c is Claim => !!c);
  const first = found[0];
  if (!first) return <span className="src gone">no record</span>;
  const inference = found.some((c) => c.kind === "inference");
  return (
    <a
      className={`src${inference ? " inference" : ""}`}
      href={first.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-haspopup="dialog"
      aria-label={label ? undefined : `${sourceName(first.sourceUrl)}: ${first.text}`}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(list, { label: context, at });
      }}
    >
      {label ?? sourceName(first.sourceUrl)}
      {list.length > 1 && <span className="src-n">×{list.length}</span>}
    </a>
  );
}
