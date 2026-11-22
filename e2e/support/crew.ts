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
interface DemoSource {
  id: string;
  kind: string;
  name: string;
  label?: Record<string, string>;
  project: string;
}
interface Demo {
  sources: DemoSource[];
  employees: { id: string; displayName: string }[];
  assignments: { employee: string; workType: string; source: string }[];
  simulations: { employee: string; workType: string; replies: { body: Record<string, string> }[] }[];
}
export const demo: Demo = hasCrewDemo
  ? readClientJson<Demo>("crew/demo.json")
  : { sources: [], employees: [], assignments: [], simulations: [] };
export const employeeName = (id: string) => demo.employees.find((e) => e.id === id)!.displayName;
export const workTypeName = (id: string) => (ct.common as Record<string, string>)[`workType${id.charAt(0).toUpperCase()}${id.slice(1)}`];
// 專案的工作來源；畫面上的名稱是目前語言的 label，沒有時是 name（#60 的 `## 決定` 2）
export const sourcesOf = (project: string) => demo.sources.filter((s) => s.project === project);
export const sourceLabel = (s: DemoSource) => s.label?.[language] ?? s.name;
// 員工 × 工作類型在虛構資料中交辦時用的來源
export const sourceOf = (employee: string, workType: string) => {
  const id = demo.assignments.find((a) => a.employee === employee && a.workType === workType)!.source;
  return demo.sources.find((s) => s.id === id)!;
};
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
  await form.getByRole("textbox", { name: ct.assign.fieldTitle, exact: true }).fill(title);
  // 交給誰是單選卡（#76）：選了員工後帶入他平常的來源（可改）與工作類型（唯讀）
  await form.getByRole("group", { name: ct.assign.fieldEmployee }).getByRole("radio", { name: new RegExp(employeeName(employee)) }).check();
  const source = form.getByLabel(new RegExp(`^${ct.assign.fieldSource}`));
  await source.selectOption(sourceOf(employee, workType).id);
  await expect(source).toHaveValue(sourceOf(employee, workType).id);
  await expect(form.getByLabel(new RegExp(`^${ct.assign.fieldWorkType}`))).toHaveValue(workTypeName(workType));
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

// ---- 知識庫條目的回流（#92）：seed 時回流的部門。依資料集算圖譜預期的 E2E 以此補上 ----
import type { DemoFile } from "../../app/src/crew/demo/types";
import { OWNER_ENTITY_TYPE, flowbackOwnerPendingId, toFlowbackDocument } from "../../app/src/crew/knowledge/flowback";
import { demoWorkId } from "../../app/src/crew/demo/types";
import { nameKeys } from "../../app/src/extraction/merge";
import type { Graph } from "../../app/src/graph/read";
import type { RoleId } from "./app";
import { access, knowledgeModel } from "./client";

// demo.json 已通過的知識庫條目在 seed 時新建的部門（crew/demo/seed.ts 與 db/store.ts 的 writeFlowback() 的規則），
// 加在 graph（資料集算出的預期）之後。同名的部門已在 graph 中時是合併，不新增節點
export function withCrewFlowback(graph: Graph, role: RoleId): Graph {
  const r = access.roles.find((x) => x.id === role);
  if (!hasCrewDemo || !r || !knowledgeModel.entityTypes.some((t) => t.id === OWNER_ENTITY_TYPE)) return graph;
  const demo = readClientJson<DemoFile>("crew/demo.json");
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));
  const uploaders = new Set(access.roles.filter((x) => x.canUpload).map((x) => x.id));
  // nameKeys() 只讀 aliasRules；檔案的型別（icon 可省略）與 app 的型別不同，所以轉型
  const keysOf = (names: string[]) => nameKeys(OWNER_ENTITY_TYPE, names, knowledgeModel.entityTypes as Parameters<typeof nameKeys>[2]);
  const added: Graph["entities"] = [];
  for (const a of demo.assignments) {
    const source = demo.sources.find((x) => x.id === a.source)!;
    const level = source.knowledgeVisibility;
    if (!level || rank.get(level)! > rank.get(r.visibility)! || !r.projects.includes(source.project)) continue;
    for (const w of a.works) {
      if (w.review?.verdict !== "accepted" || !uploaders.has(w.review.decidedBy)) continue;
      const owner = toFlowbackDocument(w.body[language])?.owner;
      if (!owner) continue;
      const keys = keysOf([owner.name]);
      const same = [...graph.entities, ...added].filter((e) => e.type === OWNER_ENTITY_TYPE && [...keysOf([e.name, ...Object.values(e.names)])].some((k) => keys.has(k)));
      if (same.length > 0) continue;
      added.push({ id: flowbackOwnerPendingId(demoWorkId(a.id, w.round)), type: OWNER_ENTITY_TYPE, name: owner.name, names: { [language]: owner.name }, sources: [] });
    }
  }
  return { entities: [...graph.entities, ...added], relations: graph.relations };
}
