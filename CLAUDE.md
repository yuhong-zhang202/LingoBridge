# LingoBridge — 协作约定

## 语言（硬性）
- **始终用中文回复。**
- **所有产出一律中文**：文档、台账、memory、代码注释、commit message、PR 描述、eval 报告。
- 例外仅限技术标识符本身（代码符号、观察点 code 如 REL_06、英文真题题面、库名/命令）。

## 部署（Zeabur + 腾讯云香港 VPS）
- **生产：Zeabur 托管 + 腾讯云香港 VPS（约 $6/月）**——非 Vercel（大陆无节点、访问不稳）。香港节点 = 国内访问快 + AI 调用近阿里云 + 免大陆备案；Zeabur 代管运维。
- 部署 **`main`** 分支。步骤 + 环境变量清单见 **`docs/部署交接-香港PaaS.md`**（付款产品方本人做，部署技术操作 cowork 做）。
- DASHSCOPE 保持**北京 key + 北京 base_url**（地区须一致）；生产 Supabase 迁移 `0018–0022` + `pg_cron` 已就绪。
- **运营成本大头是 AI 调用费**（阿里云千问 + 字节豆包，按用量），跟部署平台无关，盯 `/dashboard` 看板。

## 派活选角色（硬性）
**派 subagent 前先问「这个改动会触及什么」，按下表选；不要按「任务像什么」选。**

| 改动触及 | 派谁 |
|---|---|
| **AI 判断力**（prompt / 模型选型 / 金标 / 评估指标 / 阈值） | `diagnostician` 归因+提案 · `metric-designer` 设计指标 · `red-team` 审计「改善是真是刷分」 · `pipeline-auditor` 先查输入 · `baseline-engineer` 落地已拍板的红线 |
| UI / 交互 / 视觉 | `ux-reviewer` 出方案 → 产品方确认 → `fix-engineer` 实施 |
| 产品逻辑自洽 / 状态与边界 | `product-logic-reviewer` |
| 安全 / 隐私 / 越权 / 合规 | `security-auditor` |
| 架构健康 / 技术债 | `code-health-auditor` |
| 压测 / 端到端 / 异常 / 耐久 | `qa-engineer`（不许改产品代码） |
| 纯实施（方案已定） | `fix-engineer` |
| 台账 | `recorder`（唯一能写 `DISCUSSION_LOG.md`） |
| 以上都不沾 | `general-purpose` / `Explore` |

**为什么是硬性**：通用 agent 不知道项目历史实测。2026-07-20 评估「重排低分题省略 reason」时派了 `general-purpose`，方案看着合理；换 `diagnostician` 后立刻翻出台账 044（同类改动 high 档退 14pp、已回退）与 046（**「同一个模型、同一个故事、同一道题，换了输出结构就换了立场」**）。**通用 agent 会给出一个没有历史包袱的、看起来很对的错误答案。**

**拿不准时先问产品方「有没有更合适的 agent」，别直接派通用的。**
AI 环节改动走既定链路：`diagnostician` 提案 → 产品方拍板 → `fix-engineer` 实施 → 跑金标回归 → `red-team` 审计。
