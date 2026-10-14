import { congressGovUrl } from "@antibody/core/ids";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { loadBundle } from "../lib/data.ts";
import { type BillModel, modelOf } from "../lib/model.ts";
import { billHref, navigate, sectionHref, useRoute } from "../lib/router.ts";
import { type IndexBill, missingBill, searchBills, searchSections } from "../lib/search.ts";
import { useIndex } from "../lib/useIndex.ts";

interface Item {
  key: string;
  href: string;
  node: ReactNode;
}

/** Bills of the library, and the sections of the open bill, by number or words. `hero` is the big one with the submit button. */
export function SearchBox({
  size = "bar",
  placeholder = "Find another bill or a section…",
  autoFocus,
  renderBill,
  onDone,
}: {
  size?: "bar" | "hero";
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra content on a bill's result row (the land page puts its mini tape here). */
  renderBill?: (bill: IndexBill) => ReactNode;
  onDone?: () => void;
}) {
  const route = useRoute();
  const openId = route.page === "land" || route.page === "missing" ? null : route.id;
  const index = useIndex();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [model, setModel] = useState<{ id: string; m: BillModel } | null>(null);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || !openId || model?.id === openId) return;
    let live = true;
    loadBundle(openId)
      .then((b) => b && live && setModel({ id: openId, m: modelOf(b) }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, openId, model?.id]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (size !== "bar") return;
    const slash = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || t.closest("input,textarea,[contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    addEventListener("keydown", slash);
    return () => removeEventListener("keydown", slash);
  }, [size]);

  const { items, missing } = useMemo(() => {
    const bills = index ? searchBills(index.bills, q) : [];
    const sections = model && model.id === openId ? searchSections(model.m, q) : [];
    const items: Item[] = [
      ...sections.map((v) => ({
        key: `s:${v.s.id}`,
        href: sectionHref(model!.m.b.bill.id, model!.m.sectionSlug(v)),
        node: (
          <>
            <b className="sr-key">{model!.m.secLabel(v)}</b>
            <span className="sr-title">{v.s.heading}</span>
            <span className="sr-meta">SECTION OF {model!.m.b.bill.display}</span>
          </>
        ),
      })),
      ...bills.map((b) => ({
        key: `b:${b.id}`,
        href: billHref(b.id),
        node: (
          <>
            <b className="sr-key">{b.display}</b>
            <span className="sr-title">{b.shortTitle ?? b.title}</span>
            <span className="sr-meta">
              {[b.law, b.sponsorParty && `${b.sponsorParty} SPONSOR`].filter(Boolean).join(" · ")}
            </span>
            {renderBill?.(b)}
          </>
        ),
      })),
    ];
    return { items, missing: index && !items.length && q.trim() ? missingBill(index.bills, q) : null };
  }, [index, model, openId, q, renderBill]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    navigate(item.href);
    setQ("");
    setOpen(false);
    input.current?.blur();
    onDone?.();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length : 0));
    } else if (e.key === "Escape") {
      if (open) e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <search
      ref={root}
      className="search-wrap"
      data-size={size}
      onBlur={(e) => !root.current?.contains(e.relatedTarget) && setOpen(false)}
    >
      <form
        className="search"
        data-size={size}
        onSubmit={(e) => {
          e.preventDefault();
          go(items[active]);
        }}
      >
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          aria-label={placeholder}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {size === "hero" && <button type="submit">X-RAY IT</button>}
      </form>
      {open && (items.length > 0 || missing) && (
        <div className="results" id={listId} role="listbox" aria-label="Results">
          {items.map((it, i) => (
            <div key={it.key} id={`${listId}-${i}`} role="option" tabIndex={-1} aria-selected={i === active}>
              <a
                href={it.href}
                tabIndex={-1}
                data-active={i === active || undefined}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  go(it);
                }}
              >
                {it.node}
              </a>
            </div>
          ))}
          {missing && (
            <p className="missing">
              {missing.display} is not in the library yet.{" "}
              <a href={congressGovUrl(missing.id)} target="_blank" rel="noopener noreferrer">
                Read it on congress.gov ↗
              </a>
            </p>
          )}
        </div>
      )}
    </search>
  );
}
