// crew 與 GitHub 之間共用的型別（#108 的 `## 決定` 1：轉換函式的輸入是 GitHub 回應的 JSON 形狀，內容由呼叫端提供）。
// 這裡只放形狀，不呼叫 API；連線與權杖只在私人 repo。

/**
 * PR 變更的一個檔案：GitHub REST API `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` 回應的一筆，
 * 只取轉換用得到的欄位。
 */
export interface GitHubPrFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions?: number;
  deletions?: number;
  /** `renamed` 時的原路徑 */
  previous_filename?: string;
}
