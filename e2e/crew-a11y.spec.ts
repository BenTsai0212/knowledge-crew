// crew 畫面的 axe 可近用性檢查（#155，#153 第 9 點）：只在只展示 AI 員工的 build（VITE_CREW_ONLY=1）執行（playwright.config.ts）。
// 掃 crew 的畫面：登入面板、首頁的主標題與「今天的工作」、AI 員工各子頁的 .crew-page 之內；不含側欄、頁首與底部分頁列。
// 違規數要是 0；失敗時列出每個違規的規則 id 與節點選擇器。每個視窗一個 test 依序走完（不每頁重開，避免每次重建 PGlite）。
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { blockModelDownload, signInPanel } from "./support/app";
import {
  assignmentTitle,
  ct,
  crewContent,
  gotoCrewSection,
  gotoRecordsStats,
  gotoWorksBoard,
  hasCrewDemo,
  homeToday,
  openCrew,
  worksViewSwitch,
} from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（crew-only 不生效）");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// 登入面板內屬於 knowledge-kit、且有違規的節點（不在此修，列在 PR 說明）；目前沒有
const SIGN_IN_EXCLUDE: string[] = [];

interface Scan {
  name: string;
  ms: number;
  violations: string[];
}

async function scan(
  page: Page,
  scans: Scan[],
  name: string,
  include: string[],
  exclude: string[] = [],
): Promise<void> {
  for (const selector of include)
    await expect(page.locator(selector).first()).toBeVisible();
  const started = Date.now();
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of include) builder = builder.include(selector);
  for (const selector of exclude) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  scans.push({
    name,
    ms: Date.now() - started,
    violations: violations.flatMap((v) =>
      v.nodes.map(
        (n) => `${v.id}（${v.impact ?? "?"}）：${n.target.join(" ")}`,
      ),
    ),
  });
}

function report(scans: Scan[]): void {
  const total = scans.reduce((sum, s) => sum + s.ms, 0);
  for (const s of scans)
    console.log(`axe ${s.name}：${s.violations.length} 個違規，${s.ms} ms`);
  console.log(`axe 合計：${scans.length} 次掃描，${total} ms`);
  const failed = scans
    .filter((s) => s.violations.length > 0)
    .map((s) => `${s.name}\n  ${s.violations.join("\n  ")}`);
  expect(failed, `axe 違規：\n${failed.join("\n")}`).toEqual([]);
}

const CREW = [".crew-page"];

async function walk(page: Page): Promise<void> {
  const scans: Scan[] = [];
  await blockModelDownload(page);
  await page.route("**/api/**", (route) => route.abort());

  await page.goto("/");
  await scan(page, scans, "登入", ["section.sign-in"], SIGN_IN_EXCLUDE);

  await signInPanel(page)
    .getByRole("button", { name: ct.common.directEntry, exact: true })
    .click();
  await expect(homeToday(page)).toBeVisible();
  await expect(
    homeToday(page).getByRole("heading", {
      name: ct.home.groupAwaiting,
      exact: true,
    }),
  ).toBeVisible();
  await scan(page, scans, "首頁", ["#home-title", ".crew-home"]);

  // 最近的變化（#182）：鈴鐺打開的面板掃一次，Esc 關閉
  await page.getByRole("button", { name: ct.changes.bell, exact: true }).click();
  await expect(page.locator("dialog.crew-changes-sheet .crew-changes__item").first()).toBeVisible();
  // 桌機的面板是淡入（kFade）：動畫結束後再掃，否則對比度以半透明計算
  await page.locator("dialog.crew-changes-sheet").evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)));
  await scan(page, scans, "最近的變化", ["dialog.crew-changes-sheet"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.crew-changes-sheet")).toBeHidden();

  await openCrew(page);
  // 工作的看板（#191：原本的「總覽」）
  await gotoWorksBoard(page);
  await expect(page.locator(".crew-overview__projects")).toBeVisible();
  await scan(page, scans, "工作（看板）", CREW);
  // 員工（#191：含原本「信任」每類工作的審查方式）
  for (const [name, section] of [
    ["員工", ct.common.sectionEmployees],
    ["交辦", ct.common.sectionAssignments],
  ] as const) {
    await gotoCrewSection(page, section);
    await expect(crewContent(page).first()).toBeVisible();
    await scan(page, scans, name, CREW);
  }

  // 工作的清單（原本的「工作與驗收」）：打開一筆，退回表單打開與關閉各掃一次
  await gotoCrewSection(page, ct.common.sectionWorks);
  await worksViewSwitch(page).getByRole("button", { name: ct.common.viewList, exact: true }).click();
  const content = page.locator(".crew-page");
  await page
    .getByRole("navigation", { name: ct.review.listLabel })
    .getByRole("button")
    .first()
    .click();
  const returnButton = content.getByRole("button", {
    name: ct.review.return,
    exact: true,
  });
  await expect(returnButton).toBeVisible();
  await scan(page, scans, "工作與驗收", CREW);
  await returnButton.click();
  const cancel = content.getByRole("button", {
    name: ct.review.cancel,
    exact: true,
  });
  await expect(cancel).toBeVisible();
  await scan(page, scans, "工作與驗收（退回表單打開）", CREW);
  await cancel.click();
  await expect(returnButton).toBeVisible();
  await scan(page, scans, "工作與驗收（退回表單關閉）", CREW);

  // 事後更正（#164）：已通過的 k12，表單打開時掃一次（不送出）
  await page
    .getByRole("navigation", { name: ct.review.listLabel })
    .getByRole("button")
    .filter({ hasText: assignmentTitle("k12") })
    .click();
  await content
    .getByRole("button", { name: ct.review.correctionOpen, exact: true })
    .click();
  await expect(
    content.getByRole("button", {
      name: ct.review.correctionSubmit,
      exact: true,
    }),
  ).toBeVisible();
  await scan(page, scans, "工作與驗收（事後更正表單打開）", CREW);

  // 抽查（#166）：k17 的「抽查：這次全部看」徽章（#195）、k13 按下「這次全部看」後各掃一次
  const workList = page.getByRole("navigation", { name: ct.review.listLabel });
  await workList.getByRole("button").filter({ hasText: assignmentTitle("k17") }).click();
  await expect(content.locator(".crew-review__spot")).toHaveText(ct.review.spotTag);
  await scan(page, scans, "工作與驗收（抽查）", CREW);
  await workList.getByRole("button").filter({ hasText: assignmentTitle("k13") }).click();
  await content.getByRole("button", { name: ct.review.fullOnce, exact: true }).click();
  await expect(content.getByRole("button", { name: ct.review.fullOnce, exact: true })).toHaveAttribute("aria-pressed", "true");
  await scan(page, scans, "工作與驗收（這次全部看）", CREW);

  // 紀錄的事件（原本的「工作帳本」）與統計（原本信任頁上方的總表，#191）
  await gotoCrewSection(page, ct.common.sectionRecords);
  await expect(crewContent(page).first()).toBeVisible();
  await scan(page, scans, "紀錄（事件）", CREW);
  await gotoRecordsStats(page);
  await expect(page.locator(".crew-trust-report")).toBeVisible();
  await scan(page, scans, "紀錄（統計）", CREW);

  report(scans);
}

test.describe("桌機 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("登入、首頁與 AI 員工的 4 個子頁（含看板與統計）：axe 沒有違規", async ({ page }) =>
    walk(page));
});

test.describe("手機 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("登入、首頁與 AI 員工的 4 個子頁（含看板與統計）：axe 沒有違規", async ({ page }) =>
    walk(page));
});
