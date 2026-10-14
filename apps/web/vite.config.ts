import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;

/** Link previews need an absolute image URL; Vercel names this project's production host at build time. */
const absoluteOg = {
  name: "absolute-og-image",
  transformIndexHtml: (html: string) =>
    production ? html.replace(`content="/og.png"`, `content="https://${production}/og.png"`) : html,
};

export default defineConfig({ plugins: [react(), absoluteOg] });
