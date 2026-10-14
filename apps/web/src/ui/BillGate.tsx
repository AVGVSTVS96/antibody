import { createContext, type ReactNode, use, useContext, useEffect } from "react";
import { loadBundle } from "../lib/data.ts";
import { type BillModel, modelOf } from "../lib/model.ts";
import { NotFound } from "./NotFound.tsx";
import { ReceiptProvider } from "./receipt.tsx";

const Model = createContext<BillModel | null>(null);

/** The open bill's model. Only valid under a bill route: the shell loads it before any page renders. */
export function useModel(): BillModel {
  const m = useContext(Model);
  if (!m) throw new Error("useModel outside a bill page");
  return m;
}

/** Loads one bill (the shell shows the skeleton meanwhile), or the not-found page when the library has no such bill. */
export function BillGate({ id, children }: { id: string; children: ReactNode }) {
  const bundle = use(loadBundle(id));
  const bill = bundle?.bill;
  useEffect(() => {
    if (bill) document.title = `${bill.shortTitle ?? bill.title} (${bill.display}) · antibody`;
  }, [bill]);
  if (!bundle) return <NotFound id={id} />;
  return (
    <Model value={modelOf(bundle)}>
      <ReceiptProvider bundle={bundle}>{children}</ReceiptProvider>
    </Model>
  );
}
