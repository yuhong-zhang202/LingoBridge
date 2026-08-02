# 生产部署交接（Zeabur + 腾讯云香港 VPS）

> 更新：2026-07-19（主会话）。**方案：Zeabur 托管 + 腾讯云香港 VPS（约 US$6/月）**——非 Vercel（中国大陆无节点、访问不稳）。香港节点 = 国内用户访问快 + AI 调用离阿里云近 + 免大陆备案；Zeabur 代管部署运维（连 GitHub 自动部署、自动 HTTPS，不用自己配服务器）。
> 背景：产品方 2026-07-19 定「国内速度 + AI 低延迟」为硬门槛；实测确认 Zeabur 现模式=帮你租第三方云 VPS 再托管部署。配套：`docs/未完成工作-上线路线图.md`、台账 093/107。

## 0. 怎么用 + 分工（重要）
- **涉及付款/信用卡的步骤 → 产品方本人做**（§4-A）；**cowork 绝不碰支付信息**。
- **部署技术操作（连仓库/配环境变量/部署/验证）→ cowork 做**（§4-B 起）。
- 密钥一律从本机 `.env.local` 复制，**不写明文**、只进 Zeabur/服务器环境变量、绝不外泄。
- 遇 **⚠️「需产品方拍板/确认」** 停下问。

## 1. 前置状态（已完成，别重做）
- ✅ 生产 Supabase 迁移 `0018–0022` 已跑、`pg_cron` 已开。
- ✅ 代码在 GitHub **`main`**（仓库 `yuhong-zhang202/LingoBridge`，最新提交）。**部署 main。**
- ✅ 本地 `tsc / jest(180) / next build(38页)` 全绿；安全审无 🔴；代码可移植（标准 `next start`）。

## 2. 费用（先算清）
| 项 | 金额 | 说明 |
|---|---|---|
| **VPS 租金** | **约 $6/月** | 腾讯云香港 2vCPU/2GB/40GB SSD/0.5TB 流量，通过 Zeabur 付 |
| **Zeabur 平台费** | ⚠️ **付款前确认** | 确认账户是否在 VPS 租金外另收订阅费——在 Zeabur 计费页看，或问页面里的「Zeabur Agent」。结账页「总计」若=$6 则大概率就这些 |
| **AI 调用费** | 按用量 | 阿里云千问 + 字节豆包，**运营大头、随用户量涨**，跟平台无关，盯 `/dashboard` 看板 |
| Supabase | 大概率 $0 | 内测 200 人免费额度大概率够 |
| 域名 | 可选 | 不买用平台默认域名 |

## 3. ⚠️ 部署前确认
1. **DASHSCOPE 地区**：保持**北京 key + 北京 base_url**（`.env.local` 现值）。⚠️ 铁律：base_url 地区必须与 key 地区一致。
2. **Anthropic key**：主用千问，可**留空不配**。
3. **域名**：默认域名 + 自动 HTTPS 够用；要更稳可选绑自定义域名。

## 4. 部署步骤

### A.（产品方本人做）注册 + 买服务器 + 付款
1. 打开 [zeabur.com](https://zeabur.com)，**用 GitHub 账号登录**。
2. **创建新项目 → 购买新服务器 → 标准 → 供应商选 `Tencent`（腾讯云）**。
3. **选方案**：区域 **亚洲 / 中国 → Hong Kong（香港）**；规格 **2vCPU / 2GB / 40GB SSD（约 $6/月）**（⚠️ 香港节点是国内速度的关键；2核2G 对 200 人内测够用，别买更大的白花钱）。
4. 结账页：**先看清「总计」金额、勾选同意条款 → 设置付款方式 → 付款（你的信用卡）**。⚠️ 这步本人做。付款后 1–3 分钟服务器开通。
   - 注：腾讯云 **7 天内可一次无条件退款**，可先试。

### B.（cowork 做）把 app 部署到这台服务器
5. 服务器就绪后，在 Zeabur 项目里 **Add Service → Git → 授权 GitHub → 选仓库 `yuhong-zhang202/LingoBridge` → 分支 `main`**，部署到刚买的香港服务器。
6. **配好环境变量（§5）再让它完整部署**——缺变量会构建/运行失败。
7. 触发部署，等构建完成（Next 15，约几分钟；本地已验证可 build）。

## 5. 环境变量（cowork 配，值从 `.env.local` 同名项复制）
| 变量名 | 说明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | .env.local 同名 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | .env.local 同名 |
| `SUPABASE_SERVICE_ROLE_KEY` | .env.local 同名 ⚠️服务端密钥，绝不加 `NEXT_PUBLIC_` |
| `DASHSCOPE_API_KEY` | .env.local 同名（北京 key） |
| `DASHSCOPE_BASE_URL` | 北京地址（.env.local 现值），与 key 地区一致 |
| `DOUBAO_ASR_APP_ID` | .env.local 同名 |
| `DOUBAO_ASR_ACCESS_TOKEN` | .env.local 同名 |
| `DOUBAO_ASR_CLUSTER` | .env.local 同名 |
| `ADMIN_EMAILS` | .env.local 同名（费用看板白名单）**不配=没人能进 /dashboard** |
| `RAW_LOG_ENABLED` | 填 **`1`**（生产开原文留证：入库 + RLS + pg_cron 30 天过期） |
| `QA_TRAFFIC_TOKEN` | 自测流量标记 token。**不配 = 匿名态自测流量在生产上标不了 QA**（只剩内部账户名册那一个注册 id 兜底，而匿名试用链路恰恰是要反复自测的一段）。取值只能用 URL 安全字符（字母数字与 `.` `_` `~` `-`）、≤64 位、**首尾不能有空格**（尾随空格会让标记完全静默地失效，2026-08-02 实际踩过） |
| `ANTHROPIC_API_KEY` | 可选，见 §3.2 |
| `ANKI_DRAIN_SECRET` | **Anki 题卡必配**：drain 端点鉴权秘钥。值须 == DB 侧 `_anki_drain_config.drain_secret`（cowork 2026-07-25 已生成并存库，值另发）。**不配则 drain 恒 401、入队的卡片永不生成**。设完须重启实例让 env 生效 |

**别配**：`LLM_RAW_LOG_DIR`（留证已改数据库）、`LLM_DEBUG`（生产已物理禁用）、`RANKING_DIMENSIONAL`（默认关）、`MATCH_SNAPSHOT_ENABLED`（默认开，仅回滚设 `0`）。
**ffmpeg**：VPS 跑完整 Node（`next start`），`ffmpeg-static` 在 `node_modules` 天然可用，无需额外配置。

### 5.1 Anki 题卡 · drain 定时触发（2026-07-25 补）
Anki 卡背生成靠后台队列 + drain 端点，**必须有东西周期性触发 drain，否则卡片永不生成**。已用 **DB 侧 pg_cron + pg_net**（迁移 `0040_anki_drain_cron`，已应用生产库）：每 2 分钟 POST `/api/anki/generate/drain`，秘钥/URL 存 RLS 锁死的 `_anki_drain_config`（cowork 已配）。端点幂等（`FOR UPDATE SKIP LOCKED`），与任何额外触发源并发安全。
- **要 work 只差一步**：在 Zeabur 设 `ANKI_DRAIN_SECRET`（见上表）== DB 侧 secret，然后重启。未设前 cron 每 2 分钟会打到 drain 但被 401 拒（无害空转）。
- **验证**：设完 secret + 重启后，DB 里 `select public.run_anki_drain();` 再 `select status_code from net._http_response order by id desc limit 1;` 应为 **200**（未设时是 401）。或用内测账号绑语料、2 分钟内看卡背生成。
- **回滚**：`select cron.unschedule('anki_drain');`。

## 6. 域名 & HTTPS
Zeabur 给默认域名 + 自动 HTTPS，可直接用。**已上线域名：https://lingobridge.zeabur.app（2026-07-19 生成，已 PROVISIONED）。** 要更稳的国内访问可选绑自定义域名（DNS 解析，香港节点免大陆备案）。海外访问慢见 §10。

## 7. 部署后验证（产品方在生产域名上走）
1. 打开生产域名 → **同意弹窗出现** → 同意 → 能进（验 0022 同意表 + 闸）。
2. **主链路**：讲/输入故事 → 整理 → 匹配 → 题目分析 → 进练习对话（验 AI 全链路通）。
3. **返回上一步**：匹配/分析点返回，前一步数据在、**不重复建语料**。
4. **费用看板**：用 `ADMIN_EMAILS` 邮箱登录 → 进 `/dashboard` 看成本。
5. **✅ 国内速度 + AI 延迟实测**（本方案目的）：用国内网络打开、走一遍 AI 环节，确认打开快 + AI 响应稳。
6. **真机 PWA / standalone**：iPhone Safari 打开生产 https 域名 → 加到主屏 → 全屏打开，验「首屏贴边」是否复现（见 §8）。
7. **AI 调用能通**——失败首查 `DASHSCOPE_BASE_URL` 与 key 地区是否匹配。

## 8. 部署后 backlog（不阻断上线）
- iOS「加到主屏」全屏首屏贴边（真机 + https + Safari 定位修；根因方向 `layout.tsx:54-57` 两层 `h-dvh`）。🟡 仅 standalone 犯。
- 匿名会话 RLS 抽验。
- 其余见 `docs/未完成工作-上线路线图.md`。

## 9. 收尾（产品方本机）
- 删本机旧 `.llm-raw` 目录（含用户原文）。
- 确认 `.env.local` 未被提交 git（已 gitignore）。

## 10. 上线实况补记（2026-07-19，cowork 部署完成）
- **生产域名**：https://lingobridge.zeabur.app （Zeabur 默认域名 + 自动 HTTPS，已 PROVISIONED）。
- **部署目标**：`main`@`c2b2200` → 腾讯云香港 2C2GB（Zeabur 服务 `lingobridge`，运行中 1/1）。构建 nodejs/next.js，标准 `next start`。
- **环境变量**：§5 全部已配（值取自本机 `.env.local`）；`RAW_LOG_ENABLED=1`；按产品方选择 **ANTHROPIC_API_KEY 留空未配**；`DASHSCOPE_BASE_URL` 已核对为北京站（`dashscope.aliyuncs.com/compatible-mode/v1`，与 key 同区）。**未配** `LLM_RAW_LOG_DIR`/`LLM_DEBUG`/`RANKING_DIMENSIONAL`/`MATCH_SNAPSHOT_ENABLED`。

### ⚠️ 构建修复（交接文档原缺，务必记牢）
Zeabur 构建机的 npm 出于安全**默认拦截依赖的安装脚本**（日志：`install scripts blocked ... not covered by allowScripts`），导致 `ffmpeg-static` 的二进制没被下载；而 `src/lib/audio/transcode.ts` 在**模块顶层**就检查该二进制，`/api/transcribe` 在 `next build` 收集页面数据时抛 `FFMPEG_BINARY_MISSING`，构建失败。
- **修复（已生效；配置在 Zeabur、不在仓库）**：服务「环境变量」里加一条——
  `ZBPACK_INSTALL_COMMAND = npm install && node node_modules/ffmpeg-static/install.js`
  装完依赖后显式跑一次 ffmpeg-static 下载脚本，二进制进镜像，构建 + 运行时（语音转写）都可用。
- **可选加固（cowork 已备好，未 push）**：把 `transcode.ts` 的 ffmpeg 检查改为惰性解析（`FFMPEG_PATH` > ffmpeg-static > 系统 ffmpeg），即便脚本再被拦也不会让构建失败。产品方可自行 push 到 `main`。

### 海外访问（如柏林：慢 / 白屏）
实测：服务器 CPU≈0%、内存≈471MB/2GB（都很闲，**非服务器瓶颈**）；慢在**腾讯云香港 ↔ 欧洲的国际线路**（首次访问还叠加了证书/路由初始化）。
- 「国内与海外一样快」用单一香港 origin 做不到（物理距离）。要海外也快：**自定义域名 + 套 Cloudflare（免费）边缘缓存**静态资源（JS/CSS/字体/图片），香港 origin 保留给 SSR + AI 调用；动态/AI 那一下仍就近国内最优。对面向国内的内测，香港方案本身是对的。

---

## 11. ⚠️ 事故记录与防复发（2026-07-20 凌晨）

### 发生了什么
在 Zeabur 控制台点了「**重新上传**」，服务被重新识别为**静态 HTML 网站**，生产全站 404（首页与所有 `/api/*`）。代码一行没坏，纯部署配置事故。

**故障特征（下次一眼认出）：**
- 服务图标由 Next.js 的 `N` 变成**橙色 HTML5 图标**
- Source 由 `yuhong-zhang202/LingoBridge` 变成 `registry-oci.zeabur.cloud/...`
- 首页与 `/api/version` 同时 404（响应体为空）

⇒ **生产异常时先看服务图标和 Source 这两个信号，比翻日志直接。**

### 🔴 硬规矩
- **只点「重新部署」，永远不要点「重新上传」。**
  - 「重新部署」= 从 GitHub 拉最新代码重新构建 ✅
  - 「重新上传」= 更换部署源为上传制品 → 触发重新识别 → 变静态站 ❌
- **改部署配置前先查平台文档确认按钮语义**，不要靠字面猜。

### 已上的防线
`zbpack.json`（仓库根目录，commit `6640958`）显式声明构建方式：
```json
{ "build_command": "npm run build", "start_command": "npm run start" }
```
有它之后 zbpack 不会再把项目猜成静态站。
⚠️ **前提：部署源必须是 Git。** 若 Source 指向 OCI registry，仓库里的 `zbpack.json` 根本不会被读取。

### 恢复方式（本次实际用的）
改回 Git 源无效（会自己变回去），最终**重建 Service** 解决：
1. 先把「环境变量」全部备份（**特别是修 ffmpeg 的 npm allowScripts 那条，见 §10，漏了构建必失败**）
2. 新建 Service → Git → `yuhong-zhang202/LingoBridge` → 分支 `main` → 同一台香港服务器
3. 粘回全部环境变量
4. 域名 `lingobridge.zeabur.app` 从旧服务解绑、绑到新服务
5. **验证全绿后**再删旧服务

### 重建后的验收脚本（零成本，照跑即可）
```bash
BASE=https://lingobridge.zeabur.app
curl -s -o /dev/null -w "首页 %{http_code}\n" "$BASE/"
curl -s "$BASE/api/version"                      # 应 {"version":"vX.Y.Z"}
curl -s -o /dev/null -w "questions %{http_code}\n" "$BASE/api/questions?part=1"
# 需鉴权端点无 token 应全 401（注意 POST/GET 方法要对，见下）
for p in transcribe restructure corpus matching practice practice/polish pronounce events account/delete consent; do
  printf "%-18s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/$p" -H 'Content-Type: application/json' -d '{}')"
done
for p in "analysis?questionId=x&storyId=y" "analysis/phrases?questionId=x&storyId=y&level=6.0" "dashboard"; do
  printf "%-18s %s\n" "${p%%\?*}" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/$p")"
done
```

### ⚠️ 两个验证陷阱（本次真实踩过，台账 120 同型）
1. **`analysis` / `analysis/phrases` / `dashboard` 是 GET-only**。用 POST 打会得 **405 —— 那是路由层拒绝，请求根本没走到鉴权**，却极易被记成「鉴权断言通过/异常」。**方法必须对。**
2. **`grep -c` 数的是行数不是出现次数**。HTML 压缩成一行时恒为 1，会把「双子树正常」误判成「只渲染了一棵」。**要用 `grep -o ... | wc -l`。**

⇒ 同一条老教训：**每条断言都要问「它失败时，能否与『被更早一层拒绝』区分开」。**

---

## 12. 🔴 内测期间禁止扩容（2026-07-20）

**豆包「录音文件识别大模型-极速版」并发限额 = 5**（增购 ¥400，产品方决定不买、改用服务端排队）。

排队实现是**进程内信号量**（`src/lib/concurrency-gate.ts`），并发上限 4、队列 20、超时 15s。第二轮压测已验证：8 并发全部成功、零 `45000292`。

⚠️ **但这个闸门只在单进程内有效。** 一旦把 Zeabur 实例数从 1/1 扩到 2：

```
实例 A：自己数到 4，不再放行  ✓
实例 B：自己数到 4，不再放行  ✓
豆包实际收到：4 + 4 = 8  ✗ 超过上限 5
```

**两个实例各自守规矩，加起来照样超限**，用户会看到「转写失败」。

⇒ **内测期间保持 1/1，不要扩容。** 确需扩容时，必须先把信号量改成跨实例共享（Redis 之类），否则扩容 = 立刻复现并发超限故障。
