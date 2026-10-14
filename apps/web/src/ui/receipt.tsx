import type { Bundle, Claim } from "@antibody/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadClaims } from "../lib/data.ts";
import { sourceName } from "../lib/format.ts";
import { claimTable } from "../lib/receipt-copy.ts";
import { receiptInUrl, withReceipt } from "../lib/receipt-url.ts";
import { ReceiptDrawer } from "./ReceiptDrawer.tsx";

export interface OpenOptions {
  /** One line naming the mark the reader opened, shown above the claim. */
  label?: string;
  /** Which of `ids` to show first. */
  at?: number;
}

/** A claim; null when the bundle has none by that id; absent while the shard that would hold it is on its way. */
type Known = Record<string, Claim | null>;

interface Receipt {
  claim: (id: string) => Claim | null | undefined;
  /** Whether a mark is dashed: known from the claim once it is here, from its table's kind before. */
  inference: (id: string) => boolean;
  /** Starts fetching the shards that hold these claims (a no-op for the ones already here). */
  request: (ids: readonly string[]) => void;
  /** Opens the drawer on the first id; previous and next walk the rest, in the order given. */
  open: (ids: string | readonly string[], options?: OpenOptions) => void;
  close: () => void;
}

const Ctx = createContext<Receipt>({ claim: () => null, inference: () => false, request() {}, open() {}, close() {} });
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

const fromUrl = (): Session | null => {
  const id = receiptInUrl();
  return id ? { walks: [{ ids: [id], at: 0 }], closing: false } : null;
};

/** Wraps one bill's pages: loads claims as chips and receipts ask for them, and owns the drawer every chip and mark opens. */
export function ReceiptProvider({ bundle, children }: { bundle: Bundle; children: ReactNode }) {
  const [claims, setClaims] = useState<Known>(bundle.claims);
  const current = useRef({ bundle, claims });
  current.current = { bundle, claims };
  const [session, setSession] = useState<Session | null>(fromUrl);
  const opener = useRef<Element | null>(null);
  const isOpen = session !== null;

  useEffect(() => setClaims(bundle.claims), [bundle.claims]);

  const request = useCallback<Receipt["request"]>(
    (ids) => {
      const want = ids.filter((id) => !current.current.claims[id]);
      if (!want.length) return;
      const settle = (found: Record<string, Claim>) => {
        if (current.current.bundle !== bundle) return;
        const missing = want.filter((id) => !found[id]);
        setClaims((prev) => ({ ...prev, ...found, ...Object.fromEntries(missing.map((id) => [id, null])) }));
      };
      loadClaims(bundle, want).then(settle, () => settle({}));
    },
    [bundle],
  );

  const claim = useCallback<Receipt["claim"]>(
    (id) => claims[id] ?? (id in claims || !bundle.claimShards ? null : undefined),
    [claims, bundle.claimShards],
  );

  const inference = useCallback<Receipt["inference"]>(
    (id) => {
      const known = claim(id);
      return known ? known.kind === "inference" : bundle.claimShards?.kinds[claimTable(id)] === "inference";
    },
    [claim, bundle.claimShards],
  );

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
    else history.replaceState(history.state, "", withReceipt(location.href, null));
  }, [dismiss]);

  useEffect(() => {
    const follow = () => setSession((s) => (receiptInUrl() ? (s ?? fromUrl()) : s && { ...s, closing: true }));
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, []);

  const closing = session?.closing;
  useEffect(() => {
    if (isOpen && !receiptInUrl()) history.pushState({ ...history.state, receipt: true }, "");
  }, [isOpen]);

  const walk = session?.walks.at(-1);
  const shownId = walk?.ids[walk.at];
  useEffect(() => {
    if (shownId && !closing) history.replaceState(history.state, "", withReceipt(location.href, shownId));
  }, [shownId, closing]);

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

  const api = useMemo<Receipt>(
    () => ({ claim, inference, request, open, close }),
    [claim, inference, request, open, close],
  );

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
      const rests = claim(top.ids[top.at]!)?.restsOn;
      return rests?.length ? { ...s, walks: [...s.walks, { ids: rests, at: i }] } : s;
    });

  return (
    <Ctx.Provider value={api}>
      {children}
      {session &&
        walk &&
        createPortal(
          <ReceiptDrawer
            lookup={claim}
            request={request}
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

const PREFETCH = 8;

/**
 * A source chip: the record behind one claim, or behind a mark made of several. It is drawn and clickable at once;
 * hovering, focusing or touching it fetches its claim, and its link to the record appears when that arrives.
 * Click opens the receipt; once the link is there, middle-click and copy-link work.
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
  const { claim, inference, request, open } = useReceipt();
  const list = typeof ids === "string" ? [ids] : ids;
  const found = list.map(claim);
  if (found.every((c) => c === null)) return <span className="src gone">no record</span>;
  const first = found.find((c) => !!c);
  const show = () => open(list, { label: context, at });
  const prefetch = () => request(list.slice(0, PREFETCH));
  return (
    <a
      className={`src${list.some(inference) ? " inference" : ""}`}
      href={first?.sourceUrl}
      role={first ? undefined : "button"}
      tabIndex={first ? undefined : 0}
      target="_blank"
      rel="noopener noreferrer"
      aria-haspopup="dialog"
      aria-label={label || !first ? undefined : `${sourceName(first.sourceUrl)}: ${first.text}`}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onKeyDown={(e) => {
        if (!first && e.key === "Enter") show();
      }}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        show();
      }}
    >
      {label ?? (first ? sourceName(first.sourceUrl) : "source")}
      {list.length > 1 && <span className="src-n">×{list.length}</span>}
    </a>
  );
}
