/**
 * Takes screenshots of the running dashboard (default http://127.0.0.1:5173) into docs/screenshots/
 * and runs a few UI smoke interactions. Needs a local Chrome or Edge (uses playwright-core, no browser download).
 *   node scripts/screenshots.mjs [url]
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5173";
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");
mkdirSync(out, { recursive: true });

const candidates = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found; set BROWSER_PATH");

const browser = await chromium.launch({ executablePath, headless: true });
const problems = [];
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`);
  if (!ok) problems.push(name);
};

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  // Icons come from an external CDN; a blocked/failed image is expected offline and handled by the fallback.
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(url);
await page.waitForSelector(".bot-card", { timeout: 15000 });
await page.waitForTimeout(1500);
check("bot cards rendered", (await page.locator(".bot-card").count()) === 4, `${await page.locator(".bot-card").count()} cards`);
check("self card rendered", (await page.locator(".self-card").count()) === 1);
await page.screenshot({ path: path.join(out, "overview.png") });

// Command from the card -> toast with result
await page.locator(".bot-card").first().getByRole("button", { name: "Folgen", exact: true }).click();
await page.waitForSelector(".toast", { timeout: 5000 });
check("result toast appears after a command", (await page.locator(".toast").count()) >= 1, (await page.locator(".toast").first().innerText()).replace(/\s+/g, " "));

// Detail drawer
await page.locator(".bot-card .name-btn").first().click();
await page.waitForSelector("dialog.drawer[open]");
await page.waitForTimeout(500);
check("drawer opens", await page.locator("dialog.drawer[open]").isVisible());
await page.screenshot({ path: path.join(out, "detail-equipment.png") });

await page.getByRole("tab", { name: "Taschen" }).click();
await page.waitForTimeout(300);
await page.locator(".tile-btn").first().click();
await page.screenshot({ path: path.join(out, "detail-bags.png") });
const boundCheckbox = page.locator(".tile .pick:disabled").first();
check("soulbound items have disabled trade checkbox", (await boundCheckbox.count()) > 0);

await page.getByRole("tab", { name: /Quests vs\. Du/ }).click();
await page.waitForTimeout(300);
check("compare tab shows groups", (await page.locator(".cmp-group").count()) >= 3);
await page.screenshot({ path: path.join(out, "detail-quests-vs-du.png") });

await page.getByRole("tab", { name: "Werte" }).click();
await page.screenshot({ path: path.join(out, "detail-stats.png") });

// Esc closes the drawer
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Esc closes drawer", (await page.locator("dialog.drawer[open]").count()) === 0);

// Destroy confirmation (Escape on the confirm dialog must not close a parent)
await page.locator(".bot-card .name-btn").first().click();
await page.getByRole("tab", { name: "Taschen" }).click();
await page.locator(".tile-btn").first().click();
await page.getByRole("button", { name: "Wegwerfen" }).click();
await page.waitForSelector("dialog.confirm[open]");
await page.screenshot({ path: path.join(out, "confirm-destroy.png") });
check("confirm dialog names the item", /wird unwiderruflich vernichtet/.test(await page.locator("dialog.confirm[open]").innerText()));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Esc closes only the confirm dialog", (await page.locator("dialog.confirm[open]").count()) === 0 && (await page.locator("dialog.drawer[open]").count()) === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// Multi-select trade
await page.locator(".bot-card .name-btn").first().click();
await page.getByRole("tab", { name: "Taschen" }).click();
await page.getByRole("button", { name: "Liste" }).click();
const pickable = page.locator(".row-item .pick:not(:disabled)");
const nPick = await pickable.count();
check("list view has tradeable checkboxes", nPick >= 2, nPick + " tradeable");
await pickable.nth(0).check();
await pickable.nth(1).check();
check("trade bar shows selection", /2 Items ausgewählt/.test(await page.locator(".trade-bar").innerText()));
await page.locator(".trade-bar").getByRole("button", { name: "Zu mir handeln" }).click();
await page.waitForSelector(".toast:has-text('Handeln')", { timeout: 5000 });
check("trade command produces a result toast", true);
await page.screenshot({ path: path.join(out, "detail-bags-list-trade.png") });

// Abandon with confirmation
await page.getByRole("tab", { name: "Quests", exact: true }).click();
const questsBefore = await page.locator(".quest-list .quest").count();
await page.locator(".quest").first().getByRole("button", { name: "Abbrechen" }).click();
await page.waitForSelector("dialog.confirm[open]");
await page.locator("dialog.confirm[open]").getByRole("button", { name: "Quest abbrechen" }).click();
await page.waitForTimeout(3500);
const questsAfter = await page.locator(".quest-list .quest").count();
console.log("INFO quests before/after abandon: " + questsBefore + " -> " + questsAfter + " (10 % of commands fail by design)");

// Strategy chips
await page.getByRole("tab", { name: "Steuerung" }).click();
const chip = page.getByRole("button", { name: /passive/ }).first();
await chip.click();
await page.waitForSelector(".toast:has-text('Strategie')", { timeout: 5000 });
check("strategy chip sends a command", true);
await page.screenshot({ path: path.join(out, "detail-control.png") });
await page.keyboard.press("Escape");

// Free command box: validation + send
await page.getByPlaceholder("z. B. co +dps").fill(".server shutdown");
await page.getByRole("button", { name: "Senden" }).click();
check("dot-prefixed command is rejected client-side", /Punkt/.test(await page.locator("#cmd-help").innerText()));
await page.getByPlaceholder("z. B. co +dps").fill("co +dps");
await page.getByRole("button", { name: "Senden" }).click();
await page.waitForTimeout(800);
check("chat command clears the input", (await page.getByPlaceholder("z. B. co +dps").inputValue()) === "");

// All-bots toolbar -> one result per bot
const before = await page.locator(".log-item").count();
await page.getByRole("button", { name: "Alle reparieren" }).click();
await page.waitForTimeout(1500);
const after = await page.locator(".log-item").count();
check("bot '*' yields one result per bot", after - before >= 4, (after - before) + " new log lines");

// Quest offer (mock creates the first offer after ~15 s)
await page.waitForSelector(".offers", { timeout: 90000 });
await page.screenshot({ path: path.join(out, "quest-offer.png") });
await page.locator(".offers").getByRole("button", { name: "Annehmen" }).first().click();
await page.waitForSelector(".toast:has-text('Angebot')", { timeout: 5000 });
check("quest offer accept produces a result", true);

// Filter + self drawer
await page.getByLabel("Nur Bots mit Quest-Abweichungen").check();
check("deviation filter keeps bots with diffs", (await page.locator(".bot-card").count()) >= 1);
await page.getByLabel("Nur Bots mit Quest-Abweichungen").uncheck();
await page.locator(".self-card .name-btn").click();
await page.waitForSelector("dialog.drawer[open]");
check("self drawer has no compare/control tab", (await page.getByRole("tab").count()) === 4);
await page.screenshot({ path: path.join(out, "detail-self.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, "overview-final.png"), fullPage: true });

// Mobile
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mobile.newPage();
await mp.goto(url);
await mp.waitForSelector(".bot-card", { timeout: 15000 });
await mp.waitForTimeout(1200);
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal page scroll on mobile", overflow <= 1, `overflow ${overflow}px`);
await mp.screenshot({ path: path.join(out, "overview-mobile.png") });

check("no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
process.exit(problems.length ? 1 : 0);
