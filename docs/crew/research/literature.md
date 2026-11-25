# 文獻與產業整理

整理於 2026-11-24～25。回答一個問題：當人的工作從「自己做」變成「交辦給 AI、再驗收」，現有研究與產品知道什麼、還不知道什麼。

學術來源以摘要、論文頁或可信的整理為依據，沒有逐篇讀完全文；引用數字前請再確認原文。對本專案的意義見[研究主張](README.md)。

## 1. 人的決策

- **過度依賴是最常見的結果**：人會接受 AI 的錯誤建議而不自己查證（[Vasconcelos et al. 2023](https://arxiv.org/abs/2212.06823)）。醫療領域的回顧中，錯誤的決策支援讓錯誤判斷的風險提高約 26%（[Goddard et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751)）。
- **解釋不等於解藥**：加上 AI 的解釋往往不減少、甚至增加過度依賴（[Bansal et al. 2021](https://arxiv.org/abs/2006.14779)）；解釋只有在「能比重做更快驗證 AI 對不對」時才有幫助（[Fok & Weld 2023](https://arxiv.org/abs/2305.07722)）。
- **「強迫想一下」有效但不討喜**：先自己判斷、再看 AI 答案這類做法能減少過度依賴，但使用者滿意度較低（[Buçinca et al. 2021](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml)）。
- **信任要校準，不是越多越好**：好的信任與自動化的實際能力相符，而且針對具體功能（[Lee & See 2004](https://pubmed.ncbi.nlm.nih.gov/15151155/)）；過度依賴與不用都是失敗（[Parasuraman & Riley 1997](https://journals.sagepub.com/doi/10.1518/001872097778543886)）。
- **產業現況：驗證變成瓶頸**：Sonar 2026 年的開發者調查中，96% 不完全相信 AI 寫的程式，但只有 48% 每次都檢查；38% 認為審查 AI 的程式比審查同事的更費力（[Sonar](https://www.sonarsource.com/blog/ai-coding-trust-gap/)）。

## 2. 人與 AI 的協作互動

- **自動化不是單一的高低**：工作可以拆成收集資訊、分析、決定、執行四步，每一步有不同的自動化程度（Parasuraman, Sheridan & Wickens 2000，A Model for Types and Levels of Human Interaction with Automation）。高度的人為掌控與高度自動化可以同時成立（[Shneiderman 2020](https://arxiv.org/abs/2002.04087)）。
- **委派要可以設定**：設計問題是「交什麼出去、由誰授權、保留哪些人的參與」（[What to Delegate, What to Preserve](https://arxiv.org/abs/2611.09730)）。
- **混合主導的老問題仍在**：代理人常見的失敗是猜錯目標、沒權衡自動行動的成本、時機不對、不讓使用者修正結果（Horvitz 1999，Principles of Mixed-Initiative User Interfaces）。
- **人機互動準則**：18 條準則分成初次接觸、互動中、系統出錯時、長期使用四組（[Amershi et al. 2019](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/)）。
- **監看代理人的新問題**：看起來合理的流程會讓人更放心地過度依賴；新介面讓人更快找到錯誤，也帶來更多錯誤的信心（[Overseeing Agents Without Constant Oversight](https://arxiv.org/abs/2602.16844)）。
- **產業的共識模式**：代理人完成允許的工作並留下紀錄，人審查全部或抽樣；以覆寫與升級的紀錄證明監督有在運作（[Telerik 的整理](https://www.telerik.com/blogs/understanding-human-agent-collaboration-patterns)）。

## 3. 人的回饋感

- **效率升、動機降**：超過 3,500 人的四項研究中，與生成式 AI 合作提高了產出品質，但轉回獨自工作時，內在動機平均降 11%、無聊感平均升 20%（Scientific Reports 2025，Human-generative AI collaboration undermines intrinsic motivation）。
- **被動使用最傷**：直接複製 AI 結果的人，擁有感與意義感下降；用 AI 發展自己想法的人，分數與不用 AI 相近（[Penn State 的報導](https://www.psu.edu/news/research/story/passive-ai-use-work-increases-feelings-work-meaninglessness-study-finds)）。
- **保留決定權不等於保留擁有感**：各組的決策自主感相近，但用 AI 的組別擁有感都較低（[Designing AI Workflows around Professional Task Structure](https://arxiv.org/abs/2609.16482)）。
- **進展是最強的動力**：影響工作心情最大的單一事件，是在有意義的工作上有進展（[Amabile & Kramer，The Progress Principle](https://www.td.org/content/td-magazine/recognizing-meaningful-progress)）。
- **監看的反論**：自動化留給人的是監看與出事時接手，而長時間監看累人，接手所需的技能又因缺少練習而退化（Bainbridge 1983，Ironies of Automation；[整理](https://blog.acolyer.org/2020/01/08/ironies-of-automation/)）。

## 4. 人與 AI 共寫的知識庫

- **AI 標籤帶來全面懷疑**：標為 AI 產生的內容，不論真假、人寫或 AI 寫，都被認為比較不準（[Altay & Gilardi 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11443540)）。
- **標籤不幫人判斷對錯**：AI 標籤幾乎不影響人對錯誤訊息的判斷，只幫人分辨是不是 AI 產生的（[JMIR 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11892328)）。
- **逐步的過程紀錄是產業標準的方向**：Content Credentials 記錄內容的每一步，每一步都可以標明是否用了 AI（[C2PA 實作指南](https://c2pa.org/a-new-implementation-guide-for-content-credentials/)）。
- **企業知識工具的做法**：共同賣點是每個答案附引用、只用有權限的來源（[Glean](https://www.glean.com/perspectives/top-ai-assistants-for-accurate-source-citations)、[Notion](https://www.notion.com/en-US/product/enterprise-search)）；較少處理來源本身是 AI 寫的情況。

## 5. 信任機制與有效監督

- **放手在現實中是隱性漂移**：實際使用紀錄顯示，全自動核准的比例隨使用經驗明顯上升（[Anthropic，Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy)）。
- **信任掉得快、回得慢**：一次失敗對信任的衝擊大於一次成功帶來的增加（[Yang et al. 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC10374998)）。
- **自主分級談的是另一個維度**：依使用者角色分成操作者、協作者、顧問、核准者、觀察者五級（[Feng et al. 2025](https://arxiv.org/abs/2506.12469)）。這類框架談「代理人何時要問人」；本專案變動的是「人事後檢查多深」。
- **「有效監督」還沒有檢驗標準**：法規要求有效的人為監督，但什麼算有效仍難以操作與測試（[Langer et al.](https://arxiv.org/abs/2504.03300)）。
- **責任可能不公平地落在人身上**：人只有有限的控制，出事時卻承擔責任（[Elish 2019，Moral Crumple Zones](https://just-tech.ssrc.org/citation/moral-crumple-zones-cautionary-tales-in-human-robot-interaction/)）。
- **對 AI 越有信心，越少批判思考**：對自己越有信心的人則相反（Lee et al. 2025，The Impact of Generative AI on Critical Thinking）。交辦 AI 的負擔被比喻為主管交辦團隊（[Tankelevitch et al. 2024](https://arxiv.org/abs/2312.10893)）。
- **核准會變成習慣**：臨床警示的略過率很高，略過已成為習慣動作（[Ancker et al. 2017](https://doi.org/10.1186/s12911-017-0430-8)）。
- **審查的價值不只是抓錯**：程式碼審查更常帶來知識轉移與對現況的掌握（[Sadowski et al.，Modern Code Review at Google](https://research.google/pubs/modern-code-review-a-case-study-at-google/)）。放手越多，人知道的越少。
- **回饋變規則已有先例**：程式代理人把被接受的審查意見累積成持久的規則（[Accumulated Behavioral Rules](https://arxiv.org/abs/2607.13091)、[Gemini Code Assist 的記憶](https://cloud.google.com/blog/products/ai-machine-learning/memory-for-ai-code-reviews-using-gemini-code-assist)）；客服領域以抽查加上修正指引來改善 AI（[Intercom](https://www.intercom.com/learning-center/qa-system-ai-human-conversations)）。還空著的是人的確認流程、守則的來歷，以及非程式的知識工作。
