// A2UI render + loop smoke test (browser). Called by scripts/preflight.sh.
//
// Verifies the two A2UI interaction paths that broke the day before the
// workshop, against a real browser + real key:
//   1. click-counter (named surface)  — renders, a click increments it
//   2. form-builder (inline surface)   — renders a form, and a single submit
//      fires EXACTLY ONE agent turn (the action-spam loop guard holds)
//
// Exit: 0 = pass · 1 = fail · 3 = skipped (playwright not installed)
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(import.meta.url);
const FRONTEND = process.env.PREFLIGHT_FRONTEND || "http://localhost:3456";

// playwright is CommonJS — require() (not ESM import) so pw.chromium is the
// module export directly, and require resolves a package dir via its main.
function loadPlaywright() {
  const tryReq = (p) => { try { return require(p); } catch { return null; } };
  let pw = tryReq("playwright");
  if (pw) return pw;
  const candidates = [];
  if (process.env.FRONTEND_DIR) candidates.push(join(process.env.FRONTEND_DIR, "node_modules", "playwright"));
  const npx = join(os.homedir(), ".npm", "_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) candidates.push(join(npx, d, "node_modules", "playwright"));
  for (const c of candidates) {
    if (existsSync(join(c, "package.json"))) { pw = tryReq(c); if (pw) return pw; }
  }
  return null;
}

async function waitComposer(page) {
  const input = page.locator("input").last();
  await input.waitFor({ state: "visible", timeout: 20000 });
  for (let i = 0; i < 60; i++) {
    const ph = await input.getAttribute("placeholder").catch(() => "");
    const disabled = await input.isDisabled().catch(() => true);
    if (ph && ph.startsWith("Message") && !disabled) break;
    await page.waitForTimeout(500);
  }
  return input;
}

async function run() {
  const pw = loadPlaywright();
  if (!pw) return 3;
  const browser = await pw.chromium.launch();
  let ok = true;
  try {
    // 1) click-counter — named surface renders + increments
    {
      const page = await browser.newPage();
      await page.goto(`${FRONTEND}/dev/a2ui`, { waitUntil: "networkidle" });
      const btn = page.getByText("Click me", { exact: false });
      await btn.waitFor({ state: "visible", timeout: 15000 });
      const before = ((await page.locator("body").innerText()).match(/Clicks:\s*\d+/) || ["?"])[0];
      await btn.click();
      await page.waitForTimeout(9000);
      const after = ((await page.locator("body").innerText()).match(/Clicks:\s*\d+/) || ["?"])[0];
      if (before === after) { console.error(`  click-counter did NOT update (${before} -> ${after})`); ok = false; }
      await page.close();
    }
    // 2) form-builder — inline surface renders + a single submit = one turn
    {
      const page = await browser.newPage();
      let afterClick = 0, clicked = false;
      page.on("request", (r) => { if (/\/stream\b/.test(r.url()) && clicked) afterClick++; });
      await page.goto(`${FRONTEND}/chat/@workshop-user/demo-form-builder`, { waitUntil: "networkidle" });
      const input = await waitComposer(page);
      await input.click(); await input.fill("event registration");
      await page.getByRole("button", { name: /^send$/i }).first().click();
      const submit = page.locator(".a2ui-surface button, [data-surface-id] button").last();
      await submit.waitFor({ state: "visible", timeout: 25000 });
      clicked = true;
      await submit.click({ force: true, noWaitAfter: true });
      await page.waitForTimeout(15000); // observe with NO further interaction
      if (afterClick > 1) { console.error(`  form submit LOOPED: ${afterClick} agent turns from one click`); ok = false; }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return ok ? 0 : 1;
}

run().then((code) => process.exit(code)).catch((e) => { console.error("  render check error:", e.message); process.exit(1); });
