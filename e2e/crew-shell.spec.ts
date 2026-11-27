// 外框（#182，crew 設計規格 v4 第 4 節、crew ADR 0009 第四節；畫面照 docs/crew/design/v5/screens/ 的側欄、topbar、tabbar）：
// 桌機 1280 是 232px 的側欄（圖示＋名稱，有 AI 員工時 AI 員工與評測台在分隔線之後，底部「虛構資料 · 展示用權限」與身分卡）；
// 720–980px（這裡用 900）是 72px 的圖示側欄（名稱只給輔助技術、數字在圖示右上角）；手機 390 是一行的頂端列（字標、「虛構資料」、頭像）
// 與底部分頁列（有 AI 員工時第 4 格是 AI 員工）。沒有 AI 員工的客戶也執行，分頁列維持 knowledge-kit 的排法。/api/ask 一律是假的回應
import { expect, test, type Page } from "@playwright/test";
import { identityBadge, identitySheet, openApp, s, switchIdentity } from "./support/app";
import { NO_REVIEWER, reviewer } from "./support/client";
import { ct, hasCrewDemo, openCrew } from "./support/crew";

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const viewsIn = (page: Page, selector: string) => page.locator(`${selector} [data-view]`).evaluateAll((bs) => bs.map((b) => b.getAttribute("data-view")));
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test.describe("桌機 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("側欄 232px：每一項有圖示，目前的頁面是墨色底；底部是「虛構資料 · 展示用權限」與身分卡（打開身分與語言）", async ({ page }) => {
    await openApp(page);
    expect((await box(page, ".sidebar")).width).toBeCloseTo(232, 0);
    const current = page.locator('.sidebar .primary-tabs [aria-current="page"]');
    await expect(current).toHaveCount(1);
    // 墨色底：與 var(--color-text) 算出來的顏色相同
    const ink = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style.background = "var(--color-text)";
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(ink);
    for (const tab of await page.locator(".sidebar .primary-tabs button[data-view]").all()) await expect(tab.locator("svg.nav-icon")).toHaveCount(1);
    await expect(page.locator(".sidebar .sidebar__labels")).toContainText(s.fictionalData);
    await expect(page.locator(".sidebar .sidebar__labels svg.demo-flag__icon")).toHaveCount(1);
    await identityBadge(page).click();
    await expect(identitySheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(identityBadge(page)).toBeFocused();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("主管：有 AI 員工時 AI 員工與評測台在分隔線之後，AI 員工的數字是待驗收", async ({ page }) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    await openApp(page, "/?tools=evals");
    await switchIdentity(page, reviewer!.id);
    const views = await viewsIn(page, ".sidebar .primary-tabs");
    expect(views).toEqual(hasCrewDemo ? ["home", "qa", "graph", "timeline", "upload", "review", "crew", "evals"] : ["home", "qa", "graph", "timeline", "upload", "review", "evals"]);
    await expect(page.locator(".sidebar .nav-sep")).toHaveCount(hasCrewDemo ? 1 : 0);
    if (!hasCrewDemo) return;
    // 分隔線在待審與 AI 員工之間
    const order = await page.locator(".sidebar .primary-tabs > *").evaluateAll((els) => els.map((el) => el.getAttribute("data-view") ?? el.className));
    expect(order.indexOf("nav-sep")).toBe(order.indexOf("crew") - 1);
    await expect(page.locator('.sidebar [data-view="crew"] .crew-tab-count')).toBeVisible();
  });

  test("「虛構資料」只在外框：AI 員工的頁首沒有另一個標示", async ({ page }) => {
    test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");
    await openApp(page);
    await openCrew(page);
    await expect(page.locator(".crew-page .ui-page-head")).not.toContainText(s.fictionalData);
    await expect(page.getByText(s.fictionalData, { exact: true })).toHaveCount(1);
    // #179：AI 員工的 h1 是子頁名稱，「AI 員工」是頁首的小字
    await expect(page.getByRole("heading", { level: 1, name: ct.common.sectionOverview })).toBeVisible();
    await expect(page.locator(".crew-page .ui-page-head")).toContainText(ct.common.title);
  });
});

test.describe("寬度 900（720–980px）", () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test("側欄縮成 72px 的圖示列：名稱不顯示但留在按鈕的名稱，數字在圖示右上角，「虛構資料」在頭像上方", async ({ page }) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    await openApp(page);
    await switchIdentity(page, reviewer!.id);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    expect((await box(page, "nav.nav-rail")).width).toBeCloseTo(72, 0);
    const home = page.locator('nav.nav-rail [data-view="home"]');
    await expect(home).toHaveAccessibleName(s.tabHome);
    expect((await home.locator(".nav-rail__label").boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(page.locator('nav.nav-rail [aria-current="page"]')).toHaveCount(1);
    const flag = page.locator("nav.nav-rail .nav-rail__flag");
    await expect(flag).toContainText(s.fictionalData);
    expect((await flag.boundingBox())!.y).toBeLessThan((await identityBadge(page).boundingBox())!.y);
    // 數字（待審、AI 員工）在按鈕的右半邊、上半部
    for (const count of await page.locator("nav.nav-rail :is(.tab-count, .crew-tab-count)").all()) {
      const c = (await count.boundingBox())!;
      const b = (await count.locator("xpath=ancestor::button[1]").boundingBox())!;
      expect(c.x + c.width / 2).toBeGreaterThan(b.x + b.width / 2);
      expect(c.y + c.height / 2).toBeLessThan(b.y + b.height / 2);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe("手機 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("頂端列一行：字標、「虛構資料」、身分的頭像（打開身分面板，Esc 關閉後焦點回到頭像）", async ({ page }) => {
    await openApp(page);
    const top = page.locator(".mobile-topbar");
    await expect(top.locator(".mobile-topbar__flag")).toHaveText(s.fictionalData);
    const row = (await box(page, ".mobile-topbar__row")).y;
    for (const part of [".mobile-brand", ".mobile-topbar__flag", ".identity-badge"]) {
      const b = await box(page, `.mobile-topbar ${part}`);
      expect(b.y + b.height / 2).toBeGreaterThan(row);
      expect(b.y + b.height / 2).toBeLessThan(row + 56);
    }
    const avatar = identityBadge(page);
    expect((await avatar.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await avatar.click();
    await expect(identitySheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(identitySheet(page)).toBeHidden();
    await expect(avatar).toBeFocused();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("主管的底部分頁列：有 AI 員工時是首頁、問答、圖譜、AI 員工、更多（時間軸、上傳、待審）；沒有時維持現行的排法", async ({ page }) => {
    test.skip(reviewer === undefined, NO_REVIEWER);
    await openApp(page);
    await switchIdentity(page, reviewer!.id);
    expect(await viewsIn(page, ".mobile-tabbar")).toEqual(hasCrewDemo ? ["home", "qa", "graph", "crew", "more"] : ["home", "qa", "graph", "upload", "more"]);
    await page.locator('.mobile-tabbar [data-view="more"]').click();
    expect(await viewsIn(page, "dialog.more-sheet")).toEqual(hasCrewDemo ? ["timeline", "upload", "review"] : ["timeline", "review"]);
    await page.keyboard.press("Escape");
    if (!hasCrewDemo) return;
    await page.locator('.mobile-tabbar [data-view="crew"]').click();
    await expect(page.locator('.mobile-tabbar [data-view="crew"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: ct.common.sectionOverview })).toBeVisible();
  });
});
