import { chromium } from "playwright";
const exe = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`;
const b = await chromium.launch({ executablePath: exe }); const p = await b.newPage();
await p.goto("https://api.data.gov/signup/", { waitUntil: "networkidle" }); await p.waitForTimeout(3000);
console.log(await p.evaluate(() => [...document.querySelectorAll("input,button,select,iframe")].map(e => `${e.tagName} id=${e.id} name=${(e as any).name} type=${(e as any).type} src=${(e as any).src ?? ""}`).join("\n")));
await b.close();
