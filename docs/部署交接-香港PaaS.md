# 香港 PaaS 部署交接（给操作电脑的 Claude / cowork 照做）

> 更新：2026-07-19（主会话）。**方案：香港节点 PaaS（推荐 Zeabur 香港区），替代 Vercel**——国内访问快 + 免大陆备案 + 类 Vercel 零运维。
> 背景：产品方 2026-07-19 定「国内用户访问速度是硬门槛」→ 不用 Vercel（中国大陆无节点、`*.vercel.app` 国内访问不稳）→ 改用**有香港节点、体验类 Vercel** 的 PaaS。配套：`docs/未完成工作-上线路线图.md`、台账 093/107。

## 0. 这份文档怎么用
- **你（操作电脑的 Claude）和产品方一起**照步骤操作。
- **密钥一律从本机 `.env.local` 读取/复制**——本文档**不写明文密钥**，密钥**只进 PaaS 的环境变量**，绝不写进任何文件、聊天记录或外部。
- 遇 **⚠️「需产品方拍板」** 处，**停下问产品方**。

## 1. 前置状态（已完成，别重做）
- ✅ 生产 Supabase 迁移 `0018–0022` 已跑、`pg_cron` 已开。
- ✅ 代码已在 GitHub **`main` 分支**（仓库 `yuhong-zhang202/LingoBridge`，最新 `c309d32`）。**部署 main。**
- ✅ 本地 `tsc / jest(180) / next build(38页)` 全绿；安全审无 🔴。
- ✅ 代码可移植：标准 Next.js `next start`，**没绑死任何平台**，换到 PaaS 不用改代码。

## 2. ⚠️ 部署前，产品方 / cowork 要先定/核实的
1. **用哪个香港 PaaS**：**推荐 Zeabur**（有香港 region、Next.js 支持好、类 Vercel 的 GitHub 自动部署 + 自动 HTTPS）。**cowork 先实地核实**：该平台当前①有香港/亚洲 region ②支持 Next.js（App Router）③能连 GitHub 自动部署。若 Zeabur 不合适，找**同类替代**（核心要求不变：**香港/亚洲节点 + 类 Vercel 体验 + 支持 Next.js standalone**）。
2. **DASHSCOPE 地区**：保持**北京 key + 北京 base_url**（`https://dashscope.aliyuncs.com/compatible-mode/v1`，即 `.env.local` 现值）。PaaS 在香港，调阿里云北京没问题。⚠️**铁律：base_url 地区必须与 key 地区一致**。
3. **Anthropic key**：项目主用千问，Anthropic 是备用分支、内测大概率不调，可**留空不配**；要配从 `.env.local` 复制。
4. **域名**：PaaS 给的默认域名（如 `*.zeabur.app`）+ 自动 HTTPS **可直接用**。要更稳的国内访问可**选**绑自定义域名（走 DNS 解析，香港节点免大陆备案）。

## 3. 部署步骤（以 Zeabur 为例，其它同类 PaaS 流程类似）
1. 打开 [zeabur.com](https://zeabur.com)，**用产品方的 GitHub 账号登录**。
2. **New Project → 选香港（Hong Kong）region**（⚠️**关键，国内速度全靠选对这个节点**）。
3. **Add Service → Git → 授权 GitHub → 选仓库 `yuhong-zhang202/LingoBridge` → 分支 `main`**。
4. 平台自动识别 **Next.js**，开始构建（约几分钟；本地已验证可 build）。
5. **先配好环境变量（§4）再让它完整部署**——缺变量会构建/运行失败。

## 4. 环境变量（PaaS 的 Variables / Environment 面板）
逐个添加，**值从本机 `.env.local` 同名项复制**：

| 变量名 | 来源 / 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | .env.local 同名 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | .env.local 同名 |
| `SUPABASE_SERVICE_ROLE_KEY` | .env.local 同名 ⚠️服务端密钥，绝不加 `NEXT_PUBLIC_` |
| `DASHSCOPE_API_KEY` | .env.local 同名（北京 key） |
| `DASHSCOPE_BASE_URL` | 北京地址（.env.local 现值），与 key 地区一致 |
| `DOUBAO_ASR_APP_ID` | .env.local 同名 |
| `DOUBAO_ASR_ACCESS_TOKEN` | .env.local 同名 |
| `DOUBAO_ASR_CLUSTER` | .env.local 同名（一并配） |
| `ADMIN_EMAILS` | .env.local 同名（费用看板白名单，逗号分隔）**不配=没人能进 /dashboard** |
| `RAW_LOG_ENABLED` | 填 **`1`**（生产开原文留证：入库 + 表 RLS + pg_cron 30 天过期，产品方拍定内测开） |
| `ANTHROPIC_API_KEY` | **可选**，见 §2.3 |
| `NODE_ENV` | 一般 PaaS 生产自动 = `production`（无需手配；确认平台已按生产模式跑，否则 PWA/留证的生产判定会错） |

**明确不要配**：
- `LLM_RAW_LOG_DIR`（留证已改数据库，配了无效）
- `LLM_DEBUG`（生产已物理禁用，别设）
- `RANKING_DIMENSIONAL`（默认关，别设）
- `MATCH_SNAPSHOT_ENABLED`（默认开，别设；仅回滚匹配存档时设 `0`）

**关于 ffmpeg**：PaaS 跑完整 Node（`next start` / 容器），`ffmpeg-static` 在 `node_modules` 里天然可用，**不依赖 Vercel 那套 `outputFileTracing`**——无需额外配置（`next.config.mjs` 里现有的相关配置在非 Vercel 平台无害）。

## 5. 部署 & 域名
1. 环境变量存好 → 触发部署（push 或平台的 Redeploy）。构建应绿。
2. 部署成功后拿到默认域名（`*.zeabur.app` 等）+ 自动 HTTPS。
3. （可选）绑自定义域名：平台 Domains → 加域名 → 按提示配 DNS。

## 6. 部署后验证（产品方在生产域名上走）
1. 打开生产域名 → **同意弹窗出现** → 同意 → 能进（验 0022 同意表 + 闸生效）。
2. **主链路**：讲/输入故事 → 整理 → 匹配 → 题目分析 → 进练习对话（验 AI 全链路通）。
3. **返回上一步**：匹配/分析点返回，前一步数据还在、**不重复建语料**。
4. **费用看板**：用 `ADMIN_EMAILS` 里的邮箱登录 → 进 `/dashboard` 看成本。
5. **✅ 国内速度实测**（本方案的重点）：用**国内网络**打开生产域名，确认打开速度确实改善（这是选香港 PaaS 的目的）。
6. **真机 PWA / standalone**：**iPhone Safari** 打开生产 https 域名 → 加到主屏 → 全屏打开，验之前那个「首屏贴边」在真 https + Safari 下是否复现（见 §7）。
7. **AI 调用能通**（转写/匹配/分析出结果）——失败首查 `DASHSCOPE_BASE_URL` 与 key 地区是否匹配。

## 7. 部署后 backlog（不阻断上线）
- **iOS「加到主屏」全屏首屏贴边**：需真机 + 真 https + Safari 加主屏定位修（根因方向=iOS standalone 首帧 viewport/dvh，`layout.tsx:54-57` 两层 `h-dvh`）。🟡 仅 standalone 犯，浏览器直接打开正常。
- 匿名会话 RLS 抽验（两个匿名会话验 corpusId 不越权）。
- 其余技术债见 `docs/未完成工作-上线路线图.md`。

## 8. 收尾（产品方本机）
- 删本机旧 `.llm-raw` 目录（含用户原文，清掉）。
- **确认 `.env.local` 未被提交 git**（已 gitignore）。

---
> Vercel 方案（旧 `docs/vercel-部署交接.md`）已废弃——中国大陆访问是硬伤，改用本香港 PaaS 方案。
