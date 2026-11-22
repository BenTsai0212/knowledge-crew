// 「信任」時間軸（#75，設計規格 v3 第 6.4 節）：四位員工 demo 開始時的狀態、staff 看到的文字，與手機 390 不破版。
// 每個 test 重新開頁，資料庫在瀏覽器記憶體中從 migration 與虛構資料重建。只在有 crew/demo.json 的客戶執行。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { crewFill, ct, gotoCrewSection, hasCrewDemo, openCrew, trustRow } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

async function openTrustAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionTrust);
}

// 圓點的清單（aria-label 是摘要，例如「通過 9、做錯了 1」）
const dots = (row: Locator) => row.getByRole("list").filter({ has: row.page().locator(".crew-trust__dot") });
const badge = (level: string) => crewFill(ct.trust.levelBadge, { level });
const summary = (parts: [string, number][]) => parts.map(([key, count]) => crewFill(key, { count })).join(ct.trust.dotsAriaSeparator);

test.describe("信任：四種狀態（主管，桌機 1280）", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.beforeEach(async ({ page }) => openTrustAs(page, "manager"));

  test("頁首、圖例與規則說明", async ({ page }) => {
    await expect(page.getByRole("heading", { name: ct.trust.title, exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: ct.trust.legendLabel })).toContainText(ct.trust.legendWrong);
    await expect(page.getByText(ct.trust.rules, { exact: true })).toBeVisible();
  });

  test("Rowan：做錯了依規則自動改回，說明要重新累積，沒有按鈕", async ({ page }) => {
    const row = trustRow(page, "rowan", "support");
    await expect(row.getByText(badge(ct.trust.levelItem), { exact: true })).toBeVisible();
    await expect(dots(row)).toHaveAttribute("aria-label", summary([[ct.trust.dotsAriaOk, 9], [ct.trust.dotsAriaWrong, 1]]));
    await expect(row.getByText(crewFill(ct.trust.eventReset, { date: "10/15" }), { exact: false })).toBeVisible();
    await expect(row.getByText(ct.trust.noteReset, { exact: true })).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("Sorrel：同意少看 → 事件「今天」與「收回少看」→ 收回後說明下一份起改回逐項看", async ({ page }) => {
    const row = trustRow(page, "sorrel", "content");
    await row.getByRole("button", { name: ct.trust.agreeRelax, exact: true }).click();
    await expect(row.getByText(badge(ct.trust.levelLight), { exact: true })).toBeVisible();
    await expect(row.getByText(crewFill(ct.trust.eventRelax, { date: ct.trust.today }), { exact: true })).toBeVisible();
    await row.getByRole("button", { name: ct.trust.revoke, exact: true }).click();
    await expect(row.getByText(badge(ct.trust.levelItem), { exact: true })).toBeVisible();
    await expect(row.getByText(ct.trust.noteRevoked, { exact: true })).toBeVisible();
  });

  test("Linden：少看中，事件 10/13，有「收回少看」", async ({ page }) => {
    const row = trustRow(page, "linden", "knowledge");
    await expect(row.getByText(badge(ct.trust.levelLight), { exact: true })).toBeVisible();
    await expect(row.getByText(crewFill(ct.trust.eventRelax, { date: "10/13" }), { exact: true })).toBeVisible();
    await expect(row.getByText(ct.trust.noteLight, { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: ct.trust.revoke, exact: true })).toBeVisible();
  });

  test("Juniper：7 個圓點與空格「還沒有更多驗收」，不提出建議", async ({ page }) => {
    const row = trustRow(page, "juniper", "dev");
    await expect(dots(row).getByRole("listitem")).toHaveCount(7);
    await expect(row.getByText(ct.trust.bandEmpty, { exact: true })).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });
});

test("staff：看得到時間軸，沒有按鈕，說明只能查看", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTrustAs(page, "staff");
  const row = trustRow(page, "sorrel", "content");
  await expect(dots(row).getByRole("listitem")).toHaveCount(10);
  await expect(row.getByText(ct.trust.noteViewOnly, { exact: true })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("手機 390：沒有水平捲動，時間軸在卡片內", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrustAs(page, "manager");
  const row = trustRow(page, "rowan", "support");
  await expect(dots(row).getByRole("listitem")).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const card = (await row.boundingBox())!;
  const list = (await dots(row).boundingBox())!;
  expect(list.x + list.width).toBeLessThanOrEqual(card.x + card.width);
});
