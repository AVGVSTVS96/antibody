import { BundleIndex } from "@antibody/core";
import { useEffect, useState } from "react";

export function App() {
  const [index, setIndex] = useState<BundleIndex | null>(null);

  useEffect(() => {
    fetch("/bundles/index.json")
      .then((r) => r.json())
      .then((j) => setIndex(BundleIndex.parse(j)));
  }, []);

  return (
    <main>
      <h1>antibody</h1>
      {index?.bills.length === 0 && <p>No bills x-rayed yet.</p>}
      <ul>
        {index?.bills.map((b) => (
          <li key={b.id}>
            {b.display} {b.shortTitle ?? b.title}
          </li>
        ))}
      </ul>
    </main>
  );
}
