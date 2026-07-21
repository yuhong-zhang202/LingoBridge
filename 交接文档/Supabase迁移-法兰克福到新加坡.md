# Supabase 迁移 · 法兰克福 → 新加坡（含"以后 SQL 自动 run"）

> **为什么**：app 在香港、用户在国内、AI 在国内，唯独 Supabase 在**法兰克福**。每次注册/查询/加载都要香港↔法兰克福往返 ~250–300ms，多次串联 = 几十秒卡顿。迁到**新加坡（`ap-southeast-1`，离香港/国内最近的 Supabase 区，往返 ~30–50ms）**后，DB 往返快 5–8×，注册/跳转/加载降到 1–2 秒级。
>
> **匹配"几十秒"不在此列**——那是 AI 多次调用的固有耗时，迁库砍不掉（另议）。
>
> **能自动到什么程度**：数据/auth/记账全脚本化（你跑几条命令）；**新建项目、改 Zeabur 环境变量**只能你手动点控制台。**Claude 跑不了**——没有你的 Supabase/Zeabur/DB 凭据，所有命令都得你带自己的密钥执行。
>
> **强烈建议现在做**：内测未铺开，用户和数据极少（auth 用户可能就几个），现在迁最省事；上量后风险和工作量翻倍。

---

## 前置：本机装工具（一次）

```bash
# Postgres 客户端（pg_dump/psql）——迁数据用
brew install postgresql@16     # 或已装的任意 pg_dump/psql ≥15

# 迁移器依赖（本仓库）
npm install                    # 已在 package.json 加了 pg；装一下
```
Supabase CLI 用 `npx supabase` 即可，无需全局安装。

---

## 迁移步骤

### 步骤 1（手动）新建新加坡项目
1. Supabase Dashboard → New Project → **Region 选 Southeast Asia (Singapore)**。
2. 记下新项目的：`Project URL`、`anon key`、`service_role key`（Settings → API）。
3. 记下**两个数据库连接串**（Settings → Database → Connection string）：
   - 旧项目（法兰克福）的 —— 记为 `SRC_DB_URL`
   - 新项目（新加坡）的 —— 记为 `DST_DB_URL`
   连接串形如 `postgresql://postgres.[ref]:[你的DB密码]@aws-0-[region].pooler.supabase.com:5432/postgres`（用 **Session pooler / 5432**，别用 6543 事务池跑 DDL）。

### 步骤 2（脚本）导出旧库 → 恢复到新库（含 schema + 数据 + auth 用户）
用 Supabase 官方 CLI 的 dump（正确处理系统 schema 排除）：

```bash
# 导出：角色 / 结构 / 数据 三份（$SRC_DB_URL = 法兰克福连接串）
npx supabase db dump --db-url "$SRC_DB_URL" -f roles.sql --role-only
npx supabase db dump --db-url "$SRC_DB_URL" -f schema.sql
npx supabase db dump --db-url "$SRC_DB_URL" -f data.sql --data-only --use-copy

# 恢复到新加坡（$DST_DB_URL = 新加坡连接串）
psql "$DST_DB_URL" -f roles.sql     # 角色/权限（有报"已存在"可忽略）
psql "$DST_DB_URL" -f schema.sql    # 全部表/函数/RLS/触发器
psql "$DST_DB_URL" -f data.sql      # 全部数据 + auth.users（用户+bcrypt密码一起过来）
```
- **auth 用户**：`schema.sql`+`data.sql` 已含 `auth` schema，用户和加密密码一并迁移，**用户用原密码就能登录**。
- 迁移后 **JWT secret 不同 → 旧登录态失效**，用户需重新登录一次（内测几个人无所谓）。
- 这三份 dump 文件含数据，**跑完即删、别提交**（`rm roles.sql schema.sql data.sql`）。

### 步骤 3（脚本）给迁移记账表打标记
新库是 dump/restore 来的、schema 已齐，**不要**再重跑 0001–0027（会重复插数据）。把它们标记为"已应用"，之后只跑新增：

```bash
# 先把 .env.local 的 SUPABASE_DB_URL 临时设为新加坡 DST_DB_URL
npm run db:push -- --mark-all-applied     # 只记账、不执行
npm run db:push -- --dry-run              # 应显示"无待应用"
```

### 步骤 4（脚本/手动）迁 Storage 文件（avatars 头像桶）
`data.sql` 只搬了 `storage.objects` 元数据，**桶里的实际图片文件要单独搬**：
- 内测阶段头像可能就几张甚至没有 → 最简单：让用户重新传一次，或忽略。
- 要批量搬：用 `rclone` 配两个 Supabase S3 endpoint 对拷，或写个脚本走 storage API 下载→上传（需要我做的话说一声）。
- 别忘在新项目确认 `avatars` 桶存在且为 public（`0008_avatars_bucket.sql` 已在 schema 里，restore 应已建）。

### 步骤 5（手动核对）pg_cron
迁移 0018–0022 + pg_cron 的定时任务：
```bash
psql "$DST_DB_URL" -c "select * from cron.job;"   # 确认定时任务在
```
- 若 `cron` 扩展未启用：新项目 Dashboard → Database → Extensions 开 `pg_cron`，再重跑相关迁移段（或手动 `select cron.schedule(...)`，对照 0018–0022）。

### 步骤 5.5（手动·关键）项目级控制台配置 —— **`db:push` 迁不了的唯一一类，务必手动对齐**

> ⚠️ **真实事故（2026-07-21）**：迁完切了 Zeabur 后，线上点「同意并开始」报「保存同意记录失败」。根因是**新项目默认没开「匿名登录」**——应用靠匿名登录建 user，没 user 就写不了同意记录。`db:push` 只迁数据库 schema/数据/RLS，**Auth / URL / SMTP 这些项目级设置全在控制台、迁不过来**，新建项目是默认值，必须逐项手动对齐旧项目。**下面清单从代码实际用到的能力反推，做完再进步骤 6。**

**Authentication → Sign In / Providers**
- [ ] **Anonymous sign-ins：开** 🔴 —— 代码 16 处 `signInAnonymously`（匿名试用 + 匿名同意）。不开则同意/试用全坏。
- [ ] **Email provider：开** 🔴 —— 用了 `signInWithPassword` + `signUp`。
- [ ] **Allow new users to sign up（允许注册）：开** 🔴 —— 用了 `signUp`；内测准入靠应用内 `beta_allowlist` 挡，不靠此开关。
- [ ] **Confirm email（邮箱确认）：关** 🔴 —— 本项目**不配 SMTP**（国内收不到邮件），注册流程无「查收邮件确认」门、预期注册即登录。新项目默认**开着**此项，不关则所有注册卡在「等确认」登不进。
- [ ] OAuth（Google 等）/ Phone OTP / Magic Link：**保持关** —— 代码未用。

**Authentication → URL Configuration**
- [ ] **Site URL：`https://lingobridge.zeabur.app`** 🔴 —— 新项目默认 localhost，错则邮件链接指向错地方。
- [ ] **Redirect URLs：加 `https://lingobridge.zeabur.app/**` 一条即可**（本地开发再加 `http://localhost:3000/**`）🔴 —— 白名单只管回跳目标；本项目唯一回跳是 `resetPasswordForEmail` 的 `<域名>/reset-password`，一条通配足够，**不用逐页加**。

**Authentication → SMTP**
- [ ] **不配自定义 SMTP**（与旧项目一致）—— 国内考量。密码重置改用 `scripts/gen-reset-link.mjs`（service_role `admin.generateLink` 手动生成 recovery 链接，走微信等渠道发），不依赖邮件。

**Database → Extensions（多为迁移自带，核对即可）**
- [ ] `pg_cron`、`pgcrypto`、`uuid-ossp` 已启用（`gen_random_uuid` / 定时 GC 依赖）——步骤 5 已核 pg_cron。

**Storage**
- [ ] `avatars` 桶存在且 `public=true`（迁移 0008 带，随 restore 已建）——桶内**文件**不随迁移过来，内测者重传即可。

### 步骤 6（手动）切 Zeabur 环境变量 → 指向新加坡
Zeabur 项目 → 环境变量，把这些**从法兰克福换成新加坡新项目的值**：
- `NEXT_PUBLIC_SUPABASE_URL` → 新 Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → 新 anon key
- `SUPABASE_SERVICE_ROLE_KEY` → 新 service_role key
- （DASHSCOPE / 豆包等 AI key 不动）

然后**重新部署 / 重启**服务。

### 步骤 7（验证）让国内朋友再测
- 打开首页、注册、跳转、进题库——应从"几十秒"降到"1–2 秒"。
- 输入语料匹配——仍会有几秒（AI 固有），但不再叠加跨欧 DB 往返。
- 最好再抓一张首页 Network 瀑布图确认 `/api/*` 的时间掉下来了。

### 步骤 8（回滚 / 收尾）
- **旧法兰克福项目先别删**，留 3–7 天作回滚点。切回只需把 Zeabur 环境变量改回旧值 + 重部署。
- 新库稳定运行几天、确认无数据/登录问题后，再删旧项目。

---

## 你要做什么（速查清单）
- [ ] 手动：新建新加坡项目、抄 URL/keys/两个连接串（步骤 1）
- [ ] 命令：dump 旧库 → restore 新库（步骤 2），跑完删 dump 文件
- [ ] 命令：`npm run db:push -- --mark-all-applied`（步骤 3）
- [ ] 手动/命令：迁头像文件（步骤 4，可能无）
- [ ] 命令：核对 pg_cron（步骤 5）
- [ ] **手动：项目级控制台配置（步骤 5.5）—— 匿名登录/邮箱确认关/Site URL/Redirect URL，`db:push` 迁不了、最易漏、已出过事故**
- [ ] 手动：Zeabur 换环境变量 + 重部署（步骤 6）
- [ ] 验证：国内实测（步骤 7）——**首页点「同意并开始」能保存成功（验匿名登录）+ 注册/登录走通（验邮箱确认已关）**
- [ ] 收尾：留旧项目做回滚，稳定后删（步骤 8）

Claude 能陪你逐步跑、看报错、写头像迁移脚本；但**建项目、连接串、改 Zeabur** 这三处必须你亲手（涉密钥/控制台）。

---

## 以后：SQL 自动 run（永别 SQL Editor）

已在本仓库加好 `scripts/db-push.mjs` + `npm run db:push`（直连 Postgres，DDL 可正常执行）：

- **加新迁移**：在 `supabase/migrations/` 放个 `0028_xxx.sql` → `npm run db:push` → 自动跑没跑过的、记账。`--dry-run` 先看要跑啥。
- **`.env.local` 配** `SUPABASE_DB_URL=<新加坡 Session pooler 连接串>`（`.env.example` 已加占位）。
- **可选·全自动**：挂一个 GitHub Action，push 到 main 时自动 `npm run db:push`（把 `SUPABASE_DB_URL` 设为仓库 secret）——合并即上库，真正零手动。要的话我给你写这个 workflow。

> 注意：`db:push` 是给**增量迁移**用的；本次"整库搬家"用步骤 2 的 dump/restore（保留 auth 用户），两者分工不同。
