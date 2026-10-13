import { chromium } from 'playwright-core'
import { homedir } from 'os'

const url = process.argv[2] ?? 'http://100.113.223.113:4800/antibody'
const out = process.argv[3] ?? 'shots'
const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome` })

const shots = [
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop-dark-full', width: 1440, height: 900, theme: 'dark', full: true },
  { name: 'phone-dark', width: 390, height: 844, theme: 'dark', mobile: true },
  { name: 'phone-light', width: 390, height: 844, theme: 'light', mobile: true },
  { name: 'desktop-dark-hover', width: 1440, height: 900, theme: 'dark', focus: 'company:1403161' },
  { name: 'desktop-dark-xray', width: 1440, height: 900, theme: 'dark', view: 'list' },
  { name: 'phone-dark-xray', width: 390, height: 844, theme: 'dark', mobile: true, view: 'list' },
]

for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile, colorScheme: s.theme as 'dark' | 'light' })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${url}?theme=${s.theme}${s.view ? `&view=${s.view}` : ''}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#map svg', { state: 'attached' })
  await page.evaluate(() => document.fonts.ready)
  if (s.focus) await page.evaluate(id => (window as any).__show(id), s.focus)
  const full = (s as any).full || s.mobile
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: !!full })
  console.log(s.name, { overflow, errors, title: await page.title() })
  await page.close()
}
await browser.close()
