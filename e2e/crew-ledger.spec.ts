// 工作帳本（#77，設計規格 v3 第 6.7 節）：表格欄位、事件與員工篩選、層級改變的灰底列、退回（做錯了）的粗體、
// 「載入更早的紀錄」，以及手機 390 時表格在框內橫向捲動、頁面不水平捲動。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { crewContent, crewFill, ct, employeeName, gotoCrewSection, hasCrewDemo, openCrew } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

// 與 app/src/crew/ui/ledger.ts 的 LEDGER_PAGE_SIZE 相同
const PAGE_SIZE = 20;

const table = (page: Page) => page.getByRole("table", { name: ct.ledger.listLabel });
const rows = (page: Page) => table(page).locator("tbody").getByRole("row");
const filter = (page: Page, label: string) => crewContent(page).getByRole("combobox", { name: new RegExp(`^${label}`) });
const loadMore = (page: Page) => crewContent(page).getByRole("button", { name: ct.ledger.loadMore, exact: true });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function openLedger(page: Page): Promise<void> {
  await openApp(page);
  await switchIdentity(page, "manager");
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionRecords);
  await expect(rows(page).first()).toBeVisible();
}

test.describe("桌機 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ page }) => openLedger(page));

  test("標題、欄位與「載入更早的紀錄」", async ({ page }) => {
    // 子頁的主標題是頁首的 h1（#179；#191 起是「紀錄」），子頁內不再重複同名的 h2
    await expect(page.getByRole("heading", { name: ct.common.sectionRecords, level: 1 })).toBeVisible();
    await expect(crewContent(page).getByRole("heading", { name: ct.common.sectionRecords })).toHaveCount(0);
    await expect(crewContent(page).getByText(ct.ledger.lead, { exact: true })).toBeVisible();
    const headers = [ct.ledger.columnDate, ct.ledger.columnEvent, ct.ledger.columnWork, ct.ledger.columnEmployee, ct.ledger.columnActor];
    await expect(table(page).getByRole("columnheader")).toHaveText(headers);
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    await loadMore(page).click();
    await expect(rows(page)).toHaveCount(PAGE_SIZE * 2);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("只看層級改變：灰底粗體列；只看退回：做錯了是粗體；員工篩選", async ({ page }) => {
    await filter(page, ct.ledger.filterEvent).selectOption({ label: ct.ledger.eventLevel });
    await expect(rows(page)).not.toHaveCount(0);
    const n = await rows(page).count();
    // 提出看重點的建議也在這個篩選（#125），它不改變層級，不是灰底；經手是「依規則自動」
    for (let i = 0; i < n; i++) {
      const row = rows(page).nth(i);
      if ((await row.getAttribute("data-kind")) === "proposed") await expect(row).not.toHaveAttribute("data-tone", /./);
      else await expect(row).toHaveAttribute("data-tone", "level");
    }
    const proposed = rows(page).filter({ hasText: ct.ledger.kindProposed });
    await expect(proposed).not.toHaveCount(0);
    await expect(proposed.first().locator("td").last()).toHaveText(ct.ledger.actorRule);
    await expect(rows(page).filter({ hasText: ct.ledger.kindRevoke })).not.toHaveCount(0);
    await expect(rows(page).filter({ hasText: ct.ledger.kindAutoReset })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: ct.ledger.kindRelax })).not.toHaveCount(0);
    await expect(rows(page).first().locator(".crew-ledger__kind")).toHaveCSS("font-weight", "700");
    // 層級改變不屬於某一件工作，「工作」欄是 —
    await expect(rows(page).filter({ hasText: ct.ledger.kindRelax }).first().getByText(ct.ledger.noAssignment, { exact: true })).toBeVisible();

    await filter(page, ct.ledger.filterEvent).selectOption({ label: ct.ledger.eventReturned });
    const wrong = rows(page).filter({ hasText: crewFill(ct.ledger.kindReturned, { reason: ct.ledger.reasonWrong }) });
    await expect(wrong.first()).toHaveAttribute("data-tone", "wrong");
    await expect(wrong.first().locator(".crew-ledger__kind")).toHaveCSS("font-weight", "700");
    const other = rows(page).filter({ hasText: crewFill(ct.ledger.kindReturned, { reason: ct.ledger.reasonDifferentApproach }) });
    if ((await other.count()) > 0) await expect(other.first()).not.toHaveAttribute("data-tone", /./);

    await filter(page, ct.ledger.filterEvent).selectOption({ label: ct.ledger.filterAll });
    await filter(page, ct.ledger.filterEmployee).selectOption({ label: crewFill(ct.common.aiOption, { name: employeeName("rowan") }) });
    const m = await rows(page).count();
    expect(m).toBeGreaterThan(0);
    for (let i = 0; i < m; i++) await expect(rows(page).nth(i).locator("td").nth(3)).toContainText(employeeName("rowan"));
  });
});

test.describe("手機 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("表格在框內橫向捲動，頁面不水平捲動", async ({ page }) => {
    await openLedger(page);
    const scroll = crewContent(page).getByRole("region", { name: ct.ledger.scrollLabel });
    await expect(scroll).toBeVisible();
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    await expect(loadMore(page)).toBeVisible();
  });
});
