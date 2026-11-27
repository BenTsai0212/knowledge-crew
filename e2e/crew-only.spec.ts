// 只展示 AI 員工的 build（VITE_CREW_ONLY=1，#84，crew ADR 0005）：只在這個 build 執行（playwright.config.ts）。
// 不要求邀請碼、「直接體驗」以主管進入首頁（今天的工作在首頁，#96）、左側欄是首頁、圖譜、時間軸與 AI 員工（#91，RFC 0001 的 2026-11-22 修訂）、
// 首頁與圖譜沒有提問的入口、身分可切換，整個流程沒有任何 /api/* 請求。
// 部署的是 assets-only（wrangler.crew-demo.jsonc），沒有 /api/*：這裡讓 /api/* 一被呼叫就失敗並記錄下來。
import { expect, test, type Page } from "@playwright/test";
import { blockModelDownload, chooseAccount, EVALS_PATH, gotoView, s, signInPanel, switchIdentity, userCard } from "./support/app";
import { access, language, readClientJson } from "./support/client";
import { ct, crewContent, crewSections, gotoCrewSection, hasCrewDemo, homeToday, openCrew, reviewPanel, tourCard, tourDialog, walkTour } from "./support/crew";
import { toFlowbackDocument } from "../app/src/crew/knowledge/flowback";
import type { Cy } from "./support/graph";

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
// 左側欄（手機是底部分頁列）的頁籤：knowledge-kit 的首頁、圖譜、時間軸，AI 員工接在後面（#91）
const VIEWS = ["home", "graph", "timeline", "crew"];

async function expectViews(page: Page): Promise<void> {
  await expect(navViews(page)).toHaveCount(VIEWS.length);
  for (const [i, view] of VIEWS.entries()) await expect(navViews(page).nth(i)).toHaveAttribute("data-view", view);
  for (const label of [s.tabQa, s.tabUpload, s.tabReview, s.tabEvals]) {
    await expect(page.getByRole("navigation", { name: s.views }).getByRole("button", { name: new RegExp(`^${label}`) })).toHaveCount(0);
  }
}

// 沒有橫向捲動（不破版）
async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

// 首頁：沒有提問框、預設問題與「問過的問題」，提問框的位置是一行說明
async function expectHomeWithoutAsk(page: Page): Promise<void> {
  await expect(page.locator(".home")).toBeVisible();
  await expect(page.getByText(ct.common.noAsk, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: s.questionLabel })).toHaveCount(0);
  await expect(page.getByRole("group", { name: s.home.commonQuestions })).toHaveCount(0);
  await expect(page.locator(".home__asked, .home__waiting, .home__updates")).toHaveCount(0);
  await expect(page.locator(".home__documents")).toBeVisible();
}

// 圖譜：畫布有節點；回傳一個名稱不重複的節點名稱（沒有時是 null）
async function openGraph(page: Page): Promise<string | null> {
  await gotoView(page, "graph");
  const canvas = ".graph-page .graph-canvas";
  let labels: string[] = [];
  await expect(async () => {
    labels = await page.evaluate((selector) => {
      const cy = document.querySelector<HTMLElement & { _cyreg?: { cy?: Cy } }>(selector)?._cyreg?.cy;
      return cy === undefined ? [] : cy.nodes().map((n) => String(n.data("label")));
    }, canvas);
    expect(labels.length).toBeGreaterThan(0);
  }).toPass();
  return labels.find((name) => labels.filter((x) => x === name).length === 1) ?? null;
}

async function expectTimeline(page: Page): Promise<void> {
  await gotoView(page, "timeline");
  await expect(page.locator("ol.timeline > li").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

// 「直接體驗」進入：資料庫載入完成後是首頁，主管的今天的工作有待驗收（#96）
async function enter(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await directEntry(page).click();
  await expect(page.locator('[data-view="home"][aria-current="page"]')).toHaveCount(1);
  await expect(homeToday(page)).toBeVisible();
  await expect(homeToday(page).getByRole("heading", { name: ct.home.groupAwaiting, exact: true })).toBeVisible();
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

  test("直接體驗：以主管進入首頁，今天的工作有待驗收；左側欄是首頁、圖譜、時間軸、AI 員工，沒有「更換邀請碼」", async ({ page }) => {
    await enter(page);
    await expect(homeToday(page).getByRole("button", { name: new RegExp(`^${ct.home.actionReview}`) }).first()).toBeVisible();
    // 側欄的 AI 員工有待驗收件數
    await expect(page.locator('.primary-tabs [data-view="crew"] .crew-tab-count')).toHaveText(/^[1-9]\d*/);
    await expect(navViews(page)).toHaveCount(VIEWS.length);
    await expect(navViews(page).last()).toHaveAttribute("data-view", "crew");
    await expectViews(page);
    await expect(userCard(page).getByRole("button", { name: s.changeAccessCode, exact: true })).toHaveCount(0);
    await expect(page.getByText(s.fictionalData, { exact: false }).first()).toBeVisible();
    // 第一次來的導覽（#122）：不自動彈出，只有首頁的入口小卡
    await expect(tourCard(page)).toBeVisible();
    await expect(tourDialog(page)).toHaveCount(0);
  });

  test("直接體驗後焦點在首頁的主標題（#153 第 6 點）", async ({ page }) => {
    await enter(page);
    await expect(page.locator(".home__top h1")).toBeFocused();
  });

  test("第一次來的導覽：8 步走完，沒有 /api/* 請求（afterEach）", async ({ page }) => {
    await enter(page);
    await walkTour(page);
  });

  test("五個子畫面都能開啟，沒有錯誤", async ({ page }) => {
    await enter(page);
    await openCrew(page);
    for (const section of [
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

  test("切換身分後內容改變：訪客的「工作與驗收」是空狀態", async ({ page }) => {
    const guest = access.roles.find((r) => !r.canReview && !r.canUpload);
    test.skip(guest === undefined, "沒有不能審查也不能上傳的身分");
    await enter(page);
    await switchIdentity(page, guest!.id);
    // 訪客沒有可做的事：首頁不顯示今天的工作，同樣沒有提問與「有更新」的入口
    await expect(homeToday(page)).toHaveCount(0);
    await expectHomeWithoutAsk(page);
    await expect(navViews(page)).toHaveCount(VIEWS.length);
    await openCrew(page);
    // 預設是「總覽」（#134）：訪客沒有資料時是空狀態；「工作與驗收」同樣是空狀態
    await expect(crewContent(page).getByText(ct.overview.empty, { exact: true })).toBeVisible();
    await gotoCrewSection(page, ct.common.sectionWorks);
    await expect(page.getByText(ct.review.empty, { exact: true })).toBeVisible();
  });

  test("帳號登入：沒有邀請碼欄，按「登入」就進入首頁", async ({ page }) => {
    await page.goto("/");
    const panel = signInPanel(page);
    await chooseAccount(panel, access.roles[0].id);
    await panel.getByRole("button", { name: s.signInSubmit, exact: true }).click();
    await expect(page.locator(".home")).toBeVisible();
    await expect(crewSections(page)).toHaveCount(0);
    await expect(navViews(page)).toHaveCount(VIEWS.length);
  });

  // 回流知識庫（#92 PR 3）：驗收、寫入文件與段落、原文的來源都在瀏覽器內完成，不呼叫 /api/*（afterEach）
  test("驗收 k13 後「已收進知識庫」，打開原文看到來源，點來源回到 k13", async ({ page }) => {
    const k13 = readClientJson<{ assignments: { id: string; title: Record<string, string>; works: { body: Record<string, string> }[] }[] }>("crew/demo.json").assignments.find((a) => a.id === "k13");
    const entry = k13 ? toFlowbackDocument(k13.works[0].body[language]) : null;
    test.skip(k13 === undefined || entry === null, "沒有待驗收的知識庫條目 k13");
    const title = k13!.title[language];
    await enter(page);
    // 「直接體驗」後是首頁（#96），從導覽進 AI 員工
    await openCrew(page);
    await gotoCrewSection(page, ct.common.sectionWorks);
    await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
    const panel = reviewPanel(page, title);
    await panel.getByRole("button", { name: ct.review.accept, exact: true }).click();
    await expect(panel.getByText(ct.review.knowledgeFlowed, { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: ct.review.knowledgeOpen, exact: true }).click();
    const source = page.locator("aside.source");
    await expect(source.getByRole("heading", { level: 2 })).toHaveText(entry!.title);
    // 「這條知識經過的把關」（#147；原本是含交辦標題的一行按鈕）的「看這次驗收」
    await source.getByRole("region", { name: ct.knowledge.originTitle, exact: true }).getByRole("button", { name: ct.knowledge.originOpen, exact: true }).click();
    await expect(source).toHaveCount(0);
    await expect(reviewPanel(page, title)).toBeVisible();
  });

  for (const path of [EVALS_PATH, "/?mode=presentation"]) {
    test(`網址 ${path} 不改變畫面：頁籤仍是首頁、圖譜、時間軸、AI 員工`, async ({ page }) => {
      await enter(page, path);
      await expect(navViews(page)).toHaveCount(VIEWS.length);
      await expect(navViews(page).last()).toHaveAttribute("data-view", "crew");
      await expectViews(page);
    });
  }
});

test.describe("桌機 1280：首頁、圖譜、時間軸（#91）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("三個頁都能開，沒有提問的入口，不破版", async ({ page }) => {
    await enter(page);
    await expectViews(page);

    await gotoView(page, "home");
    await expectHomeWithoutAsk(page);
    await expectNoOverflow(page);

    const name = await openGraph(page);
    await expectNoOverflow(page);
    if (name !== null) {
      await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(name);
      await page.getByRole("option", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `) }).click();
      const panel = page.getByRole("region", { name });
      await expect(panel.getByRole("button", { name: s.graphShowOnly })).toBeVisible();
      await expect(panel.getByRole("button", { name: s.graphAskAbout })).toHaveCount(0);
      // A 鍵（在問答中問）不切到問答
      await page.keyboard.press("a");
      await expect(page.locator(".graph-page")).toBeVisible();
    }
    await expect(page.getByRole("button", { name: s.graphAskAbout })).toHaveCount(0);

    await expectTimeline(page);
    await expectNoOverflow(page);
    await expect(page.getByRole("textbox", { name: s.questionLabel })).toHaveCount(0);
  });
});

test.describe("手機", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("直接體驗後是首頁的今天的工作，焦點在主標題（#153）；點一列到「工作與驗收」該件", async ({ page }) => {
    await enter(page);
    await expect(page.locator(".home__top h1")).toBeFocused();
    const row = homeToday(page).getByRole("button", { name: new RegExp(`^${ct.home.actionReview}`) }).first();
    await row.click();
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(crewContent(page).first()).toBeVisible();
  });
});

test.describe("手機 390：首頁、圖譜、時間軸（#91）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("底部分頁列是首頁、圖譜、時間軸、AI 員工；三個頁都能開，沒有提問的入口，不破版", async ({ page }) => {
    await enter(page);
    await expectViews(page);
    await expect(page.locator('.mobile-tabbar [data-view="more"]')).toHaveCount(0);

    await gotoView(page, "home");
    await expectHomeWithoutAsk(page);
    await expectNoOverflow(page);

    await openGraph(page);
    await expect(page.getByRole("button", { name: s.graphAskAbout })).toHaveCount(0);
    await expectNoOverflow(page);

    await expectTimeline(page);
    await expectNoOverflow(page);
  });

  test("AI 員工：子頁是按鈕列、帶待驗收件數，決定列固定在底部（#103）", async ({ page }) => {
    await enter(page);
    await openCrew(page);
    // 預設是「總覽」（#134），明確切到「工作與驗收」
    await expect(crewSections(page).getByRole("button", { name: ct.common.sectionOverview, exact: true })).toHaveAttribute("aria-current", "page");
    await gotoCrewSection(page, ct.common.sectionWorks);
    const works = crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true });
    await expect(works).toHaveAttribute("aria-current", "page");
    await expect(works.locator(".ui-count")).toBeVisible();
    expect(await crewSections(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const bar = page.locator(".crew-review__decision");
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    await expectNoOverflow(page);
  });
});
