// client/crew/demo.json 的驗證（#29 計畫第 2 節、`## 決定` 的補充）：回傳錯誤清單，空陣列表示通過。
// seed 在匯入前呼叫，有錯就不寫入。check:client 不讀 client/crew/，所以形狀也在這裡檢查。
import type { AccessFile, LanguageCode } from "../../client/types";
import { PRIORITIES, SOURCE_KINDS } from "../db/store";
import { isDateOnly } from "../work/due";
import { parseWorkBody, type WorkSection } from "../work/body";
import type { DemoFile } from "./types";

export interface ValidateOptions {
  /** 雙語欄位必須有的語言 */
  languages?: readonly LanguageCode[];
  /** 所有時間都要早於這個時間（預設是執行當下） */
  now?: Date;
}

const STATUS = ["pass", "fail", "pending"];
const REASON = ["wrong", "different_approach", "process"];
const DECISION = ["relax", "revoke"];
const ORG = "example-org/";

// 交件全文的鍵與工作類型（docs/crew/work-body-format.md）：dev 是程式檔案路徑與 pr/description；其他工作類型不檢查
const NON_CODE = ["reply/", "post/", "kb/"];
const KEY_PREFIX: Record<string, string | null> = { support: "reply/", content: "post/", knowledge: "kb/", dev: null };
function keyFits(workType: string, key: string): boolean {
  if (!Object.hasOwn(KEY_PREFIX, workType)) return true;
  const prefix = KEY_PREFIX[workType];
  return prefix ? key.startsWith(prefix) : !NON_CODE.some((p) => key.startsWith(p));
}
// 兩種語言必須相同的部分：鍵與順序、屬性、各區塊的重點編號（名稱與文字可以不同）
const shape = (s: WorkSection) =>
  [s.key, s.attrs.required, s.attrs.change, s.attrs.points.join(","), [...new Set(s.marks.map((m) => m.point))].sort((a, b) => a - b).join(",")].join(" ");

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function validateDemo(raw: unknown, access: AccessFile, options: ValidateOptions = {}): string[] {
  const errors: string[] = [];
  const err = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const languages = options.languages ?? ["zh-TW", "en"];
  const now = (options.now ?? new Date()).getTime();

  const str = (o: Obj, k: string, path: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v.trim() === "") err(`${path}.${k}`, "must be a non-empty string");
    else if (v.includes("://")) err(`${path}.${k}`, "must not contain a URL");
    return typeof v === "string" ? v : "";
  };
  // 外部編號：可以省略；有值時是非空字串。repo 類必填且是正整數的十進位文字（#57）
  const ref = (o: Obj, k: string, path: string, kind: string | undefined): string | undefined => {
    const v = o[k];
    if (v === undefined) {
      if (kind === "repo") err(`${path}.${k}`, "is required for a repo source");
      return undefined;
    }
    if (typeof v !== "string" || v.trim() === "") err(`${path}.${k}`, "must be a non-empty string");
    else if (kind === "repo" && !/^[1-9][0-9]*$/.test(v)) err(`${path}.${k}`, "must be a positive integer string for a repo source");
    return typeof v === "string" ? v : undefined;
  };
  const oneOf = (o: Obj, k: string, path: string, values: string[]): string => {
    if (!values.includes(o[k] as string)) err(`${path}.${k}`, `must be one of ${values.join(", ")}`);
    return String(o[k]);
  };
  const time = (o: Obj, k: string, path: string): number => {
    const v = o[k];
    const t = typeof v === "string" && /(Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
    if (Number.isNaN(t)) err(`${path}.${k}`, "must be an ISO 8601 time with a time zone");
    else if (t >= now) err(`${path}.${k}`, "must be in the past");
    return t;
  };
  const loc = (v: unknown, path: string) => {
    if (!isObj(v)) return err(path, "must be an object of languages");
    for (const lang of languages) str(v, lang, path);
  };
  // 最上層的陣列 path 為空字串
  const objects = (o: Obj, k: string, path: string, min = 0): [Obj, string][] => {
    const at = path ? `${path}.${k}` : k;
    if (!Array.isArray(o[k]) || (o[k] as unknown[]).length < min) err(at, `must be an array with at least ${min} item(s)`);
    return list(o[k]).flatMap((v, i) => (isObj(v) ? [[v, `${at}[${i}]`] as [Obj, string]] : (err(`${at}[${i}]`, "must be an object"), [])));
  };
  const unique = (seen: Set<string>, value: string, path: string) => {
    if (seen.has(value)) err(path, `duplicate: ${value}`);
    seen.add(value);
  };
  const ordered = (earlier: number, later: number, path: string, message: string, strict = true) => {
    if (!Number.isNaN(earlier) && !Number.isNaN(later) && (strict ? earlier >= later : earlier > later)) err(path, message);
  };

  // 交件全文的格式（#65）：有標頭行的全文要能解析、每個重點都有位置、每個 changes[].path 是區塊的鍵、兩種語言對齊。
  // 沒有標頭行的舊全文（一行摘要）不檢查位置；等待驗收的交件必須是有結構的全文。
  const body = (w: Obj, path: string, workType: string, awaiting: boolean) => {
    const texts = w.body;
    if (!isObj(texts)) return;
    const count = list(w.points).length;
    const parsed = languages.flatMap((lang) => (typeof texts[lang] === "string" ? [[lang, parseWorkBody(texts[lang] as string, count)] as const] : []));
    const structured = parsed.filter(([, p]) => p.structured).length;
    if (structured === 0) {
      if (awaiting && parsed.length > 0) err(`${path}.body`, "must have sections while waiting for review");
      return;
    }
    if (structured < parsed.length) return err(`${path}.body`, "must have sections in every language or in none");
    const paths = list(w.changes).flatMap((c) => (isObj(c) && typeof c.path === "string" ? [c.path] : []));
    const [base, first] = parsed[0];
    for (const [lang, p] of parsed) {
      const at = `${path}.body.${lang}`;
      for (const e of p.errors) err(at, `line ${e.line}: ${e.code}${e.key ? ` (${e.key})` : ""}`);
      p.points.forEach((locations, i) => locations.length === 0 && err(at, `point ${i + 1} must be marked in the body`));
      const keys = new Set(p.sections.map((s) => s.key));
      for (const c of paths) if (!keys.has(c)) err(at, `changes path ${c} must be a section key`);
      for (const s of p.sections) if (s.key !== null && !keyFits(workType, s.key)) err(at, `section ${s.key} does not fit work type ${workType}`);
      if (lang !== base && p.sections.map(shape).join("\n") !== first.sections.map(shape).join("\n"))
        err(at, `sections must match ${base} (keys, order, attributes and points)`);
    }
  };

  if (!isObj(raw)) return ["demo: must be an object"];
  const demo = raw;
  const projects = new Set(access.projects.map((p) => p.id));
  const levels = new Set(access.visibilityLevels.map((l) => l.id));
  const reviewers = new Set(access.roles.filter((r) => r.canReview).map((r) => r.id));
  const reviewer = (o: Obj, k: string, path: string) => {
    if (!reviewers.has(str(o, k, path))) err(`${path}.${k}`, "must be an identity in access.json with canReview");
  };

  // demo 的「今天」與交辦的到期日（#133）：日期不必早於現在（只用來展示）
  const day = (o: Obj, k: string, path: string) => {
    if (o[k] !== undefined && !isDateOnly(o[k])) err(`${path}.${k}`, "must be a date (YYYY-MM-DD)");
  };
  day(demo, "today", "demo");

  // 來源 id → 類型
  const sources = new Map<string, string>();
  const names = new Set<string>();
  for (const [r, p] of objects(demo, "sources", "", 1)) {
    const id = str(r, "id", p);
    if (sources.has(id)) err(`${p}.id`, `duplicate: ${id}`);
    const kind = oneOf(r, "kind", p, [...SOURCE_KINDS]);
    sources.set(id, kind);
    const name = str(r, "name", p);
    unique(names, name, `${p}.name`);
    if (r.label !== undefined) loc(r.label, `${p}.label`);
    if (kind === "repo" && !name.startsWith(ORG)) err(`${p}.name`, `must start with ${ORG} for a repo source`);
    if (!projects.has(str(r, "project", p))) err(`${p}.project`, "must be a project in access.json");
    if (r.knowledgeVisibility !== undefined) {
      if (kind !== "knowledge_base") err(`${p}.knowledgeVisibility`, "is only for a knowledge_base source");
      else if (!levels.has(r.knowledgeVisibility as string)) err(`${p}.knowledgeVisibility`, "must be a visibility level in access.json");
    }
  }
  const employees = new Set<string>();
  for (const [e, p] of objects(demo, "employees", "", 1)) {
    unique(employees, str(e, "id", p), `${p}.id`);
    str(e, "displayName", p);
    loc(e.roleNote, `${p}.roleNote`);
  }
  const workTypes = new Set<string>();
  list(demo.workTypes).forEach((w, i) => {
    if (typeof w !== "string" || w === "") err(`workTypes[${i}]`, "must be a non-empty string");
    else unique(workTypes, w, `workTypes[${i}]`);
  });
  if (workTypes.size === 0) err("workTypes", "must have at least one work type");
  const refs = (o: Obj, p: string) => {
    if (!employees.has(str(o, "employee", p))) err(`${p}.employee`, "must be an employee in this file");
    if (!workTypes.has(str(o, "workType", p))) err(`${p}.workType`, "must be a work type in this file");
  };

  // 驗收 id → 員工 × 工作類型與時間（levelDecisions.basisReview 用）
  const reviews = new Map<string, { owner: string; at: number }>();
  const assignmentIds = new Set<string>();
  const issues = new Set<string>();
  const prs = new Set<string>();
  for (const [a, p] of objects(demo, "assignments", "")) {
    unique(assignmentIds, str(a, "id", p), `${p}.id`);
    const source = str(a, "source", p);
    const kind = sources.get(source);
    if (kind === undefined) err(`${p}.source`, "must be a source in this file");
    // 同一來源內不重複（有值時）
    const issue = ref(a, "externalRef", p, kind);
    if (issue !== undefined) unique(issues, `${source}#${issue}`, `${p}.externalRef`);
    refs(a, p);
    loc(a.title, `${p}.title`);
    reviewer(a, "assignedBy", p);
    day(a, "dueAt", p);
    if (a.priority !== undefined) oneOf(a, "priority", p, [...PRIORITIES]);
    let last = time(a, "assignedAt", p);
    // 沒有交件的交辦（待交件，#134）可以是空陣列
    const works = objects(a, "works", p);
    works.forEach(([w, wp], i) => {
      if (w.round !== i + 1) err(`${wp}.round`, `must be ${i + 1} (rounds start at 1 and increase by 1)`);
      const pr = ref(w, "externalRef", wp, kind);
      if (pr !== undefined) unique(prs, `${source}#${pr}`, `${wp}.externalRef`);
      const submitted = time(w, "submittedAt", wp);
      ordered(last, submitted, `${wp}.submittedAt`, "must be after the assignment or the previous review");
      loc(w.summary, `${wp}.summary`);
      loc(w.body, `${wp}.body`);
      if (!Array.isArray(w.points)) err(`${wp}.points`, "must be an array");
      list(w.points).forEach((pt, j) => loc(pt, `${wp}.points[${j}]`));
      for (const [c, cp] of objects(w, "changes", wp)) {
        str(c, "path", cp);
        loc(c.summary, `${cp}.summary`);
      }
      const isLast = i === works.length - 1;
      body(w, wp, String(a.workType), isLast && !isObj(w.review));
      let latestCheck = submitted;
      for (const [c, cp] of objects(w, "checks", wp)) {
        str(c, "name", cp);
        oneOf(c, "status", cp, STATUS);
        const at = time(c, "checkedAt", cp);
        ordered(submitted, at, `${cp}.checkedAt`, "must not be before the work was submitted", false);
        latestCheck = Math.max(latestCheck, at);
      }
      if (!isObj(w.review)) {
        if (!isLast) err(`${wp}.review`, "only the last round may be waiting for review");
        return;
      }
      const r = w.review;
      const rp = `${wp}.review`;
      const id = str(r, "id", rp);
      if (reviews.has(id)) err(`${rp}.id`, `duplicate: ${id}`);
      reviewer(r, "decidedBy", rp);
      const verdict = oneOf(r, "verdict", rp, ["accepted", "returned"]);
      if (verdict === "returned") oneOf(r, "reason", rp, REASON);
      if (verdict === "accepted" && r.reason !== undefined) err(`${rp}.reason`, "must be omitted when accepted");
      if (verdict === "accepted" && !isLast) err(`${rp}.verdict`, "only the last round may be accepted");
      // 最後一輪是退回：交辦在修正中（#134），下一輪還沒交件
      if (r.note !== undefined) str(r, "note", rp);
      last = time(r, "decidedAt", rp);
      ordered(latestCheck, last, `${rp}.decidedAt`, "must be after the work was submitted and checked");
      reviews.set(id, { owner: `${a.employee}/${a.workType}`, at: last });
    });
  }

  const decisionIds = new Set<string>();
  for (const [d, p] of objects(demo, "levelDecisions", "")) {
    unique(decisionIds, str(d, "id", p), `${p}.id`);
    refs(d, p);
    oneOf(d, "decision", p, DECISION);
    reviewer(d, "decidedBy", p);
    const at = time(d, "decidedAt", p);
    if (d.basisReview === undefined) continue;
    const basis = reviews.get(String(d.basisReview));
    if (!basis) err(`${p}.basisReview`, "must be a review in this file");
    else if (basis.owner !== `${d.employee}/${d.workType}`) err(`${p}.basisReview`, "must belong to the same employee and work type");
    else ordered(basis.at, at, `${p}.decidedAt`, "must be after the basis review");
  }

  for (const [s, p] of objects(demo, "simulations", "")) {
    refs(s, p);
    for (const [r, rp] of objects(s, "replies", p, 1)) {
      loc(r.summary, `${rp}.summary`);
      loc(r.body, `${rp}.body`);
      list(r.points).forEach((pt, j) => loc(pt, `${rp}.points[${j}]`));
      for (const [c, cp] of objects(r, "changes", rp)) {
        str(c, "path", cp);
        loc(c.summary, `${cp}.summary`);
      }
      body(r, rp, String(s.workType), false);
      for (const [c, cp] of objects(r, "checks", rp)) {
        str(c, "name", cp);
        oneOf(c, "status", cp, STATUS);
      }
    }
  }
  return errors;
}

/** validateDemo() 通過時回傳型別化的內容，否則拋出列出全部錯誤的 Error。 */
export function assertDemo(raw: unknown, access: AccessFile, options?: ValidateOptions): DemoFile {
  const errors = validateDemo(raw, access, options);
  if (errors.length > 0) throw new Error(`Invalid crew demo data:\n${errors.join("\n")}`);
  return raw as DemoFile;
}
