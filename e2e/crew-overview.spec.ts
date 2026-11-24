// AI 員工頁的「總覽」（#134）：預設分頁、專案卡片與篩選（點卡片、篩選列、只看需注意、清除）、四欄看板、
// 點工作追到「工作與驗收」（待交件到「交辦」）、員工只看自己專案、訪客是空狀態。1280 與 390 都不橫向捲動；
// 390 時看板改成依狀態切換的清單（分段按鈕）。只在有 crew/demo.json 的客戶執行；/api/ask 是假的回應（openApp）。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, switchIdentity } from "./support/app";
import { access, language, readClientJson } from "./support/client";
import { assignmentTitle, crewContent, crewSections, ct, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");

type Status = "notSubmitted" | "awaiting" | "revising" | "done";
const STATUS_LABEL: Record<Status, keyof typeof ct.overview> = {
  notSubmitted: "statusNotSubmitted",
  awaiting: "statusAwaiting",
  revising: "statusRevising",
  done: "statusDone",
};
const demoToday = hasCrewDemo ? readClientJson<{ today?: string }>("crew/demo.json").today : undefined;
const projectLabel = (id: string) => access.projects.find((p) => p.id === id)!.label[language];

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const board = (page: Page) => page.getByRole("region", { name: ct.overview.boardLabel, exact: true });
const projects = (page: Page) => page.getByRole("region", { name: ct.overview.projectsLabel, exact: true });
const projectCard = (page: Page, id: string) => projects(page).getByRole("button").filter({ hasText: projectLabel(id) });
const column = (page: Page, status: Status) => board(page).getByRole("region", { name: new RegExp(`^${ct.overview[STATUS_LABEL[status]]}`) });
const workCard = (page: Page, status: Status, id: string) => column(page, status).getByRole("button").filter({ hasText: assignmentTitle(id) });
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");

// 窄螢幕一次只顯示一欄：以分段按鈕切到該狀態；桌機四欄並排，分段按鈕不顯示
async function showColumn(page: Page, status: Status): Promise<Locator> {
  const picker = board(page).getByRole("group", { name: ct.overview.statusPicker });
  if (await picker.isVisible()) {
    const button = picker.getByRole("button", { name: new RegExp(`^${escape(ct.overview[STATUS_LABEL[status]])}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await expect(column(page, status)).toBeVisible();
  return column(page, status);
}

async function openOverviewAs(page: Page, identity: string): Promise<void> {
  await openApp(page);
  await switchIdentity(page, identity);
  await openCrew(page);
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}`, () => {
    test.use({ viewport });

    test("主管：總覽是預設分頁，兩個專案的卡片；點卡片篩選、只看需注意、清除篩選", async ({ page }) => {
      expect(demoToday).toBe("2026-11-20");
      await openOverviewAs(page, "manager");
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionOverview, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(crewSections(page).getByRole("button").first()).toHaveText(ct.common.sectionOverview);
      await expect(projects(page).getByRole("button")).toHaveCount(2);
      await expect(projectCard(page, "bluewing")).toHaveAttribute("aria-pressed", "false");
      // 卡片：進度與需注意的件數（逾期、3 天內到期、停滯）
      await expect(projectCard(page, "bluewing").locator('.crew-overview__flag[data-flag="overdue"]')).toHaveText(ct.overview.flagOverdue.replace("{count}", "2"));
      await expect(projectCard(page, "longpier").locator('.crew-overview__flag[data-flag="stalled"]')).toHaveText(ct.overview.flagStalled.replace("{count}", "2"));
      expect(await noHorizontalScroll(page)).toBe(true);

      // 四種狀態在兩個專案都看得到
      await expect(await showColumn(page, "notSubmitted")).toContainText(assignmentTitle("s15"));
      await expect(column(page, "notSubmitted")).toContainText(assignmentTitle("k14"));
      await showColumn(page, "revising");
      await expect(workCard(page, "revising", "s16")).toBeVisible();
      await expect(workCard(page, "revising", "k15")).toBeVisible();
      await showColumn(page, "awaiting");
      // 等驗收：逾期的排最前面；停滯與檢查沒通過的標記
      await expect(column(page, "awaiting").getByRole("button").first()).toContainText(assignmentTitle("c12"));
      await expect(workCard(page, "awaiting", "c12").getByText(ct.overview.stalled, { exact: true })).toBeVisible();
      await expect(workCard(page, "awaiting", "c12").locator(".crew-due")).toHaveAttribute("data-due", "overdue");
      await expect(workCard(page, "awaiting", "s14").getByText(ct.overview.checkFailed, { exact: true })).toBeVisible();

      // 點專案卡片＝篩選成該專案
      await projectCard(page, "longpier").click();
      await expect(projectCard(page, "longpier")).toHaveAttribute("aria-pressed", "true");
      await expect(projectCard(page, "bluewing")).toHaveAttribute("aria-pressed", "false");
      const active = crewContent(page).locator(".crew-overview__active");
      await expect(active).toContainText(projectLabel("longpier"));
      await expect(workCard(page, "awaiting", "c12")).toHaveCount(0);
      await expect(workCard(page, "awaiting", "j11")).toBeVisible();

      // 再加上「只看需注意」：長堤只剩 j11（3 天內到期、停滯）與 k14（逾期、停滯）
      await crewContent(page).getByRole("checkbox", { name: ct.overview.filterAttention }).check();
      await expect(active).toContainText(ct.overview.filterAttention);
      await expect(column(page, "awaiting").getByRole("button").filter({ hasText: /./ })).toHaveCount(1);
      await expect(workCard(page, "awaiting", "j11")).toBeVisible();
      await expect(await showColumn(page, "notSubmitted")).toContainText(assignmentTitle("k14"));
      expect(await noHorizontalScroll(page)).toBe(true);

      // 清除篩選回到全部
      await active.getByRole("button", { name: ct.overview.clearFilter, exact: true }).click();
      await expect(active).toHaveCount(0);
      await expect(projectCard(page, "longpier")).toHaveAttribute("aria-pressed", "false");
      await expect(column(page, "notSubmitted")).toContainText(assignmentTitle("s15"));

      // 篩選列：員工與工作類型
      await crewContent(page).getByRole("combobox", { name: ct.overview.filterEmployee }).selectOption("sorrel");
      await showColumn(page, "awaiting");
      await expect(workCard(page, "awaiting", "c11")).toBeVisible();
      await expect(workCard(page, "awaiting", "s14")).toHaveCount(0);
      await expect(active).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test("主管：點工作追到「工作與驗收」並選中那一件；已完成的較早工作也能追到；待交件切到「交辦」", async ({ page }) => {
      await openOverviewAs(page, "manager");
      await showColumn(page, "awaiting");
      await workCard(page, "awaiting", "c12").click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(reviewPanel(page, assignmentTitle("c12"))).toBeVisible();

      // 已完成欄預設只顯示最近幾件；「顯示全部」後點最早完成的一件
      await crewSections(page).getByRole("button", { name: ct.common.sectionOverview, exact: true }).click();
      const done = await showColumn(page, "done");
      await expect(workCard(page, "done", "s01")).toHaveCount(0);
      await done.getByRole("button", { name: new RegExp(`^${escape(ct.overview.showAll.split("（")[0].split(" (")[0])}`) }).click();
      await workCard(page, "done", "s01").click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionWorks, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(reviewPanel(page, assignmentTitle("s01"))).toBeVisible();
      await expect(page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: assignmentTitle("s01") })).toHaveAttribute(
        "aria-current",
        "true",
      );

      // 待交件沒有交件可以驗收：切到「交辦」
      await crewSections(page).getByRole("button", { name: ct.common.sectionOverview, exact: true }).click();
      await showColumn(page, "notSubmitted");
      await workCard(page, "notSubmitted", "s15").click();
      await expect(crewSections(page).getByRole("button", { name: ct.common.sectionAssignments, exact: true })).toHaveAttribute("aria-current", "page");
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test("一般員工只看到自己專案；訪客是空狀態", async ({ page }) => {
      await openOverviewAs(page, "staff");
      await expect(projects(page).getByRole("button")).toHaveCount(1);
      await expect(projectCard(page, "bluewing")).toBeVisible();
      await expect(projectCard(page, "longpier")).toHaveCount(0);
      await showColumn(page, "awaiting");
      await expect(workCard(page, "awaiting", "c12")).toBeVisible();
      await expect(workCard(page, "awaiting", "j11")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);

      await switchIdentity(page, "guest");
      await openCrew(page);
      await expect(crewContent(page).getByText(ct.overview.empty, { exact: true })).toBeVisible();
      await expect(crewContent(page).getByRole("alert")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
