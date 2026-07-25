# Anki 题卡 · 剩余待办清单（2026-07-24）

> 全景待办。分点式形态（v0.3）已有条件 GO，实施尚未开始。对齐 `方案-Anki卡背-分点式-v0.3.md`、`Anki后端进度.md`。

## 0. 当前状态一句话
分点式卡背 **GO**；后端写读闭环 + 前端渲染代码完成（fix 对照 DESIGN.md 复查证实**合规**）；剩前端真机验 + 语料门槛/part3微调等实施 + 部署上线 + 上线前硬门。

## 📌 后续优先级链（产品方 2026-07-24 在 Claude 对话框安排）
1. **先做完 Anki 功能**（当前）。
2. **UX/agent 设定已更新**（所有 agent 定义加读 DESIGN.md/ENGINEERING.md）→ 是否让 ux 重新出方案**待产品方定**：fix 复查证实前端已合规（`22px` 是复用已上线翻面卡、非偏离），"重新出方案修偏离"的必要性已下降；若为优化设计可另做。
3. **继续推进 Anki 功能部署上线**。
4. **Anki + 当前所有任务收尾后** → 读 `交接文档/prompt-给Anki会话-登记交接与待办.md`（26KB，已确认存在），按其中优先级修复问题。

## 🎨 22px 圆角裁决（fix 复查留，待产品方点头）
- 两翻面卡（词组 `FlashCard` + 题卡 `QuestionFlashCard`）都 `rounded-[22px]`、**彼此一致、合规**（DESIGN 要求"复用同类组件 class"）。DESIGN 圆角表无此档 = 表未覆盖"翻面卡"卡型，非题卡违规。
- **建议**：保持 22px（两卡一致）+ 给 DESIGN 圆角表补一档"翻面卡 22px"记录（防以后又被误判偏离）。次（可选）：InlineEdit 输入框 `rounded-[10px]`→12px 搜索框档。

## ✅ 已完成（进度参考）
- 整段探针两轮 → 发现整段分档不稳 → **形态转向分点式**（v0.3：不分档、砍 band 落地、每点一句、part1/2/3 统一点数组）。
- 分点式例句探针 = **有条件 GO**（语料充足 20/20 忠料过、part3 论据好零作文腔）；空点处置定裁 = **留空 + 点数动态**。
- 后端**骨架**（整段时代，多数复用）：数据模型 0030–0035、生成流水线/drain/队列、读写端点、审计修复（拒匿名/换语料限流/事务 RPC/孤儿回收）、product-logic 门槛评估。

---

## 🔵 进行中
-（无）——语料门槛阈值已定 40 字，可进实施。

## 🟠 待产品方拍板（攒着）
1. ✅ **语料门槛阈值 = 40 有效字符**（2026-07-24 拍板；中间档探针证：门槛只"逃灾难区 21→40"、残余编造靠留空，非单调、素材驱动）。
2. **edited_answer 编辑粒度**：逐点编辑 vs 整体编辑（影响 PATCH 端点 + 前端编辑态）。
3. **part3**：每卡几条例句（建议 3 点各 1 句）、立场点配不配例句。
4. **卡背存储**：`generated_answer` 改 JSON 列 vs 新表。
5. **例句生成架构**：一次调用出多点 JSON（建议）vs 逐点多次调用。
6. **忠料硬闸阈值**（金标基线跑出后定，不预设）。

---

## 📋 金标线（AI 质量验证）
- ✅ **part3 专项探针（4 题型）GO + 2 条 prompt 微调已并入并探针验收**：微调（① 比较/权衡类"理由"撑本方立场、让步移"延伸"；② 禁第一人称具体亲历、留 I think/I've noticed 观点观察、举例用 imagine/someone who）已改进三处同源 prompt + 守卫测试；重跑探针 **2 问题都收、作文腔0/假统计0**。〔轻量守卫过；正式深判随人工金标后移优化阶段〕
- 🅿️ **正式人工金标 + 双人盲判 → 暂缓、后移「后续更新优化阶段」**（产品方 2026-07-24）。理由：探针（整段2轮+例句+中间档+part3多题型）已充分验证；title/desc 免审、双防线管住编造、忠料实测守得住 → 当前阶段人工金标边际价值低、~2-2.5 人日不划算，内测先上看真实数据再决定是否建回归金标。
- ✅ **轻量回归守卫（替代，近零成本）**：现有探针 `example-probe`/`threshold-probe`/`part3-probe` = 现成冒烟工具；改 prompt（尤其 part3 2 条微调）时**重跑探针 + 机器预筛**（忠料对语料/作文腔/假统计正则）抓明显退化，不用人工盲判。符合"绿灯≠改对、要能抓错"。
- ⚠️ **red-team 复审分点式时**：回归守卫答复是"探针冒烟 + 双防线 + 机器预筛"、非人工金标——心里有数。

## 🔧 生成实施线（fix-engineer）
- ✅ **生成器 `anki-answer.ts` 重写**（本轮）：整段→逐点 JSON `[{idx,en,noMaterial}]`、去 tier、callLLMJson。**留空出口验证通过**（薄素材"补完整/对比"点 6/6 正确留空、完整语料仅 2/20 偏保守误留、21字编造被 40字门槛挡）。
- ✅ 砍 band（删 target-band.ts、`TIER_SPLIT`/`DEFAULT_TARGET_BAND` @deprecated、drain 去 band/tier）· 类型加 `example?` · prompt 同源守卫重写 · drain 回填存 `JSON.stringify`。
- ✅ **后端读取契约**（0036）：`is_answered` 去 generated_answer 项（避"全留空"假阳 + 根除在途竞态假阳）；`backKind` 点数组语义、与 SQL 解耦。⚠️ **0036 真 PG 未跑**（上线前真库验证）。
- ✅ **part3 例句静态化**：pregen 每点补 example（`PART3_EXAMPLE_SYSTEM` 同源探针 + 守卫）、不变式不动。⚠️ **未对真 DashScope 复验**（maxTokens512 下裸数组稳定性，沿用探针推断）。
- ✅ **前端卡背渲染代码完成**：`QuestionFlashCard`(A 脊柱 part1/2 + B 台阶 part3)、空点态钩子、逐点行内编辑(PATCH `{idx,en}` 走 edited_answer 稀疏覆盖)、a11y(reduced-motion/翻面键盘/44px/ul-li/inert)。tsc+27测试绿。
  - ⚠️ **待产品方真机验**（项目 UI bug 全来自真机）：desc 折叠松紧(`DESC_CLAMP_LINES` 常量)、A/B 排版、空点框、编辑写库往返(**PATCH read-modify-write 未真 PG 验**)、翻面/滑动手感、reduced-motion。
  - ⚠️ **待产品方确认**：① part2 正面 cue **整块显示**（现库题面是平铺文本，启发式拆 bullet 实测 126 条 part2 里 28% 错切/篡改题面，故降级不伪造 bullet；要真 bullet 需数据层给题面加结构化字段、另排）；② reduced-motion 现为"即时切"非 ux 说的"淡入"，真机开减少动效看可接受否。
  - **本批 range 外（记账）**：FlashCard 词组卡同样 2 个 a11y 硬伤(非本批、单排) · ✅ `swap_anki_corpus` 换语料一并清 edited_answer（0037，⚠️ 动 §11 红线、待上线前 red-team+真库验证）· 空点态暂不支持 inline 手填（PATCH 已支持任意 idx、仅 UI 未开口，后续 tweak）。
  - 素材库入口(平级双卡)/筛选/分组 **下批**。
- ✅ **编辑粒度 = 逐点行内**（拍板）· [ ] **成本重估**（~19k/18任务）· 例句**中式词打磨**（`empty-headed walk`）。

### ⚠️ 本轮暴露的风险（待处理）
- ✅ **extractJson 双发兜底（Anki 侧）**：`anki-json.ts` 平衡括号取首个 JSON、本地 `callAnkiLLMJson` 不碰共享 llm.ts；单测 8+3 全过。代价：与 llm.ts transport/retry 一份**受控重复**（记账）。
- [ ] **共享 extractJson 全站评估**：双发贪切是全站潜在问题（ranking/analysis 同用 callLLMJson）→ 单独评估是否根治（`response_format: json_object` / 改 extractJson，需全站回归）。
- [ ] **误留空假阴率**（金标量化）：留空偏保守、有素材却留空（B2 的"和别处不同"点）——留空比编造安全，但精度代价需金标量化"该生成却留空"率。
- [ ] **"讲清重点"句超 22 词**（H6✗，本轮 29/34/23/26）：要不要严守 ≤22（prompt 加压/后处理），red-team/产品方定。
- [ ] `threshold-probe.mjs` 第三份旧 SYSTEM（无留空出口）已与 example-probe 不同源、注释过时 → 同步或标废弃。

## 🚧 语料门槛线（阈值拍板后）
- ✅ **门槛实施完成**（`MIN_CORPUS_CHARS=40`）：文字/语音两入口主拦 + restructure/corpus 服务端兜底、`countEffectiveCorpusChars`（剔标点数汉字+英文词）；独立字数闸不碰 usable；只拦新建（编辑走 updateCorpusCleaned 跳过）；文案 `TOO_SHORT_TOAST` 与 GARBAGE 区分。tsc/单测/api 全绿（连带修 3 个既有测试 fixture）。**全站语料输入改动**（matching 也吃，product-logic 评估过不误伤）。
- ⚠️ **待产品方真机验**：TOO_SHORT toast 可读性（~30字 vs 3.5s 自动消失、两行排版）——必要时缩文案/调 duration。
- 🟡 观察项（非阻塞）：口水话 rawText 过门槛但 cleanedText 薄 → 上线后看要不要在 cleanedText 落库补判一次 · 服务端"上限先于配额"顺序未改（现状省钱目的已达成，若要严格排序需产品方点头）。

## 📝 语料一句话概括线（2026-07-24 实施，全站受益）
- ✅ **链路完成**：整理语料时 AI 顺手多产一句 `summary`（≤20字，"这条语料讲的啥"）→ 存 `corpus.summary`（0038 新列）→ `get_anki_cards` 返 `corpus_summary`（0039）→ `AnkiCard.corpusSummary` → 题卡正面题干+"想想你会怎么答？"下方展示（次级样式 `text-v2-text-muted`，空/旧语料整行不渲染）。不碰 restructure 额度/门槛/usable，只加一个输出字段。**tsc + 本批测试绿；真实语料 6 条探针：概括全部 ≤15字、贴合核心、usable=false 正确返回空串**。
- ⚠️ **两迁移真库未跑**（本地无库）：`0038_corpus_summary`（ADD COLUMN）+ `0039_get_anki_cards_summary`（RPC 增列）——**上线前须在 Supabase SQL Editor 手动执行**（与 0036/0037 同批真库验证时一并跑）。
- [ ] **旧语料 summary 回填脚本**（本批不做，上线前批量补）：给 0038 之前建的、summary 为空的 corpus 逐条跑一次 restructure 的概括产出并回填（仅 `usable`/有 cleaned_text 的行）。回填前前端已按空降级（整行不渲染），不阻塞上线，但补齐后旧卡正面才有概括。可复用 `scripts/anki-probe/` 探针范式 + service_role 批量 update。
- ⚠️ **待产品方真机验**：正面概括那行的样式松紧 / "你的语料 · xxx" 文案前缀是否保留 / 与题干的视觉主次（不能抢题干主角）。

## 🎨 UI / 前端线（ux-reviewer 出方案 → 实施）
- [ ] 分点式卡片呈现设计：点数组渲染、**空点态"这点你的语料还没讲到"**（兼引导补料钩子）、翻面、编辑态。
- [ ] FlashCard 卡背点数组渲染（part1/2/3 一套）。
- [ ] 素材库入口（IA 平级双卡）/ 筛选（全部|已回答 × part1|part2）/ SRS 滑动骨架。
- [ ] a11y（`prefers-reduced-motion`、手势外留按钮+键盘、44px 命中区、aria-label）。

## 🛡️ 审计 / 验证（上线前硬门）
- ✅ **真库 schema 已应用（2026-07-25）**：0030–0039 全部经 `npm run db:push` 应用到**新加坡生产库**（LingoBridge_CN / project jzoxnxgbvshiwctwvrwd / ap-southeast-1 / 端口 5432 session pooler / ref+region 双核对）。连库重跑对象核对**七列全 true**（三张表 + corpus.summary + get_anki_cards 返 corpus_summary + is_answered 含 nullif〔0036 修复保留〕+ swap 清 edited_answer）。
  - ⚠️ **0039 apply 时曾报 `cannot change return type`**（RETURNS TABLE 增列 = 改返回类型，create or replace 不允许）→ 已加 `drop function if exists ... (uuid,text,smallint,text)` 再建（无自定义 GRANT、非 security definer，默认 PUBLIC EXECUTE 重建后自动恢复）；补跑成功。
  - ✅ **写路径验证 = 通过（2026-07-25）**：`scripts/anki-smoke/anki-write-smoke.mjs`（一次性测试用户 `anki-smoke-*@smoke.invalid` + 跑完自清、零 AI 调用）在新加坡生产库跑，**31 项断言全过、0 失败**：懒物化 upsert 幂等 / swap 换语料原子清 generated+edited 不动 SRS / unbind 清 generated+撤 job 保留 SRS / 删 corpus FK set null 无悬挂 / drain 状态机（pending→processing、attempts+1、done 可重入队、**孤儿>15min 重领**、新鲜不误抢）。跑完独立扫零残留。
    - 过程修的三个坑：① auth.users 最小插入列风险 → 改按 information_schema 实际列**动态插入**（跨 GoTrue 自适应）；② 生产库内测白名单触发器（0023）挡非白名单邮箱 → setup 临时插 beta_allowlist、cleanup 按 email sentinel 删回；③ **qa 版 `check()` 把 expected 误传进 pass 位 → 断言空过（30 个 ✓ 未真比对、1 个假阴）**，改成 expected===actual 自算 pass 后才是真验证（验证纪律：盯输出「期望=实际却✗」抓到）。
    - ⚠️ **未覆盖**：drain 的 processing→done 真回填、consent 闸、退避重试（都需真调千问、脚本刻意退化为状态机层）——留内测真实使用观察。
- 🟡 **red-team 复审分点式 v0.3 = 有条件放行（2026-07-25）**：方向站得住（整段分档不稳属实、留空压编造方向对），无"刷分"；但"改善"建立在**无填过判定台账的招牌数字 + 非生产口径的阈值曲线**上，不能结"已验证到位"的案——与"金标后移、内测看真数据"一致。分诊（均已逐条核实、未直接采信）：
  - ✅ **必修·洞1 part3 例句破折号已修**：part3 pregen 复用同源 `cleanEn`（anki-answer.ts 导出、破折号→逗号），不抄第二份 regex。tsc/jest 过。⚠️ 仅代码路径+cleanEn 单测证明；真正确认破折号不入库需一次带 `--commit` 的 part3 pregen 实跑抽验（随换季导入触发）。
  - ✅ **洞2 长度/idx 守卫已加**：validate 折入 `coversAllIdx`（从 `input.focusPoints.length` 取期望点数），短/缺/重/越界 → 触发既有重问；重试耗尽抛错、**短数组不落库**（渲染侧 focusPoints 驱动本就不错位，此守卫是"宁可重生成也别误显空点态"的硬化）。
  - 🟠 **观察·重问文案不对齐（fix 范围外发现）**：`ANKI_JSON_RETRY_INSTRUCTION` 只讲 JSON 合法性/别双发，不提"点数要补齐"→ idx 覆盖不足触发的重问，模型收到的整改要求与真实缺陷不对齐，可能降纠正率。是否为该场景定制 retryInstruction 待定，非阻塞。
  - 🟠 **观察·误留空系统性假阴**：B2「补得更完整」两 run 全留空、其实有对比素材——非随机、是 prompt 结构性偏保守。内测量化"该生成却留空"率。
  - 🟠 **观察·双防线缝未实测**：40+ 字纯口水话/离题没在生产（留空）prompt 下跑过，当前是推断安全非实测安全。
  - 🟠 **观察·part2「讲清重点」超 22 词**：系统性 29/34 词、无后处理截断，铁律名不副实。松口径或加截断，待定。
  - 🟠 **决策数字口径（验证纪律#1）**：定 40 阈值的编造率曲线出自 `threshold-probe` 非生产 prompt（无留空出口、强迫填满→每档高估编造）。40 值本身是廉价粗闸、残余靠留空兜、不至有害，但驱动它的数字口径错——`threshold-probe.mjs` L29 旧 SYSTEM 应标废弃/同源。
  - 🟠 **同源守卫缺口（未登记）**：`part3-probe.mjs` 第三份 prompt 拷贝无 CI 覆盖（当前三份逐字相等、非现存 bug，但将来漂移无人抓）。
  - ✅ **误报（已防住）**：part3 不变式（corpus_id/generated_answer 恒 null，走 question_analyses 不进 anki_cards）· extractJson 双发边界（平衡括号兜住）· 同源漂移测试（example-probe↔生产逐字比对）。
- ✅ **0039 迁移回退修复（2026-07-25，红队外自查）**：`0039_get_anki_cards_summary` 曾拿 0034 当基线、把 0036 的 is_answered 修正覆盖回退（generated_answer 加回 + 丢 nullif 空串处理，主行 + part3 子行两处）。已对齐 0036 + 订正头注（标明基线是 0036、勿回退）。⚠️ 真库未验（随下批 db:push）。
- [ ] **真库验证写路径**（本地无库、仅静态推演）：0035 事务 RPC 原子性、孤儿回收、换/删语料 job 竞态、drain 状态机（consent 撤回不外发）、懒物化 upsert。
- [ ] **drain 孤儿 15 分钟阈值**待部署侧确认 Zeabur 容器超时行为后调。
- 🅿️ **残留在途竞态收口 = 未来优化，不阻塞内测**（2026-07-25 产品方判定）：processing 中（正调千问）换/删语料 → 在途任务写回把旧语料的 generated_answer 盖到已指向新语料的卡上，卡背对不上当前语料。低频（生成几秒窗口内换语料）+ 有界（一张卡背面对不上、不崩不丢不越权、内容仍忠于旧语料、再换/下轮生成即覆盖）+ 非安全问题。修法=drain 领取记 corpus_id/版本号、写回前校验未变（取消令牌）。冒烟已验 15min 孤儿回收兜「卡死 processing」，此窄缝除外。**已记入交接文档 `prompt-给Anki会话-登记交接与待办.md` B14。**
- [ ] 补关键不变式测试（换删语料原子/enqueue 幂等/懒物化/drain 状态机/backKind 一致）。

## 🌐 全站遗留（Anki 收尾后补，产品方已定）
- [ ] **匿名绕内测白名单**（全站安全、非 Anki 独有；Anki 端点已代码层拒匿名）。
- [ ] **16 个既有失败测试**（jose ESM，非 Anki，但 base 已红，内测前宜修）。
- [ ] **`ielts-examiner.md` 并入 main**：现只在 anki 分支 worktree，会话从别的分支启动就加载不了 → 只能靠"general-purpose 读 .md 载入考官角色"的 fallback（**每次靠任务里那句"读 .md"，漏一次就退化成真通用 agent**）。它是通用工具（判英文口语 band，非 Anki 专用）→ 小 PR 并入 main，之后所有分支/会话可按类型 `@ielts-examiner` 直接用，去掉这层隐患。[产品方 2026-07-24：等 Anki 忙完一起并]

---

## 关键路径（依赖顺序）
```
门槛阈值(metric跑中) ─┐
                      ├─→ 拍板批(阈值/存储/编辑粒度/part3) ─→ ┬ 生成器重写(含留空) ┐
part3专项探针 ────────┘                                     ├ 语料门槛实施        ├─→ red-team复审 ─→ 真库验证 ─→ 上线
                                                            ├ 建正式金标+双人盲判  │
                                                            └ ux 卡片呈现→前端    ┘
```
- **能并行**：生成器重写 / 门槛实施 / 金标建设 / 前端设计，拍板后互不阻塞。
- **硬门**：red-team 复审 + 真库验证在上线前，不可跳。
