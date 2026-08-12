/**
 * @module   api/account/delete
 * @desc     【仅服务端】GDPR 被遗忘权 — 用 Authorization 头里的用户 access token 反查 user.id，
 *           再用 service_role 删该用户的所有业务数据并 admin.deleteUser；客户端不得直接传 user_id。
 * @author   LingoBridge
 * @created  2026-06-17
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { logErr } from '@/lib/log'
import { getSupabaseServer } from '@/lib/supabase-server'
import { requireUser, authErrorResponse } from '@/lib/api-auth'
import { deleteUserRawLogs } from '@/lib/raw-log'
import { writeConsentAuditTrace } from '@/lib/consent-audit'

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // 1) 鉴权：复用 requireUser 从 Authorization 头反查 user.id（缺/无效 token 抛 ApiAuthError(401)）
    const { userId } = await requireUser(req)
    const admin = getSupabaseServer()

    // 1.2) 令牌吊销：删号后该用户手里的 access token 靠本地验签仍会通过（最长活到 exp）。先插吊销名单，
    //      使其 ≤60s 内失效（api-auth 验签后查 revoked_users）。幂等；失败不阻断删号（token 仍受 exp 限），仅告警。
    {
      const { error: revErr } = await admin
        .from('revoked_users')
        .upsert({ user_id: userId, reason: 'account_deleted' }, { onConflict: 'user_id', ignoreDuplicates: true })
      if (revErr) logErr('[account/delete] 写吊销名单失败（不阻断删号）', revErr)
    }

    // 1.5) 取邮箱 —— 【必须在 admin.deleteUser 之前】，账号删掉后再也取不到。
    // 两处下游依赖它：① consent_audit 的加盐邮箱哈希；② beta_allowlist 按邮箱删残留行。
    // 取不到用户（已被删/id 失效）不算错：当作匿名/无邮箱处理，后续两步各自跳过，不阻断删号。
    const { data: authUser, error: getUserErr } = await admin.auth.admin.getUserById(userId)
    if (getUserErr) throw getUserErr
    const email = authUser?.user?.email ?? null

    // 1.6) 同意审计痕迹（【硬前置，失败必须中止删号】）：写一条不含可识别信息的痕迹到 consent_audit
    //（migration 0025），保住「该用户确曾看过并同意过某版披露」的举证能力 —— 下面第 2 步会把
    // consent_records 原始记录硬删掉，那是我们向监管自证的唯一凭据。
    // ⚠️ 顺序不可反：必须【先写痕迹、成功后再删记录】，反了会在写失败时既没证据也没记录。
    // ⚠️ 本步也是 CONSENT_HASH_SALT 的预检 —— 未配置即在此抛错，此刻【尚未删除任何数据】，
    //    账号与全部数据完好无损，用户重试即可；报响而非静默跳过，是为了让漏配环境变量立刻暴露，
    //    而不是等监管来问才发现凭据一直没在写（见 lib/consent-audit.ts 与 .env.example）。
    await writeConsentAuditTrace(userId, email)

    // 2) 删业务数据（service_role 绕 RLS）。删除策略是「防御性显式删 + cascade 兜底」的混合，
    //    并非对所有表都不信 cascade：枚举到的业务表逐张显式删（不单赌线上 FK 是否 on delete cascade），
    //    而未枚举、仅挂 auth.users/profiles 外键的表则靠最后 admin.deleteUser 的 cascade 兜底清除。
    // 外键顺序：先删 corpus_point_links（按该用户的 corpus.id 反查，本表无 user_id 列），
    //   再删各 user_id 表，再显式删 profiles；最后 admin.deleteUser 删 auth.users（并 cascade 兜底残余）。
    const { data: corpusRows, error: cListErr } = await admin
      .from('corpus')
      .select('id')
      .eq('user_id', userId)
    if (cListErr) throw cListErr
    const corpusIds = (corpusRows ?? []).map((r) => (r as { id: string }).id)
    if (corpusIds.length > 0) {
      const { error } = await admin.from('corpus_point_links').delete().in('corpus_id', corpusIds)
      if (error) throw error
    }

    // practice_sessions 显式删（防御性）：schema drift 期间线上真实 FK 是否 on delete cascade 不确定，显式删一行最稳（与 corpus/phrase_cards/feedback 同理）。
    // corpus_match_snapshots（0019）对 corpus 有 on delete cascade，但这批表按「防御性显式删」处理（不单赌 cascade），须排在 corpus 之前先删；
    // flow_events（0018）埋点，无原文但 GDPR 完整性须删，无跨表依赖、位置随意。
    // consent_records（0022）同意记录：删号=撤回同意（决策5），本表硬删（决策4）；user_id 无外键、无跨表依赖，位置随意。
    // anki_generation_jobs（0031）/ anki_cards（0030）：两表本靠 profiles 的 on delete cascade 兜底，但按同款「防御性
    //   显式删、不单赌 cascade」纳入枚举防未来 FK 漂移。顺序：先删 jobs（其 card_id → anki_cards on delete cascade）再删 cards。
    // review_events（0046）闪卡复习流水：与 flow_events 同为无原文的行为埋点，同口径随删号清除。
    //   ⚠️ 这张表【曾经两头落空】——建表时照 0022 的「不信 FK cascade」纪律没挂外键，却漏了纪律的后半截
    //   （加进本清单），于是注销用户的 uuid 会永久留库、再无机制会清（审计 2026-08-06 P1-5，实测 142 行/11 人）。
    //   0061 已补 user_id → auth.users on delete cascade 作【第二道闸】，但这里的显式删仍是第一道：
    //   与本清单其余各表同款「不单赌线上 FK」纪律，且错误不吞（同 api_usage_logs 那段的理由——
    //   残留的是指向已注销自然人的库内标识符，不接受静默失败）。无跨表依赖，位置随意。
    for (const table of ['corpus_match_snapshots', 'flow_events', 'review_events', 'consent_records', 'anki_generation_jobs', 'anki_cards', 'corpus', 'phrase_cards', 'feedback', 'practice_sessions'] as const) {
      const { error } = await admin.from(table).delete().eq('user_id', userId)
      if (error) throw error
    }
    const { error: profErr } = await admin.from('profiles').delete().eq('id', userId)
    if (profErr) throw profErr

    // 头像 storage 清理（best-effort）：avatars 桶公开读，删号后残留文件凭旧 URL 仍可被任何人访问，属被遗忘权缺口。
    // 单独 try/catch、只 logErr 不中断——账号与数据库数据的删除是核心，头像清理是补充，不能因它失败导致删不掉号。
    // ⚠️ 必须【分页取完】：list() 不传 limit 时 Supabase 默认只返回 100 条，而 lib/db/avatar.ts 的路径是
    //    {user_id}/{时间戳}.{ext} —— 每次上传都是新文件、旧头像从不清理。换过 100 次以上头像的用户，
    //    第 101 张起会永久留在【公开读】的桶里，凭 URL 任何人可访问，且路径首段就是 user_id、内容是人脸照片。
    try {
      const PAGE = 100
      const paths: string[] = []
      for (let offset = 0; ; offset += PAGE) {
        const { data: page, error: listErr } = await admin.storage
          .from('avatars')
          .list(userId, { limit: PAGE, offset })
        if (listErr) throw listErr
        // 头像按 {user_id}/xxx.ext 存放（见 migration 0008），拼完整路径后整批删除
        const batch = page ?? []
        paths.push(...batch.map((o) => `${userId}/${o.name}`))
        if (batch.length < PAGE) break // 不足一页 = 已到末尾（取空亦然）
      }
      if (paths.length > 0) {
        const { error: rmErr } = await admin.storage.from('avatars').remove(paths)
        if (rmErr) throw rmErr
      }
    } catch (e) {
      logErr('[account/delete] 头像清理失败（不中断删号）', e)
    }

    // 原始留证彻底清理（【硬前置，失败必须中止删号】）：llm_raw_logs / asr_raw_logs 含用户原文
    // （prompt / 转写），被遗忘权须一并删。故意【不带 retained 过滤】= 连金标保留批也删（产品方 2026-07-17 拍定）。
    // 与头像/费用日志的 best-effort 纪律【刻意不同】：原文删不掉却把账号删了 = 留下无主的原文孤儿
    //（无重试、无审计、再也关联不到用户），是被遗忘权的实质失守。故这里【不吞异常】——抛出即由外层 catch
    // 映射为 500，用户可重试；且本步排在下面 admin.deleteUser 之前，失败即阻断后续，绝不留原文孤儿。
    // ⚠️ 传 corpusIds：两表 user_id 允许 null（ALS 取不到时写 null），只按 user_id 删会漏掉 user_id=null 但
    //    corpus_id 指向该用户语料的原文行——故补按 corpus_id 删一遍（corpusIds 在上面删 corpus 前已查得，仍在内存里）。
    await deleteUserRawLogs(userId, corpusIds)

    // 费用日志去标识化（best-effort，非硬删）：api_usage_logs（0021 起带 user_id/corpus_id）是聚合用量/成本、
    // 不含用户原文——被遗忘权靠断掉个人链接即满足，而非删行。硬删会让离职用户的成本从总额蒸发、账目失真。
    // 故只把 user_id / corpus_id 置 null，保留 is_anonymous / cost / 其余字段供成本统计。
    // 这与上面 raw_logs 的「彻底删」口径不同是有意的：原文该彻底删，聚合成本该去标识化保留。
    //
    // ⚠️【硬前置，失败必须中止删号】——刻意【不吞异常】，与上面 deleteUserRawLogs 同款纪律，
    // 而与头像清理的 best-effort 【不同】。理由：本步失败若被静默放过，user_id 会原样留在库里、
    // 账号却已被删 → 留下一个【指向已注销自然人的 uuid】，且再无任何机制会清它（无重试、无补偿、
    // 无审计）。这个代价明显高于「让用户重试一次删号」。头像清理可以 best-effort，是因为它失败时
    // 残留的是文件、事后仍可按 user_id 前缀人工清；这里残留的是删不掉也找不回的库内标识符。
    const { error: anonErr } = await admin
      .from('api_usage_logs')
      .update({ user_id: null, corpus_id: null })
      .eq('user_id', userId)
    if (anonErr) throw anonErr

    // 内测白名单残留清理（【硬前置，失败必须中止删号】）：public.beta_allowlist（0023）以 email 为主键、
    // 无 user_id、无外键，故 cascade 与上面按 user_id 的批量删【都碰不到它】——不显式删，注销者的邮箱
    // 会永久留在生产库，而邮箱是直接标识符，对删除权义务而言是确认的残留。
    // 比对口径对齐 0023 触发器的 lower(btrim(email))：名单由人工在 Table Editor 录入，入库大小写
    // 未必规范，故【必须大小写不敏感】地删，否则录成 Foo@X.com 的行会被 eq('foo@x.com') 漏掉。
    // 用 ilike 而非 eq 来做这件事，代价是要转义通配符：`_` 是合法邮箱字符，不转义会误伤同名不同字的
    // 别人那一行（ilike 里 `_` 匹配任意单字符）。反斜杠是 Postgres LIKE 的默认转义符。
    // 该表 RLS 为「启用且零策略」，仅 service_role 可写 —— 本路由用的正是 service_role。
    // 同样不吞异常：残留的是邮箱本身，性质同上，不接受静默失败。
    const normalizedEmail = (email ?? '').trim().toLowerCase()
    if (normalizedEmail) {
      const literal = normalizedEmail.replace(/[\\%_]/g, (c) => `\\${c}`)
      const { error: allowErr } = await admin.from('beta_allowlist').delete().ilike('email', literal)
      if (allowErr) throw allowErr
    }

    // 3) 删账号本体
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) throw delErr

    return NextResponse.json({ ok: true })
  } catch (e) {
    // 鉴权错误（requireUser 抛的 401）映射为标准响应；非鉴权错误保留原有 500 分支
    const authRes = authErrorResponse(e)
    if (authRes) return authRes
    logErr('[account/delete]', e)
    return NextResponse.json({ error: '删除失败，请稍后再试' }, { status: 500 })
  }
}
