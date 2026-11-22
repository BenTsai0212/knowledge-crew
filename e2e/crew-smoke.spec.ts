// crew 的冒煙、權限與手機（#53，#15 計畫第 7、8 節的 L）：六個子頁都能進入、staff 沒有寫入按鈕、guest 看到空狀態、
// 手機從「更多」進入後在「工作與驗收」選一筆，面板標題在畫面上（#50）。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import {
  crewContent,
  crewFill,
  ct,
  demo,
  employeeName,
  gotoCrewSection,
  hasCrewDemo,
  openCrew,
  sourceLabel,
  sourcesOf,
  trustRow,
  workTypeName,
} from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

const SECTIONS = [
  ct.common.sectionToday,
  ct.common.sectionEmployees,
  ct.common.sectionAssignments,
  ct.common.sectionWorks,
  ct.common.sectionTrust,
  ct.common.sectionLedger,
];

// 畫面上每個員工名字都在 AI 標記之後（#66）；至少要出現一個名字
async function expectAiMarks(page: Page): Promise<void> {
  let seen = 0;
  for (const { displayName } of demo.employees) {
    const hits = crewContent(page).getByText(displayName);
    const n = await hits.count();
    for (let i = 0; i < n; i++) await expect(hits.nth(i).locator(".crew-ai-mark")).toHaveCount(1);
    seen += n;
  }
  expect(seen).toBeGreaterThan(0);
}

async function openCrewAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  await openCrew(page);
}

test.describe("冒煙（主管，桌機）", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => openCrewAs(page, "manager"));

  test("今天：待驗收、進行中、建議少看", async ({ page }) => {
    await gotoCrewSection(page, ct.common.sectionToday);
    for (const title of [ct.today.awaitingReview, ct.today.inProgress, ct.today.relaxSuggested]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
  });

  test("員工：每個員工一張卡片，列出工作類型與目前層級", async ({ page }) => {
    await gotoCrewSection(page, ct.common.sectionEmployees);
    const card = page.getByRole("region", { name: employeeName("linden") });
    await expect(card.getByRole("columnheader", { name: ct.employees.columnLevel })).toBeVisible();
    await expect(card.getByRole("rowheader", { name: workTypeName("knowledge") })).toBeVisible();
    await expect(page.getByRole("region", { name: employeeName("sorrel") })).toBeVisible();
  });

  test("交辦：表單與交辦清單", async ({ page }) => {
    await gotoCrewSection(page, ct.common.sectionAssignments);
    const form = page.getByRole("form", { name: ct.assign.formTitle });
    await expect(form.getByRole("textbox")).toBeVisible();
    await expect(form.getByRole("button", { name: ct.assign.submit, exact: true })).toBeDisabled();
    await expect(page.getByRole("region", { name: ct.assign.listTitle }).getByRole("listitem").first()).toBeVisible();
  });

  test("工作與驗收：工作清單與驗收面板", async ({ page }) => {
    await gotoCrewSection(page, ct.common.sectionWorks);
    await expect(page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").first()).toBeVisible();
    const panel = crewContent(page).getByRole("article");
    await expect(panel.getByRole("heading", { name: ct.review.points, exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: ct.review.checks, exact: true })).toBeVisible();
    // 自動檢查列（#66）：每一項檢查是 .crew-check；「執行中」改為「檢查中」
    await expect(panel.locator(".crew-check").first()).toBeVisible();
    await expect(crewContent(page)).not.toContainText("執行中");
    await expectAiMarks(page);
  });

  test("信任：每個員工 × 工作類型的圓點與目前層級", async ({ page }) => {
    await gotoCrewSection(page, ct.common.sectionTrust);
    const row = trustRow(page, "linden", "knowledge");
    await expect(row.getByText(crewFill(ct.trust.levelBadge, { level: ct.trust.levelLight }), { exact: true })).toBeVisible();
    await expect(row.getByRole("listitem").first()).toBeVisible();
    await expectAiMarks(page);
  });

  test("工作帳本：篩選與紀錄", async ({ page }) => {
    await gotoCrewSection(page, ct.common.sectionLedger);
    await expect(crewContent(page).getByRole("combobox", { name: new RegExp(`^${ct.ledger.filterEmployee}`) })).toBeVisible();
    await expect(page.getByRole("list", { name: ct.ledger.listLabel }).getByRole("listitem").first()).toBeVisible();
  });
});

test.describe("權限（桌機）", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const WRITE_BUTTONS = [ct.assign.submit, ct.assign.simulate, ct.review.accept, ct.review.return, ct.trust.agreeRelax, ct.trust.revoke];

  test("staff：看得到青翼專案的交辦與工作，各子頁都沒有寫入按鈕", async ({ page }) => {
    await openCrewAs(page, "staff");
    // 交辦清單的參照以來源的顯示名稱開頭（refRepo／refOther／refSourceOnly）
    const startsWith = (name: string) => new RegExp("^" + name.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&"));
    const bluewing = sourcesOf("bluewing").map(sourceLabel);
    const longpier = sourcesOf("longpier").map(sourceLabel);
    expect(bluewing.length).toBeGreaterThan(0);
    expect(longpier.length).toBeGreaterThan(0);

    await gotoCrewSection(page, ct.common.sectionAssignments);
    await expect(page.getByText(ct.assign.readOnlyNote, { exact: true })).toBeVisible();
    const list = page.getByRole("region", { name: ct.assign.listTitle });
    for (const name of bluewing) await expect(list.getByText(startsWith(name)).first()).toBeVisible();
    for (const name of longpier) await expect(list.getByText(startsWith(name))).toHaveCount(0);

    await gotoCrewSection(page, ct.common.sectionWorks);
    await expect(page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").first()).toBeVisible();
    // 驗收面板（外層的 article；交件本身也是 article，#72）；不能驗收的身分看到「只能查看」
    await expect(crewContent(page).getByRole("article").first()).toBeVisible();
    await expect(crewContent(page).getByText(ct.review.viewOnlyNote, { exact: true })).toBeVisible();

    for (const section of SECTIONS) {
      await gotoCrewSection(page, section);
      await expect(crewContent(page).first()).toBeVisible();
      await expect(page.getByText(ct.today.loading, { exact: true })).toHaveCount(0);
      for (const name of WRITE_BUTTONS) await expect(crewContent(page).getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(crewContent(page).getByRole("form")).toHaveCount(0);
    }
  });

  test("guest：各子頁都是空狀態，沒有錯誤", async ({ page }) => {
    await openCrewAs(page, "guest");
    const empty: [string, string][] = [
      [ct.common.sectionToday, ct.today.allEmpty],
      [ct.common.sectionEmployees, ct.employees.empty],
      [ct.common.sectionAssignments, ct.assign.empty],
      [ct.common.sectionWorks, ct.review.empty],
      [ct.common.sectionTrust, ct.trust.empty],
      [ct.common.sectionLedger, ct.ledger.empty],
    ];
    for (const [section, text] of empty) {
      await gotoCrewSection(page, section);
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(crewContent(page).getByRole("alert")).toHaveCount(0);
    }
  });
});

test.describe("手機", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("從「更多」進入 crew，在「工作與驗收」選一筆後面板標題在畫面上", async ({ page }) => {
    await openCrewAs(page, "manager");
    await gotoCrewSection(page, ct.common.sectionWorks);
    // 選最後一筆（最近驗收過，不是預設選取的那一筆）；窄螢幕的清單在面板之下
    const item = page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").last();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await expect(item).toHaveAttribute("aria-current", "true");
    await expect(crewContent(page).getByRole("article").getByRole("heading", { level: 3 })).toBeInViewport();
  });
});
