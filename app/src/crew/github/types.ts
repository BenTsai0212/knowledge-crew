// 平台與 GitHub 之間共用的型別（#108 第 1 階段的公開 repo 部分）。
// 狀態讀回、人工待辦的解析等其他 Issue 也在這裡加自己的型別；兩邊都新增時，後合併的一方更新到 main。

/** 要寫進 GitHub 的 Issue：標題、本文與建立時一起加上的標籤（不含派工標籤）。 */
export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

/** 貼出前檢查的問題種類（畫面依種類從翻譯檔取訊息）。 */
export type PostFindingKind =
  /** 不是放行清單中的 email */
  | "email"
  /** /Users/<名稱>、/home/<名稱> */
  | "personalPath"
  /** 禁用名稱清單中的名稱 */
  | "deniedName"
  /** 呼叫的一方沒有傳入禁用名稱清單（或清單是空的）：一律拒絕 */
  | "deniedNamesMissing"
  /** 留言以 agent 視為人的決定或修正要求的控制標題開頭 */
  | "controlHeading";

/** 一個問題：只有位置與種類，不含命中的文字。 */
export interface PostFinding {
  /** 問題所在的欄位 */
  field: "title" | "body";
  /** 行號（從 1 起算）；與整份內容有關的問題（例如沒有清單）是 0 */
  line: number;
  kind: PostFindingKind;
}

export interface PostCheckResult {
  ok: boolean;
  findings: PostFinding[];
}
