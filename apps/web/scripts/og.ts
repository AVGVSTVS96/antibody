/**
 * Renders public/og.png (1200x630) in the site's own style: the logo, the landing headline and the featured bill's tape,
 * drawn from index.json by the same layout the site uses. X lays the title over the bottom fifth, so only the late
 * ticks sit there.
 * `bun apps/web/scripts/og.ts`
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BundleIndex } from "@antibody/core";
import { chromium } from "playwright-core";
import { tapeOfFeatured } from "../src/land/featured.ts";
import { geometry, layout } from "../src/lib/tape.ts";

const web = join(import.meta.dir, "..");
const index = (await Bun.file(join(web, "public/bundles/index.json")).json()) as BundleIndex;
const featured = index.featured!;
const bill = index.bills.find((b) => b.id === featured.billId)!;
const tape = tapeOfFeatured(featured);

const WIDTH = 1088;
const g = geometry(false, tape.flat);
const marks = layout(tape, WIDTH, g);
const FILL = { headline: "#0b0b0b", quiet: "#ffe81f", other: "#c9c9c9" } as const;
const bars = tape.rows
  .map((r, i) => {
    const m = marks[i]!;
    const body = m.stub ? "" : `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" fill="${FILL[r.kind]}"/>`;
    const late = r.late ? `<rect x="${m.x}" y="${g.lateY}" width="${m.w}" height="${g.lateH}" fill="#0b0b0b"/>` : "";
    return body + late;
  })
  .join("");
const quiet = tape.rows.filter((r) => r.kind === "quiet").length;

const font = (family: string, pkg: string, file: string) => {
  const data = readFileSync(join(web, "node_modules/@fontsource-variable", pkg, "files", file)).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:100 900;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
};

const html = `<!doctype html><meta charset="utf-8"><style>
${font("Inter Tight", "inter-tight", "inter-tight-latin-wght-normal.woff2")}
${font("JetBrains Mono", "jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2")}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;padding:48px 56px;background:#fff;color:#0b0b0b;font-family:"Inter Tight";overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:center}
.logo{font:800 34px/40px "Inter Tight";letter-spacing:-.04em}
.logo span{padding-right:5px;background:#ffe81f}
.tag,.cap{font:500 14px/18px "JetBrains Mono";letter-spacing:.12em;text-transform:uppercase;color:#5e5e5e}
h1{margin-top:22px;font:800 108px/1.06 "Inter Tight";letter-spacing:-.045em}
h1 span{padding-inline:.14em;background:#ffe81f}
.cap{margin-top:26px}
svg{display:block;margin-top:14px}
</style>
<div class="top"><div class="logo">anti<span>body</span></div><div class="tag">X-ray any bill in Congress</div></div>
<h1>Read the part<br>the news <span>skipped.</span></h1>
<p class="cap">The tape · ${bill.display} · ${tape.rows.length.toLocaleString("en-US")} sections · ${quiet} yellow: big stakes, little coverage</p>
<svg width="${WIDTH}" height="${g.height}">${bars}<path d="M0 ${g.mid}.5H${WIDTH}" stroke="#0b0b0b" fill="none"/></svg>`;

const browser = await chromium.launch({
  executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(web, "public/og.png") });
await browser.close();
