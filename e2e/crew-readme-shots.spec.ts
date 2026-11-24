// AI 員工的 README 截圖（knowledge-crew #106）：桌機 1440×900 的首頁今天的工作、總覽（#134）、驗收面板（Rowan 的回信）、信任時間軸，
// 與手機 390×844 的驗收面板（固定的決定列），寫到 docs/crew/images/<名稱>.png。
// 不是測試，預設不執行：KC_README_SHOTS=1 時 playwright.config.ts 只執行這個檔案（重新產生的方式見 docs/testing.md「AI 員工的 README 截圖」）。
// 參考情境（client/）的虛構資料、預設語言、主管身分、Light 模式、減少動態效果；/api/ask 是 openApp() 的假回應（不呼叫模型）；
// openApp() 以邀請碼登入後才截圖，截圖中沒有登入頁與邀請碼。
import { expect, test, type Page } from "@playwright/test";
import { gotoView, openApp, switchIdentity } from "./support/app";
import { access, language, readClientJson } from "./support/client";
import { ct, gotoCrewSection, hasCrewDemo, homeToday, openCrew, reviewPanel, trustRow } from "./support/crew";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const shotPath = (name: string) => `docs/crew/images/${name}.png`;
const manager = access.roles.find((r) => r.canReview && r.canUpload);

// Rowan 待驗收的回信（虛構資料的 s14）
const rowanReply = hasCrewDemo
  ? readClientJson<{ assignments: { id: string; title: Record<string, string> }[] }>("crew/demo.json").assignments.find((a) => a.id === "s14")!.title[language]
  : "";

test.use({ colorScheme: "light", reducedMotion: "reduce" });

test.beforeEach(() => {
  test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 AI 員工）");
  test.skip(manager === undefined, "access.json 沒有同時 canUpload 與 canReview 的身分");
});

async function start(page: Page): Promise<void> {
  await openApp(page);
  await switchIdentity(page, manager!.id);
}

async function openRowanReply(page: Page): Promise<void> {
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: rowanReply }).click();
  await expect(reviewPanel(page, rowanReply)).toBeVisible();
}

test.describe("桌機", () => {
  test.use({ viewport: DESKTOP });

  test("首頁今天的工作、總覽、驗收面板、信任時間軸", async ({ page }) => {
    await start(page);
    expect(await gotoView(page, "home")).toBe(true);
    await expect(homeToday(page)).toBeVisible();
    await page.screenshot({ path: shotPath("home-today") });

    // 總覽是 AI 員工頁的預設分頁（#134）
    await openCrew(page);
    await expect(page.getByRole("region", { name: ct.overview.boardLabel })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("overview") });

    await openRowanReply(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("review") });

    await gotoCrewSection(page, ct.common.sectionTrust);
    await expect(trustRow(page, "rowan", "support")).toBeVisible();
    await page.screenshot({ path: shotPath("trust") });
  });
});

test.describe("手機", () => {
  test.use({ viewport: MOBILE });

  test("驗收面板（固定的決定列）", async ({ page }) => {
    await start(page);
    await openRowanReply(page);
    // 捲到面板的全文，決定列固定在底部分頁列之上
    await reviewPanel(page, rowanReply).locator(".crew-review__decision").waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shotPath("mobile-review") });
  });
});
