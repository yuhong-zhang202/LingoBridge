# Vercel 生产部署交接（给操作电脑的 Claude / cowork 照做）

> 更新：2026-07-19（主会话）。配套：`docs/未完成工作-上线路线图.md`、台账 `scripts/eval/loop/DISCUSSION_LOG.md` 093/107。

## 0. 这份文档怎么用
- **你（操作电脑的 Claude）和产品方一起**，照下面步骤在浏览器里点 Vercel 后台完成部署。
- **涉及密钥的值，一律从本机 `.env.local` 读取/复制**——本文档**不写任何明文密钥**，密钥也**只能进 Vercel 环境变量**，绝不写进任何文档、聊天记录或外部。
- 遇到 **⚠️** 标注的"需产品方拍板"处，**停下来问产品方**，不要替他猜。

## 1. 前置状态（已完成，别重做）
- ✅ **生产 Supabase 迁移 0018–0022 已全部跑**、**pg_cron 扩展已开**（产品方 2026-07-18 确认）。
- ✅ **代码已 push GitHub**：仓库 `yuhong-zhang202/LingoBridge`，分支 `feat/ranking-three-tier`，最新 commit `fb9b04f`。
- ✅ 本地 `tsc / jest(180) / next build(38页)` 全绿；安全审无 🔴。
- ⚠️ **部署铁律**：数据库迁移必须先于代码上线——**已满足**（0022 同意表若没跑，同意闸会 fail-closed 挡死所有用户）。

## 2. ⚠️ 部署前，产品方必须先定的三件事（否则会卡）
1. **部署哪个分支**：生产惯例用 `main`。**建议**先把 `feat/ranking-three-tier` 合并到 `main`（GitHub 开 PR → merge），再让 Vercel 部署 `main`。也可临时直接部署 `feat/ranking-three-tier`（不推荐长期）。
2. **香港节点 / AI 出口**：环境变量 `DASHSCOPE_BASE_URL` 到底填哪个——
   - 北京：`https://dashscope.aliyuncs.com/compatible-mode/v1`
   - 国际/新加坡：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（代码默认值）
   - 或产品方**自建的香港中转地址**
   
   以及 **Vercel Functions 的 Region** 要不要设香港（`hkg1`，Project Settings → Functions）。**只有产品方知道"香港节点"具体是什么，部署时提供。**
   ⚠️ **铁律：`DASHSCOPE_BASE_URL` 的地区必须和 `DASHSCOPE_API_KEY` 的地区一致**（北京 key 配国际 url 会调用失败，反之亦然）。
3. **Anthropic key 要不要配**：项目主用千问（DashScope），Anthropic 只是代码里的备用分支，**内测大概率不调用**。可先**留空不配**（不影响主流程）；要配就从 `.env.local` 复制 `ANTHROPIC_API_KEY`。

## 3. 创建 / 连接 Vercel 项目（已有项目则跳过）
1. 登录 [vercel.com](https://vercel.com)（**产品方账号**）。
2. **Add New → Project → Import Git Repository →** 选 `yuhong-zhang202/LingoBridge`。
3. Framework Preset 会自动识别 **Next.js**；Root Directory = 仓库根（默认）；Build / Output 用默认（无 `vercel.json`，全自动）。
4. **Production Branch** 设为第 2 步定的分支。
5. **先别点 Deploy**——先配好下面的环境变量，再部署（否则首次构建会因缺变量失败）。

## 4. 环境变量（Project → Settings → Environment Variables）
逐个添加，Environment 勾 **Production**（可一并勾 Preview）。**值从本机 `.env.local` 同名项复制**：

| 变量名 | 来源 / 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | .env.local 同名（生产 Supabase 项目 URL） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | .env.local 同名 |
| `SUPABASE_SERVICE_ROLE_KEY` | .env.local 同名 ⚠️**服务端密钥，绝不加 `NEXT_PUBLIC_`** |
| `DASHSCOPE_API_KEY` | .env.local 同名 ⚠️地区必须与下面 base_url 一致 |
| `DASHSCOPE_BASE_URL` | ⚠️见 §2.2，产品方定的地址 |
| `DOUBAO_ASR_APP_ID` | .env.local 同名（豆包 ASR 语音转写） |
| `DOUBAO_ASR_ACCESS_TOKEN` | .env.local 同名 |
| `DOUBAO_ASR_CLUSTER` | .env.local 同名（.env.local 里有此项，一并配） |
| `ADMIN_EMAILS` | .env.local 同名（费用看板管理员白名单，逗号分隔）**不配=没人能进 /dashboard** |
| `RAW_LOG_ENABLED` | 填 **`1`**（生产开原文留证：入库 + 表 RLS + pg_cron 30 天过期，产品方 2026-07 拍定内测开） |
| `ANTHROPIC_API_KEY` | **可选**，见 §2.3 |

**明确不要配**（配了要么无效、要么危险）：
- `LLM_RAW_LOG_DIR` —— 留证已改数据库，不再用文件目录，配了无效。
- `LLM_DEBUG` —— 生产已在代码层物理禁用（会泄露用户故事碎片），别设。
- `RANKING_DIMENSIONAL` —— 加权打分实验开关，默认关，别设。
- `MATCH_SNAPSHOT_ENABLED` —— 匹配存档，默认开，**别设**；仅当匹配存档出问题需一键回滚时才设 `0`。

## 5. 部署
1. 环境变量存好后 → **Deployments → Redeploy**（或 push 一次触发）。
2. 等构建完成（Next 15，约几分钟）。**构建应绿**（本地已全绿）。
3. 若构建报"缺环境变量 / undefined" → 回 §4 补齐再 Redeploy。

## 6. 部署后验证（产品方在生产 URL 上走一遍）
1. 打开生产 URL → **同意弹窗出现** → 点"同意并开始" → 能进（验 0022 同意表 + 闸生效）。
2. **主链路**：讲/输入一个故事 → 整理 → 开始匹配 → 点题目看分析 → 进练习对话（验 AI 全链路通）。
3. **返回上一步**：匹配/分析页点"返回上一步"，前一步数据还在、**不重复建语料**。
4. **费用看板**：用 `ADMIN_EMAILS` 里的邮箱登录 → 能进 `/dashboard` 看到成本数据。
5. **真机 PWA / standalone**：**iPhone Safari** 打开生产 https 网址 → 分享 → 加到主屏 → 从图标全屏打开，看之前那个"首屏贴边、顶栏被状态栏盖"在**真 https + Safari** 下是否复现（见 §7）。
6. **AI 调用能通**（转写/匹配/分析都出结果）——若失败，**首查 `DASHSCOPE_BASE_URL` 与 `DASHSCOPE_API_KEY` 地区是否匹配**。

## 7. 部署后 backlog（不阻断上线，部署后再处理）
- **iOS "加到主屏"全屏首屏贴边**：需真机 + 真 https + Safari 加主屏才能定位修（局域网 http/Chrome 不代表生产）。根因方向=iOS standalone webview 首帧 viewport/dvh 未正确应用（`layout.tsx:54-57` 两层 `h-dvh`）。🟡 仅 standalone 模式犯，浏览器直接打开正常。
- 匿名会话 RLS 抽验（两个匿名会话验 corpusId 不越权）。
- 其余技术债见 `docs/未完成工作-上线路线图.md`。

## 8. 一次性收尾（产品方本机）
- 删本机旧 `.llm-raw` 目录（留证已改数据库，旧文件目录含用户原文，清掉）。
- **不要把 `.env.local` 提交 git**（已 gitignore，确认无误）。
