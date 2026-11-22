// 知識庫條目回流知識庫（#92 PR 3）：主管驗收 k13 →「已收進知識庫」→ 圖譜出現負責部門 → 打開出處，看到「來自 AI 員工 Linden」→
// 點了回到「工作與驗收」的 k13；問答的出處（假的 /api/ask 引用回流段落）同樣看得到來源；一般員工看不到回流的文件。
// 只在有 crew/demo.json 的客戶執行；/api/ask 一律是 page.route 的假回應（openApp）。
import { expect, test, type Page } from "@playwright/test";
import { openApp, openTab, s, switchIdentity } from "./support/app";
import { language, readClientJson } from "./support/client";
import { sseBody } from "./support/fake-ask";
import { crewFill, ct, demo, gotoCrewSection, hasCrewDemo, openCrew, reviewPanel } from "./support/crew";
import { toFlowbackDocument } from "../app/src/crew/knowledge/flowback";

test.skip(!hasCrewDemo, "這個客戶沒有 crew/demo.json（沒有 crew 頁）");
test.use({ viewport: { width: 1440, height: 900 } });

type DemoAssignment = { id: string; employee: string; title: Record<string, string>; works: { body: Record<string, string> }[] };
const assignments = hasCrewDemo ? readClientJson<{ assignments: DemoAssignment[] }>("crew/demo.json").assignments : [];
const k13 = assignments.find((a) => a.id === "k13");
const title = k13?.title[language] ?? "";
const entry = k13 ? toFlowbackDocument(k13.works[0].body[language]) : null;
const employee = k13 ? demo.employees.find((e) => e.id === k13.employee)!.displayName : "";
const knowledge = hasCrewDemo ? readClientJson<{ origin: string }>(`i18n/crew/knowledge.${language}.json`) : { origin: "" };
// 「來自 AI 員工 ○○・驗收「○○」（日期）」：日期依瀏覽器時區，所以只比對日期之前的部分
const originPrefix = () => crewFill(knowledge.origin, { employee, title, date: "\u0000" }).split("\u0000")[0];
const originButton = (page: Page) => page.locator("aside.source").getByRole("button", { name: new RegExp(`^${escape(originPrefix())}`) });
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function acceptK13(page: Page): Promise<void> {
  await openCrew(page);
  await gotoCrewSection(page, ct.common.sectionWorks);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  await expect(panel.getByText(ct.review.knowledgeFlowed, { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: ct.review.accept, exact: true }).click();
  await expect(panel.getByText(ct.review.knowledgeFlowed, { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.skip(entry === null || entry.owner === null, "k13 不是有負責部門的知識庫條目");
  await openApp(page);
  await switchIdentity(page, "manager");
});

test("驗收 k13 →「打開原文」看到來源 → 圖譜出現負責部門，出處同樣有來源 → 點來源回到 k13", async ({ page }) => {
  await acceptK13(page);
  // 「工作與驗收」的「打開原文」：原文是條目，標題下是來源
  await reviewPanel(page, title).getByRole("button", { name: ct.review.knowledgeOpen, exact: true }).click();
  const source = page.locator("aside.source");
  await expect(source.getByRole("heading", { level: 2 })).toHaveText(entry!.title);
  await expect(originButton(page)).toBeVisible();

  // 圖譜：負責部門的節點，實體面板的「出現的文件」打開同一份原文
  await openTab(page, s.tabGraph);
  const owner = entry!.owner!.name;
  await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(owner);
  await page.getByRole("option", { name: new RegExp(`^${escape(owner)} `) }).click();
  await page.getByRole("region", { name: owner }).getByRole("button", { name: entry!.title, exact: true }).click();
  await expect(source.getByRole("heading", { level: 2 })).toHaveText(entry!.title);

  // 點來源：切到「工作與驗收」並選 k13，原文關閉
  await originButton(page).click();
  await expect(crewSectionButton(page)).toHaveAttribute("aria-current", "page");
  await expect(reviewPanel(page, title)).toBeVisible();
  await expect(source).toHaveCount(0);
});

const crewSectionButton = (page: Page) =>
  page.getByRole("navigation", { name: ct.common.sectionsLabel }).getByRole("button", { name: ct.common.sectionWorks, exact: true });

test("問答：假的 /api/ask 引用回流的段落，出處的原文有來源", async ({ page }) => {
  await acceptK13(page);
  // 引用 prompt 中內容屬於回流條目的那一段（找不到時引用第 1 段，測試在下方的斷言失敗）
  const passage = entry!.passages.at(-1)!;
  await page.route("**/api/ask", async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: string }[] };
    if (!(body.system ?? "").startsWith("You answer questions")) return route.fallback();
    const content = body.messages?.[0]?.content ?? "";
    const n = [...content.matchAll(/<passage number="(\d+)"[^>]*>([\s\S]*?)<\/passage>/g)].find((m) => m[2].includes(passage.split("\n").at(-1)!))?.[1] ?? "1";
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sseBody(`OK [${n}]。`) });
  });
  await openTab(page, s.tabQa);
  await page.getByPlaceholder(s.questionPlaceholder).fill(`${entry!.title} ${passage}`);
  await page.getByRole("button", { name: s.askButton, exact: true }).click();
  const answer = page.locator("section.answer").last();
  await expect(answer.getByText(s.answering)).toHaveCount(0);
  await answer.locator("button.citation").first().click();
  await expect(page.locator("aside.source").getByRole("heading", { level: 2 })).toHaveText(entry!.title);
  await expect(originButton(page)).toBeVisible();
});

test("一般員工：圖譜搜尋不到回流的部門（長堤專案）", async ({ page }) => {
  await acceptK13(page);
  await switchIdentity(page, "staff");
  await openTab(page, s.tabGraph);
  await page.getByRole("combobox", { name: s.graphSearch, exact: true }).fill(entry!.owner!.name);
  await expect(page.getByRole("option").filter({ hasText: entry!.owner!.name })).toHaveCount(0);
});
