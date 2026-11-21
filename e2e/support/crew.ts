// knowledge-crew 的 crew 頁籤（#34，ADR 0004 的修訂）：選定的客戶有 crew/demo.json 時，App 在 knowledge-kit 的頁籤之後接上 crew。
// 手機的分頁列與「更多」的斷言以此判斷；沒有 demo.json 的客戶（kestrova-demo、medsupply-demo）維持 knowledge-kit 原本的斷言。
import { existsSync } from "node:fs";
import { clientDir } from "./client";

export const hasCrewDemo = existsSync(`${clientDir}/crew/demo.json`);

// ---- crew 的 E2E 共用操作（#53）：crew-smoke.spec.ts、crew-flow.spec.ts ----
import { expect, type Locator, type Page } from "@playwright/test";
import { language, readClientJson } from "./client";
import { gotoView } from "./app";

// crew 的介面文字（client/i18n/crew/<畫面>.<語言>.json），只讀預設語言；沒有 crew 的客戶不讀（測試整個略過）
type CrewFiles = {
  common: typeof import("@client/i18n/crew/common.zh-TW.json");
  today: typeof import("@client/i18n/crew/today.zh-TW.json");
  employees: typeof import("@client/i18n/crew/employees.zh-TW.json");
  assign: typeof import("@client/i18n/crew/assign.zh-TW.json");
  review: typeof import("@client/i18n/crew/review.zh-TW.json");
  trust: typeof import("@client/i18n/crew/trust.zh-TW.json");
  ledger: typeof import("@client/i18n/crew/ledger.zh-TW.json");
};
const crewJson = <S extends keyof CrewFiles>(screen: S): CrewFiles[S] =>
  hasCrewDemo ? readClientJson<CrewFiles[S]>(`i18n/crew/${screen}.${language}.json`) : ({} as CrewFiles[S]);
export const ct = {
  common: crewJson("common"),
  today: crewJson("today"),
  employees: crewJson("employees"),
  assign: crewJson("assign"),
  review: crewJson("review"),
  trust: crewJson("trust"),
  ledger: crewJson("ledger"),
};

// 代入 {key}（只用於沒有單複數寫法的文字）
export function crewFill(template: string, values: Record<string, string | number>): string {
  if (template.includes(", plural")) throw new Error(`crewFill 不處理單複數：${template}`);
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]));
}

// 虛構資料（client/crew/demo.json）：員工、工作類型與工作來源以 id 指定，名稱從資料讀
interface Demo {
  sources: { id: string; kind: string; name: string; project: string }[];
  employees: { id: string; displayName: string }[];
  simulations: { employee: string; workType: string; replies: { body: Record<string, string> }[] }[];
}
export const demo: Demo = hasCrewDemo ? readClientJson<Demo>("crew/demo.json") : { sources: [], employees: [], simulations: [] };
export const employeeName = (id: string) => demo.employees.find((e) => e.id === id)!.displayName;
export const workTypeName = (id: string) => (ct.common as Record<string, string>)[`workType${id.charAt(0).toUpperCase()}${id.slice(1)}`];
export const repoOf = (project: string) => demo.sources.find((s) => s.kind === "repo" && s.project === project)!;
// 模擬交件第一輪的全文
export const firstReplyBody = (employee: string, workType: string) =>
  demo.simulations.find((x) => x.employee === employee && x.workType === workType)!.replies[0].body[language];

// crew 頁：子導覽與目前子頁的內容（不含頁首與子導覽）
export const crewSections = (page: Page) => page.getByRole("navigation", { name: ct.common.sectionsLabel });
export const crewContent = (page: Page) => crewSections(page).locator("xpath=following-sibling::*");

// 進入 crew 頁（桌機是左側欄，手機是「更多」）
export async function openCrew(page: Page): Promise<void> {
  expect(await gotoView(page, "crew")).toBe(true);
  await expect(crewSections(page)).toBeVisible();
}

// 切到 crew 的子頁（label 是 common 的 section* 文字）
export async function gotoCrewSection(page: Page, label: string): Promise<void> {
  const button = crewSections(page).getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

// 信任頁的一列（員工 × 工作類型）
export const trustRow = (page: Page, employee: string, workType: string): Locator =>
  page.getByRole("region", { name: crewFill(ct.trust.rowTitle, { employee: employeeName(employee), workType: workTypeName(workType) }) });

// 交辦 → 模擬交件 → 在「工作與驗收」選這一筆並以 reason（review 的 reason* 文字）退回；beforeReturn 在退回前檢查面板。
// 結束時停在「工作與驗收」
export async function assignSimulateReturn(
  page: Page,
  input: { title: string; employee: string; workType: string; reason: string; beforeReturn?: (panel: Locator) => Promise<void> },
): Promise<void> {
  const { title, employee, workType, reason, beforeReturn } = input;
  await gotoCrewSection(page, ct.common.sectionAssignments);
  const form = page.getByRole("form", { name: ct.assign.formTitle });
  await form.getByRole("textbox").fill(title);
  await form.getByLabel(new RegExp(`^${ct.assign.fieldSource}`)).selectOption(repoOf("bluewing").id);
  await form.getByLabel(new RegExp(`^${ct.assign.fieldEmployee}`)).selectOption(employee);
  await form.getByLabel(new RegExp(`^${ct.assign.fieldWorkType}`)).selectOption(workType);
  await form.getByRole("button", { name: ct.assign.submit, exact: true }).click();

  const item = page.getByRole("region", { name: ct.assign.listTitle }).getByRole("listitem").filter({ hasText: title });
  await expect(item.getByText(ct.assign.statusNotSubmitted, { exact: true })).toBeVisible();
  await item.getByRole("button", { name: ct.assign.simulate, exact: true }).click();
  await expect(item.getByText(ct.assign.statusAwaitingReview, { exact: true })).toBeVisible();

  await gotoCrewSection(page, ct.common.sectionWorks);
  await page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title }).click();
  const panel = reviewPanel(page, title);
  await expect(panel).toBeVisible();
  if (beforeReturn) await beforeReturn(panel);
  await panel.getByRole("button", { name: ct.review.return, exact: true }).click();
  await panel.getByRole("radio", { name: reason, exact: true }).check();
  await panel.getByRole("button", { name: ct.review.confirmReturn, exact: true }).click();
  const listed = page.getByRole("navigation", { name: ct.review.listLabel }).getByRole("button").filter({ hasText: title });
  await expect(listed.getByText(ct.review.verdictReturned, { exact: true })).toBeVisible();
}

// 「工作與驗收」的驗收面板（名稱是工作的標題）
export const reviewPanel = (page: Page, title: string) => page.getByRole("article", { name: title });
