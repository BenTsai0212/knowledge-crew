// 只展示 AI 員工的 build（VITE_CREW_ONLY=1，#84，crew ADR 0005）：只在這個 build 執行（playwright.config.ts）。
// 不要求邀請碼、「直接體驗」以主管進入 AI 員工的「今天」、左側欄只有 AI 員工、身分可切換，整個流程沒有任何 /api/* 請求。
// 部署的是 assets-only（wrangler.crew-demo.jsonc），沒有 /api/*：這裡讓 /api/* 一被呼叫就失敗並記錄下來。
import { expect, test, type Page } from "@playwright/test";
import { blockModelDownload, chooseAccount, EVALS_PATH, s, signInPanel, switchIdentity, userCard } from "./support/app";
import { access } from "./support/client";
import { ct, crewContent, crewSections, gotoCrewSection, hasCrewDemo } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（crew-only 不生效）");

const apiRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  apiRequests.length = 0;
  await blockModelDownload(page);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
});

test.afterEach(() => {
  expect(apiRequests).toEqual([]);
});

const directEntry = (page: Page) => signInPanel(page).getByRole("button", { name: ct.common.directEntry, exact: true });
const navViews = (page: Page) => page.locator(":is(.primary-tabs, .mobile-tabbar, .nav-rail) [data-view]");

// 「直接體驗」進入：資料庫載入完成後是 AI 員工的「今天」
async function enter(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await directEntry(page).click();
  await expect(crewSections(page)).toBeVisible();
  await expect(crewSections(page).getByRole("button", { name: ct.common.sectionToday, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(ct.today.loading, { exact: true })).toHaveCount(0);
}

test.describe("桌機", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("登入頁：不要求邀請碼，「使用邀請碼體驗」換成「直接體驗」；保留虛構資料與展示用權限的標示", async ({ page }) => {
    await page.goto("/");
    const panel = signInPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel(s.accessCodeLabel)).toHaveCount(0);
    await expect(panel.getByRole("button", { name: s.signInWithCode, exact: true })).toHaveCount(0);
    await expect(directEntry(page)).toBeVisible();
    await expect(page.getByText(s.fictionalData, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(s.demoPermissions, { exact: true }).first()).toBeVisible();
  });

  test("直接體驗：以主管進入「今天」，有待驗收的工作；左側欄只有 AI 員工，沒有「更換邀請碼」", async ({ page }) => {
    await enter(page);
    await expect(page.getByRole("heading", { name: ct.today.awaitingReview, exact: true })).toBeVisible();
    await expect(navViews(page)).toHaveCount(1);
    await expect(navViews(page).first()).toHaveAttribute("data-view", "crew");
    for (const label of [s.tabQa, s.tabUpload, s.tabReview, s.tabEvals]) {
      await expect(page.getByRole("navigation", { name: s.views }).getByRole("button", { name: new RegExp(`^${label}`) })).toHaveCount(0);
    }
    await expect(userCard(page).getByRole("button", { name: s.changeAccessCode, exact: true })).toHaveCount(0);
    await expect(page.getByText(s.fictionalData, { exact: false }).first()).toBeVisible();
  });

  test("六個子畫面都能開啟，沒有錯誤", async ({ page }) => {
    await enter(page);
    for (const section of [
      ct.common.sectionToday,
      ct.common.sectionEmployees,
      ct.common.sectionAssignments,
      ct.common.sectionWorks,
      ct.common.sectionTrust,
      ct.common.sectionLedger,
    ]) {
      await gotoCrewSection(page, section);
      await expect(crewContent(page).first()).toBeVisible();
      await expect(crewContent(page).getByRole("alert")).toHaveCount(0);
    }
  });

  test("切換身分後內容改變：訪客的「今天」是空狀態", async ({ page }) => {
    const guest = access.roles.find((r) => !r.canReview && !r.canUpload);
    test.skip(guest === undefined, "沒有不能審查也不能上傳的身分");
    await enter(page);
    await expect(page.getByRole("heading", { name: ct.today.awaitingReview, exact: true })).toBeVisible();
    await switchIdentity(page, guest!.id);
    await expect(page.getByText(ct.today.allEmpty, { exact: true })).toBeVisible();
    await expect(navViews(page)).toHaveCount(1);
  });

  test("帳號登入：沒有邀請碼欄，按「登入」就進入 AI 員工", async ({ page }) => {
    await page.goto("/");
    const panel = signInPanel(page);
    await chooseAccount(panel, access.roles[0].id);
    await panel.getByRole("button", { name: s.signInSubmit, exact: true }).click();
    await expect(crewSections(page)).toBeVisible();
    await expect(navViews(page)).toHaveCount(1);
  });

  for (const path of [EVALS_PATH, "/?mode=presentation"]) {
    test(`網址 ${path} 不改變畫面：仍只有 AI 員工`, async ({ page }) => {
      await enter(page, path);
      await expect(navViews(page)).toHaveCount(1);
      await expect(navViews(page).first()).toHaveAttribute("data-view", "crew");
    });
  }
});

test.describe("手機", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("直接體驗後是 AI 員工的「今天」", async ({ page }) => {
    await enter(page);
    await expect(crewContent(page).first()).toBeVisible();
  });
});
