import "@fontsource-variable/public-sans";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initTheme } from "./lib/theme.ts";

initTheme();

const root = document.querySelector("#root");

if (!root) {
  throw new Error("index.html has no #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
