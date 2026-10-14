import { type Stage, TABLES } from "@antibody/core";

export interface Registered extends Stage {
  package: string;
}

/** Flattens the registry and checks the contract: unique names, known needs, writes only to tables the package owns. */
export function register(packages: Record<string, Stage[]>): Map<string, Registered> {
  const all = new Map<string, Registered>();
  for (const [pkg, stages] of Object.entries(packages))
    for (const s of stages) {
      if (all.has(s.name)) throw new Error(`stage "${s.name}" is defined twice`);
      for (const t of s.writes)
        if (TABLES[t].owner !== pkg)
          throw new Error(`${pkg} stage "${s.name}" writes ${t}, owned by ${TABLES[t].owner}`);
      all.set(s.name, { ...s, package: pkg });
    }
  for (const s of all.values())
    for (const n of s.needs) if (!all.has(n)) throw new Error(`stage "${s.name}" needs unknown stage "${n}"`);
  return all;
}

/** The given stages plus everything they need, dependencies first. */
export function order(all: Map<string, Registered>, targets: string[]): Registered[] {
  const out: Registered[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, from: string[]) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") throw new Error(`stage cycle: ${[...from, name].join(" → ")}`);
    const s = all.get(name);
    if (!s) throw new Error(`no stage "${name}"`);
    state.set(name, "visiting");
    for (const n of s.needs) visit(n, [...from, name]);
    state.set(name, "done");
    out.push(s);
  };
  for (const t of targets) visit(t, []);
  return out;
}
