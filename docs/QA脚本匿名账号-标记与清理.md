# QA / 开发脚本建的匿名账号 —— 标记与清理

> 建立日期：2026-08-03　　涉及代码：`scripts/lib/qa-anon-auth.mjs`、`scripts/cleanup-qa-anon.mjs`

## 1. 问题

`scripts/` 下的稳定性、侦察脚本每跑一次就往**生产库**真建一个匿名账号（`signInAnonymously()`），
且这些账号的 `raw_user_meta_data` 是 `{}` —— 与真实匿名用户**一模一样，事后无法区分**。
后果是「匿名用户数 / 留存漏斗 / 转化率」这些看板口径里混着我们自己造的号。

这与「`ensureSession` 并发重复建号」（`c1d077b`）是两个独立污染源：那个是**一个人被建成多个号**，
这个是**脚本造号混进真实用户**。

## 2. 方案：打标记 + 可清理（不是「不建号」）

大多数脚本**必须**建真的匿名账号，改用 `service_role` 会让测试失去意义：

| 脚本 | 为什么必须真建匿名号 |
|---|---|
| `scripts/inspect-db-auth.mjs` | 目的就是「用 authenticated 角色实测能读到什么」验 RLS 实效；service_role 绕过 RLS |
| `scripts/stability/l1-e2e.mjs`（consent / quota-anon 两段） | 测的就是同意闸与匿名额度本身 |
| `scripts/stability/probe-anon-quota-free.mjs` | 同上，测匿名 restructure 额度 |
| `scripts/stability/probe-allowlist-{errmsg,control,trigger}.mjs` | 测「匿名号 → updateUser 绑邮箱」这条真实用户路径上的白名单闸 |

所以做法是**建号时打标记**：把脚本名与时间写进 `user_metadata`。

```jsonc
// auth.users.raw_user_meta_data
{ "lb_qa_script": "l1-e2e:quota-anon", "lb_qa_at": "2026-08-03T01:23:45.678Z" }
```

- 键名常量的**唯一真源**是 `scripts/lib/qa-anon-auth.mjs` 的 `QA_SCRIPT_META_KEY` / `QA_AT_META_KEY`，
  清理脚本与日后的分析 SQL 都从这里取，别在别处写字面量。
- 建号统一走 `signInAnonymouslyTagged(client, '<脚本名>')`；
  `scripts/stability/_lib.mjs` 的 `makeAuth().signInAnonymously('<脚本名>')`（裸 fetch GoTrue）走同一套标记。
  **脚本名必填**，缺了直接抛错 —— 没有脚本名的标记等于没标记。
- 同一脚本内多处建号要带段名区分，如 `l1-e2e:consent` / `l1-e2e:quota-anon`。

### 例外：`scripts/retranslate-part1-zh.ts` 改为完全不建号

该脚本是数据重翻译脚本，实际**只读 `questions` 表、不写库**（产出 SQL 文件给人执行），
匿名登录只是为了拿一个 authenticated 角色。已改为 `service_role` 直连只读，**一个账号都不建**。
副作用：需要的环境变量从 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 变成 `SUPABASE_SERVICE_ROLE_KEY`。

## 3. 怎么清理

```bash
# 默认 dry-run：只列不删（安全，随时可跑）
node --env-file=.env.local scripts/cleanup-qa-anon.mjs

# 只看某个脚本建的号
node --env-file=.env.local scripts/cleanup-qa-anon.mjs --script probe-allowlist-errmsg

# 真删（唯一会删数据的开关）
node --env-file=.env.local scripts/cleanup-qa-anon.mjs --yes
```

判据（三条同时满足才删）：`user_metadata.lb_qa_script` 有值 **且** `is_anonymous = true` **且** 未绑邮箱/手机。

安全设计：

1. **默认 dry-run**，不加 `--yes` 一次删除请求都不发。
2. **只认标记，绝不推断**。不用「匿名 + 无业务数据」判定 —— 真实流失用户正是长这样，
   按推断删就把漏斗要研究的那批人删了。
3. **删前逐个复核**：对列表里的每个 uid 重新 `getUserById` 确认标记仍在；
   再查一次 `corpus`，只要有语料就跳过并报出来（脚本账号不该有语料，有就说明判断有误）。

清理范围（**刻意不照搬** `src/app/api/account/delete/route.ts`）：

| 表 | 处理 | 理由 |
|---|---|---|
| `profiles`、`anon_restructure_counts` | 不显式删 | 有 `on delete cascade` 外键链，`admin.deleteUser` 会带走 |
| `consent_records` | 显式删 | migration 0022 **故意不建外键**，cascade 碰不到；脚本跑同意闸会留行 |
| `llm_raw_logs` / `asr_raw_logs` | 显式删 | 同样无外键；留的是脚本自造测试文本，会污染离线复盘取样 |
| `api_usage_logs` | **刻意保留** | 这是真花掉的钱，删或置 null 会让成本账目失真；且不涉及自然人 |
| 头像 storage / `beta_allowlist` / `revoked_users` | 不做 | 脚本账号不传头像、不绑邮箱；进程早已结束，无 token 吊销必要 |

## 4. ⚠️ 历史账号无法回溯识别（诚实说明）

标记从 **2026-08-03** 起才开始写。**在此之前所有脚本建的匿名账号，`raw_user_meta_data` 全是 `{}`，
与真实匿名用户在数据上完全无法区分**。

所以：

- `cleanup-qa-anon.mjs` **查不到、也不会去猜**这些历史账号 —— 宁可留脏数据，不可误删真实用户。
- **跑一遍清理 ≠ 库里就干净了。** 历史污染是既成事实，只能在解读旧数据时人工打折扣
  （脚本每跑一次留 1～2 个号，量级可按稳定性脚本的历史运行次数估）。
- 想缩小历史污染的影响，只有靠**时间**：新数据是干净的，做留存/漏斗时把统计窗口起点定在 2026-08-03 之后。

## 5. 新增脚本时的规矩

在 `scripts/` 下**不要再裸调 `signInAnonymously()`**。要建匿名号就走 `signInAnonymouslyTagged()`
并传自己的脚本名；只是要写权限、不验 RLS 语义的脚本，用 `service_role`、别建号。
