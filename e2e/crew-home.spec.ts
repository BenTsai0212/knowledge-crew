// 首頁的「今天的工作」與「AI 員工」的待驗收件數（#96，RFC 0001 的 2026-11-22 修訂「首頁」）：一般 build（含問答）。
// crew-only 的 build 在 crew-only.spec.ts。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { gotoView, openApp, s, switchIdentity } from "./support/app";
import { access } from "./support/client";
import { crewFill, ct, crewSections, employeeName, hasCrewDemo, homeToday, reviewPanel, workTypeName } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 AI 員工）");

const manager = access.roles.find((r) => r.canReview)!;
const staff = access.roles.find((r) => !r.canReview && r.canUpload);
const guest = access.roles.find((r) => !r.canReview && !r.canUpload);

async function openHomeAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  expect(await gotoView(page, "home")).toBe(true);
  await expect(page.locator(".home")).toBeVisible();
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const group = (page: Page, title: string) => homeToday(page).getByRole("region", { name: title, exact: true });
const reviewButtons = (page: Page) => homeToday(page).getByRole("button", { name: new RegExp(`^${ct.home.actionReview}`) });
// 每列的員工後面是工作類型（#100）：Rowan 的客戶回覆在虛構資料中待驗收；工作類型的列數與待驗收、進行中的列數相同
// （#134 起虛構資料有進行中的工作：待交件與修正中）
async function expectWorkTypes(page: Page, awaiting: number): Promise<void> {
  const inProgress = await group(page, ct.home.groupInProgress).locator(".home__list > li").count();
  const meta = homeToday(page).locator(".crew-home__employee");
  await expect(meta).toHaveCount(awaiting + inProgress);
  await expect(meta.filter({ hasText: employeeName("rowan") }).first()).toContainText(
    crewFill(ct.home.employeeWorkType, { employee: employeeName("rowan"), workType: workTypeName("support") }),
  );
}
const crewBadge = (page: Page) => page.locator(':is(.primary-tabs, .mobile-tabbar, .nav-rail, .more-list) [data-view="crew"] .crew-tab-count');

test.describe("桌機 1280", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("主管：依分組顯示（先處理、待驗收、等你決定），只有第一列是主要按鈕；側欄有待驗收件數；首頁其他區塊仍在", async ({ page }) => {
    await openHomeAs(page, manager.id);
    await expect(homeToday(page)).toBeVisible();
    await expect(group(page, ct.home.groupFailing)).toBeVisible();
    await expect(group(page, ct.home.groupAwaiting)).toBeVisible();
    await expect(group(page, ct.home.groupDecide)).toBeVisible();
    // 進行中：#134 起虛構資料有待交件與修正中的工作
    await expect(group(page, ct.home.groupInProgress)).toBeVisible();
    await expect(homeToday(page).locator(".crew-home__primary")).toHaveCount(1);
    const awaiting = await reviewButtons(page).count();
    expect(awaiting).toBeGreaterThan(0);
    await expect(crewBadge(page).locator('[aria-hidden="true"]')).toHaveText(String(awaiting));
    // 每列有 AI 標記＋員工
    await expect(homeToday(page).locator(".home__row .crew-ai-mark").first()).toBeVisible();
    await expectWorkTypes(page, awaiting);
    // 問候下方的總結；knowledge-kit 首頁的提問框與等你處理不變
    await expect(page.locator(".home__top .crew-home__summary")).toBeVisible();
    await expect(page.locator(".home__waiting")).toBeVisible();
    await expect(page.locator(".home__documents")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("主管：點「開始驗收」到「工作與驗收」該件；點看重點的建議到信任頁；回首頁件數仍在", async ({ page }) => {
    await openHomeAs(page, manager.id);
    const first = reviewButtons(page).first();
    const title = (await first.getAttribute("aria-label"))!.slice(`${ct.home.actionReview}${s.colon}`.length);
    await first.click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(reviewPanel(page, title)).toBeVisible();

    expect(await gotoView(page, "home")).toBe(true);
    await group(page, ct.home.groupDecide).getByRole("button").first().click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionTrust, exact: true })).toHaveAttribute("aria-current", "page");
    // 從導覽切到 AI 員工時是「總覽」（#134；#100 時是「工作與驗收」，子導覽沒有「今天」）
    expect(await gotoView(page, "home")).toBe(true);
    expect(await gotoView(page, "crew")).toBe(true);
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionOverview, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(crewSections(page).getByRole("button")).toHaveCount(6);
  });

  test("一般員工：只有看得到的工作、沒有驗收的按鈕與看重點的建議，側欄沒有待驗收件數", async ({ page }) => {
    test.skip(staff === undefined, "沒有能上傳、不能審查的身分");
    await openHomeAs(page, staff!.id);
    await expect(homeToday(page)).toBeVisible();
    await expect(reviewButtons(page)).toHaveCount(0);
    await expect(homeToday(page).getByRole("button", { name: new RegExp(`^${ct.home.actionView}`) }).first()).toBeVisible();
    await expect(group(page, ct.home.groupDecide)).toHaveCount(0);
    await expect(crewBadge(page)).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("訪客：沒有可做的事，整區與總結都不顯示", async ({ page }) => {
    test.skip(guest === undefined, "沒有不能審查也不能上傳的身分");
    await openHomeAs(page, guest!.id);
    await expect(page.locator(".home__documents")).toBeVisible();
    await expect(homeToday(page)).toHaveCount(0);
    await expect(page.locator(".crew-home__summary")).toHaveCount(0);
    await expect(crewBadge(page)).toHaveCount(0);
  });
});

test.describe("手機 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("主管：整列可以點、不破版；分頁列的 AI 員工有待驗收件數", async ({ page }) => {
    await openHomeAs(page, manager.id);
    await expect(homeToday(page)).toBeVisible();
    const awaiting = await reviewButtons(page).count();
    expect(awaiting).toBeGreaterThan(0);
    await expectWorkTypes(page, awaiting);
    expect(await noHorizontalScroll(page)).toBe(true);
    // #182：AI 員工在底部分頁列的第 4 格，不在「更多」
    await expect(page.locator('.mobile-tabbar [data-view="crew"] .crew-tab-count [aria-hidden="true"]')).toHaveText(String(awaiting));

    await reviewButtons(page).first().click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("一般員工：沒有驗收的按鈕，不破版", async ({ page }) => {
    test.skip(staff === undefined, "沒有能上傳、不能審查的身分");
    await openHomeAs(page, staff!.id);
    await expect(homeToday(page)).toBeVisible();
    await expect(reviewButtons(page)).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});
