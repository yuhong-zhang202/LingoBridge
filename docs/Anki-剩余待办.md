# Anki 题卡 · 剩余待办清单（2026-07-24）

> 全景待办。分点式形态（v0.3）已有条件 GO，实施尚未开始。对齐 `方案-Anki卡背-分点式-v0.3.md`、`Anki后端进度.md`。

## 0. 当前状态一句话
分点式卡背（标题+中文解释+短例句）**探针有条件 GO**；正在**定语料门槛阈值**（metric-designer 跑中）；**实施（生成器重写/门槛/前端）尚未开始**。

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
- ✅ **part3 专项探针（4 题型）过关 GO**：24 句零作文腔/假统计/中式/编造。**2 条 prompt 微调待并入 part3 例句 prompt**：① 比较/权衡类"理由"格须论证本方立场、让步移"延伸"格（P-compare 立场乡村却理由替城市说话、自相矛盾）；② 禁"第一人称具体亲历轶事"（`I used to spend two hours on subway` 写死人设不可移植）、留"第一人称观点/观察"（I believe/I've noticed），优先 hypothetical(imagine…)/泛化(someone who…)。〔考官自评：比较类那条松紧可由产品方定〕
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
  - **本批 range 外（记账）**：FlashCard 词组卡同样 2 个 a11y 硬伤(非本批、单排) · `swap_anki_corpus` 清 generated 但不清 edited_answer（旧逐点覆盖会盖新语料生成，交 red-team 评估）· 空点态暂不支持 inline 手填（PATCH 已支持任意 idx、仅 UI 未开口，后续 tweak）。
  - 素材库入口(平级双卡)/筛选/分组 **下批**。
- ✅ **编辑粒度 = 逐点行内**（拍板）· [ ] **成本重估**（~19k/18任务）· 例句**中式词打磨**（`empty-headed walk`）。

### ⚠️ 本轮暴露的风险（待处理）
- ✅ **extractJson 双发兜底（Anki 侧）**：`anki-json.ts` 平衡括号取首个 JSON、本地 `callAnkiLLMJson` 不碰共享 llm.ts；单测 8+3 全过。代价：与 llm.ts transport/retry 一份**受控重复**（记账）。
- [ ] **共享 extractJson 全站评估**：双发贪切是全站潜在问题（ranking/analysis 同用 callLLMJson）→ 单独评估是否根治（`response_format: json_object` / 改 extractJson，需全站回归）。
- [ ] **误留空假阴率**（金标量化）：留空偏保守、有素材却留空（B2 的"和别处不同"点）——留空比编造安全，但精度代价需金标量化"该生成却留空"率。
- [ ] **"讲清重点"句超 22 词**（H6✗，本轮 29/34/23/26）：要不要严守 ≤22（prompt 加压/后处理），red-team/产品方定。
- [ ] `threshold-probe.mjs` 第三份旧 SYSTEM（无留空出口）已与 example-probe 不同源、注释过时 → 同步或标废弃。

## 🚧 语料门槛线（阈值拍板后）
- [ ] 实施门槛：客户端主拦（文字/语音两入口共用预检）+ restructure 服务端兜底 + corpus 服务端兜底，**一个常量 `MIN_CORPUS_CHARS` 同源**；**独立字数闸、不碰 usable 判定**（usable 是故意放行薄素材的，改它会误伤+跑偏）。
- [ ] **只拦新建**（编辑旧语料走 updateCorpusCleaned、天然跳过，旧数据既往不咎）。
- [ ] **文案**：区分现有 GARBAGE_TOAST（判"不像经历"）——门槛是"真实但太少"，引导补充 + 点名维度（是什么/做了什么/后来感觉）。
- [ ] 观察项（非阻塞）：口水话 rawText 过门槛但 cleanedText 薄 → 上线后看要不要在 cleanedText 落库补判一次。

## 🎨 UI / 前端线（ux-reviewer 出方案 → 实施）
- [ ] 分点式卡片呈现设计：点数组渲染、**空点态"这点你的语料还没讲到"**（兼引导补料钩子）、翻面、编辑态。
- [ ] FlashCard 卡背点数组渲染（part1/2/3 一套）。
- [ ] 素材库入口（IA 平级双卡）/ 筛选（全部|已回答 × part1|part2）/ SRS 滑动骨架。
- [ ] a11y（`prefers-reduced-motion`、手势外留按钮+键盘、44px 命中区、aria-label）。

## 🛡️ 审计 / 验证（上线前硬门）
- [ ] **red-team 复审分点式 v0.3**（形态变了，审"改善真假"+ 分点式新坑，尤其留空兜底可靠性）。
- [ ] **真库验证写路径**（本地无库、仅静态推演）：0035 事务 RPC 原子性、孤儿回收、换/删语料 job 竞态、drain 状态机（consent 撤回不外发）、懒物化 upsert。
- [ ] **drain 孤儿 15 分钟阈值**待部署侧确认 Zeabur 容器超时行为后调。
- [ ] **残留在途竞态**收口（processing 中换/删语料撞上生成）→ drain 任务版本号/取消令牌。
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
