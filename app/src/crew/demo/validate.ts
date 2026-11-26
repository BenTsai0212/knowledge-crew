// client/crew/demo.json 的驗證（#29 計畫第 2 節、`## 決定` 的補充）：回傳錯誤清單，空陣列表示通過。
// seed 在匯入前呼叫，有錯就不寫入。check:client 不讀 client/crew/，所以形狀也在這裡檢查。
import type { AccessFile, LanguageCode } from "../../client/types";
import { PRIORITIES, SOURCE_KINDS } from "../db/store";
import { activeAt, canBeGuideline, canDecide, GUIDELINE_DECISIONS, type GuidelineDecision } from "../guidelines/status";
import type { ReturnReason } from "../trust/types";
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
    if (r.guidelineVisibility !== undefined && !levels.has(r.guidelineVisibility as string)) {
      err(`${p}.guidelineVisibility`, "must be a visibility level in access.json");
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

  // 讓放手站得住（crew ADR 0008、#161）：「沒被標成重點」只在做錯了、事後更正只在通過且不早於驗收、
  // 逐條回饋的對象屬於該次交件且同一對象一筆。資料庫的 CHECK 與外鍵也擋，時間（superuser 匯入不套用 RLS）只在這裡檢查
  const correctionIds = new Set<string>();
  const flag = (o: Obj, k: string, path: string) => {
    if (o[k] !== undefined && typeof o[k] !== "boolean") err(`${path}.${k}`, "must be a boolean");
    return o[k] === true;
  };
  const lettingGo = (r: Obj, rp: string, w: Obj, wp: string, verdict: string, decidedAt: number) => {
    if (flag(r, "notInPoints", rp) && !(verdict === "returned" && r.reason === "wrong")) {
      err(`${rp}.notInPoints`, "is only for a return with reason wrong");
    }
    if (r.correction !== undefined) {
      if (verdict !== "accepted") err(`${rp}.correction`, "is only for an accepted review");
      if (!isObj(r.correction)) err(`${rp}.correction`, "must be an object");
      else {
        const c = r.correction;
        const cp = `${rp}.correction`;
        unique(correctionIds, str(c, "id", cp), `${cp}.id`);
        reviewer(c, "correctedBy", cp);
        ordered(decidedAt, time(c, "correctedAt", cp), `${cp}.correctedAt`, "must not be before the review", false);
        if (c.note !== undefined) loc(c.note, `${cp}.note`);
        flag(c, "notInPoints", cp);
      }
    }
    if (r.feedback === undefined) return;
    if (!isObj(r.feedback)) return err(`${rp}.feedback`, "must be an object");
    const fp = `${rp}.feedback`;
    const feedback = r.feedback;
    const optional = (k: string) => (feedback[k] === undefined ? [] : objects(feedback, k, fp));
    const points = new Set<string>();
    for (const [f, p] of optional("points")) {
      const n = f.ordinal;
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > list(w.points).length) err(`${p}.ordinal`, `must be a point of ${wp} (1 to ${list(w.points).length})`);
      unique(points, String(n), `${p}.ordinal`);
      oneOf(f, "result", p, ["ok", "problem"]);
    }
    const followed = new Set(list(w.guidelines).map(String));
    const targets = new Set<string>();
    for (const [f, p] of optional("guidelines")) {
      const g = str(f, "guideline", p);
      if (!followed.has(g)) err(`${p}.guideline`, `must be a guideline followed by ${wp}`);
      unique(targets, g, `${p}.guideline`);
      oneOf(f, "result", p, ["done", "not_done"]);
    }
  };

  // 驗收 id → 員工 × 工作類型與時間（levelDecisions.basisReview、guidelines.sourceReview 用）
  const reviews = new Map<string, { owner: string; at: number; reason: ReturnReason | null; note: Obj | null; decidedBy: string }>();
  // 交件依照的守則（#142）：守則在檔案後面，讀完守則再檢查
  const follows: { path: string; owner: string; submittedAt: string; ids: unknown[] }[] = [];
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
      if (w.guidelines !== undefined) {
        if (!Array.isArray(w.guidelines)) err(`${wp}.guidelines`, "must be an array");
        follows.push({ path: `${wp}.guidelines`, owner: `${a.employee}/${a.workType}`, submittedAt: String(w.submittedAt), ids: list(w.guidelines) });
      }
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
      // 退回的意見（#142）：雙語
      if (r.note !== undefined) loc(r.note, `${rp}.note`);
      last = time(r, "decidedAt", rp);
      ordered(latestCheck, last, `${rp}.decidedAt`, "must be after the work was submitted and checked");
      lettingGo(r, rp, w, wp, verdict, last);
      reviews.set(id, {
        owner: `${a.employee}/${a.workType}`, at: last, reason: verdict === "returned" ? (r.reason as ReturnReason) : null,
        note: isObj(r.note) ? r.note : null, decidedBy: String(r.decidedBy),
      });
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

  // 守則（crew ADR 0007、#142）：資料庫以外鍵守住來源與員工 × 工作類型；時間與決定的順序（superuser 匯入不套用 RLS）在這裡檢查
  const guidelines = new Map<string, { owner: string; decisions: GuidelineDecision[] }>();
  const sameText = (a: unknown, b: Obj | null) => isObj(a) && b !== null && languages.every((lang) => a[lang] === b[lang]);
  for (const [g, p] of objects(demo, "guidelines", "")) {
    const id = str(g, "id", p);
    if (guidelines.has(id)) err(`${p}.id`, `duplicate: ${id}`);
    refs(g, p);
    const owner = `${g.employee}/${g.workType}`;
    const proposer = oneOf(g, "proposer", p, ["human", "employee"]);
    const proposedAt = time(g, "proposedAt", p);
    loc(g.text, `${p}.text`);
    const source = reviews.get(String(g.sourceReview));
    if (!source) err(`${p}.sourceReview`, "must be a review in this file");
    else if (source.owner !== owner) err(`${p}.sourceReview`, "must belong to the same employee and work type");
    else if (!canBeGuideline(source.reason, source.note ? String(source.note[languages[0]] ?? "") : null))
      err(`${p}.sourceReview`, "must be a return with reason wrong or different_approach and a note");
    else if (proposer === "human") {
      // 人提：退回時勾選「記成守則」，提出就是那次退回、文字就是那句意見
      if (proposedAt !== source.at) err(`${p}.proposedAt`, "must equal the source review's decidedAt for a human proposal");
      if (!sameText(g.text, source.note)) err(`${p}.text`, "must equal the source review's note for a human proposal");
    } else ordered(source.at, proposedAt, `${p}.proposedAt`, "must be after the source review");

    const decisions: GuidelineDecision[] = [];
    let previous = proposedAt;
    for (const [d, dp] of objects(g, "decisions", p)) {
      const decision = oneOf(d, "decision", dp, [...GUIDELINE_DECISIONS]);
      reviewer(d, "decidedBy", dp);
      const at = time(d, "decidedAt", dp);
      const first = decisions.length === 0;
      if (first && proposer === "human") {
        if (decision !== "confirm" || at !== proposedAt) err(dp, "must be a confirm at proposedAt for a human proposal");
        if (source && d.decidedBy !== source.decidedBy) err(`${dp}.decidedBy`, "must be the source review's decidedBy for a human proposal");
        if (d.revisedText !== undefined) err(`${dp}.revisedText`, "must be omitted for a human proposal");
      } else ordered(previous, at, `${dp}.decidedAt`, first ? "must be after proposedAt" : "must be after the previous decision");
      if (d.revisedText !== undefined) {
        if (decision !== "confirm") err(`${dp}.revisedText`, "is only for a confirm");
        loc(d.revisedText, `${dp}.revisedText`);
      }
      if (GUIDELINE_DECISIONS.includes(decision as GuidelineDecision["decision"])) {
        if (!canDecide(decisions, decision as GuidelineDecision["decision"])) err(`${dp}.decision`, `cannot ${decision} after ${decisions.map((x) => x.decision).join(", ") || "nothing"}`);
        decisions.push({ decision: decision as GuidelineDecision["decision"], revisedText: null, decidedAt: String(d.decidedAt) });
      }
      if (!Number.isNaN(at)) previous = at;
    }
    if (proposer === "human" && decisions.length === 0) err(`${p}.decisions`, "must start with a confirm for a human proposal");
    guidelines.set(id, { owner, decisions });
  }
  // 交件依照的守則：同一員工 × 工作類型、交件時生效（以前確認、以前沒有收回）、不重複
  for (const f of follows) {
    const seen = new Set<string>();
    f.ids.forEach((v, i) => {
      const at = `${f.path}[${i}]`;
      const g = guidelines.get(String(v));
      unique(seen, String(v), at);
      if (!g) err(at, "must be a guideline in this file");
      else if (g.owner !== f.owner) err(at, "must belong to the same employee and work type");
      else if (!activeAt(g.decisions, f.submittedAt)) err(at, `guideline ${String(v)} must be active when the work was submitted`);
    });
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
