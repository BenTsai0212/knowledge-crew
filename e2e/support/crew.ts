// knowledge-crew 的 crew 頁籤（#34，ADR 0004 的修訂）：選定的客戶有 crew/demo.json 時，App 在 knowledge-kit 的頁籤之後接上 crew。
// 手機的分頁列與「更多」的斷言以此判斷；沒有 demo.json 的客戶（kestrova-demo、medsupply-demo）維持 knowledge-kit 原本的斷言。
import { existsSync } from "node:fs";
import { clientDir } from "./client";

export const hasCrewDemo = existsSync(`${clientDir}/crew/demo.json`);
