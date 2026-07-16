# LingoBridge 开发交接文档 · 2026-06-05

> 本文档承接《LingoBridge-交接文档-2026-06-04-晚.md》,记录 2026-06-05 这一轮的工作:
> **VALUE 维度解锁 + 匹配机制升级(三层漏斗 / 灵魂标记)+ 匹配精度优化(观察点拆分)。**
> 配套文档:LingoBridge-产品介绍-2.0.md(设计定稿)、LingoBridge-工作路线图-2026-06-04.md、
> Notion「✅ 第一阶段·核心质量 待办」、ENGINEERING.md、DESIGN.md。

---

## 〇、这一轮干了什么(一句话)

把 VALUE(价值底色)维度从"硬锁"解锁为 3 个观察点,并把匹配从"主+副各查一次拼接"升级成**三层漏斗 + 灵魂标记 + 完整版主/副标签匹配**;同时拆分了过粗的 SPA_07 观察点、修复了一个 GRO_07 的隐藏 bug。设计依据见《产品介绍 2.0》。

---

## 一、当前状态(接手第一件事:跑总验收)

**全部代码已改完、tsc 均通过,但尚未做端到端总验收。** 接手第一件事是按下方"总验收清单"用 6 个故事走完整链路,确认全部生效,再继续往下。

GitHub 分支:`feat/home-ielts-toggle`(沿用上一轮)。
⚠️ 还有一个**小修补 prompt 待跑**(共情句换定稿 + 第二层 banner 改低调),见第四节"未完成事项"。

---

## 二、这一轮的完整改动清单(按执行顺序)

### 任务 3 · VALUE 数据落库(Supabase,已 COMMIT)

1. **新增 3 个 VALUE 观察点**到 observation_points:
   - VAL_01 公平感与正义 / VAL_02 诚实与信任 / VAL_03 坚持原则(dimension_id='value')
2. **标注 Part2 卡**:
   - "A Time You Told a Truth"(原 NULL)→ 挂 VAL_02 **主标签**(is_primary=TRUE),激活该卡。
   - "An Important Decision" → 保留 GRO_07 主标签,**新增 VAL_03 副标签**(is_primary=FALSE)。
3. **关键库结构事实**(侦察确认):
   - `question_observation_links` 表已有 `is_primary` 字段,UNIQUE 在 (question_id, observation_point_id),支持一题多观察点 + 区分主/副,**无需改表结构**。
   - 原 277 条 link 全部 is_primary=TRUE,每题仅挂 1 个观察点。本轮新增的 VAL_03 是第一条副标签。

### 任务 4a+4b · 解锁萃取 prompt(extraction.ts)

1. 删除两处 value 锁(原 L24 / L85"绝不输出 value")。
2. 观察点清单新增 VAL_01/02/03 描述。
3. **修复 GRO_07 bug**:GRO_07 此前在 DB 和 seed 题里都存在,但**萃取 prompt 里没有**,导致模型永远不输出 GRO_07、那道题永远匹配不到。本轮补进 prompt。
4. **收紧 secondary 闸门**:从"顺带触及某维度素材"改为"必须是独立的第二叙事角度,不是提到的实体",并加反例(旅行提到朋友≠人际副维度;爸爸帮做决定≠和家人相处)。

### 任务 4c · 查询层参数化(lib/db/questions.ts)

- `getQuestionsByObservation` 加可选参 `includeSecondary`(默认 false 保持向后兼容):false 只查主标签;true 查主+副标签,返回带 `isPrimaryMatch` 标记。
- `getQuestionCountByObservations` 同样加 includeSecondary,**默认 false**(素材库匹配数**只算主标签**,产品决策已定:不算副标签)。
- 新增返回类型 `QuestionWithMatchTag extends QuestionWithLinks { isPrimaryMatch: boolean }`。

### 任务 4d · 三层漏斗 + 排序 + 灵魂标记(matching.ts)

- **三层漏斗**:
  1. 第一层:primary 查主标签题。有题 → 主维度命中;若 secondary 非空,再查 secondary 主标签题追加为副维度命中(isPrimaryMatch=false),matchedViaSecondary=false。
  2. 第二层:primary 空且 secondary 非空 → 用 secondary 查题,作为命中,matchedViaSecondary=true。
  3. 第三层:两层都空 → noMatch=true。
- **三级排序**:isPrimaryMatch=true 在前 → Part 升序 → 稳定排序兜底。
- **灵魂标记透传**:primary(含 pointCode/pointName/dimension/reason)随结果透传,API route 直接 json 输出;选题跳 practice 时带上(数据层已就位,**教练话术消费留待 practice 重写任务**)。
- 新增类型 `FunnelMatchedQuestion` / `FunnelMatchResult`(带 matchedViaSecondary / noMatch)。

### ④.1 · 萃取偏差修正(extraction.ts)

针对实测两个偏差:
- **VAL_02 漏识别**:强化"说实话/诚实"信号——核心动作是说真相/坦诚/守信时,即使发生在人际间,primary 也应是 VAL_02 而非 REL。
- **secondary 误判**:进一步强调"某人是配角≠与其关系是第二角度"。

### ④.2 · SPA_07 拆分(Supabase + extraction.ts)

- **数据侧(已 COMMIT)**:新增观察点 **SPA_08「园艺/种植」**;把 Part1 的 `Plants`(4题)和 `Growing Vegetables / Fruits`(5题)两个 topic 的 link 从 SPA_07 改挂到 SPA_08。SPA_07 现只剩 7 道 Scenery & Views(风景)。
- **prompt 侧**:清单新增 SPA_08,收窄 SPA_07 描述(剥离种植语义,只管自然/风景欣赏)。
- 解决的问题:此前"湖边公园放松"类故事会匹配出"你种过菜吗"这类不沾边的题(SPA_07 把风景欣赏和园艺种植混在一个点)。

### 步骤⑤ · matching 页 UI(3 文件)

- **MatchedQuestionCard.tsx**:加 `isPrimaryMatch` prop,false 时渲染**橙色"需切换角度"标签**(bg brand-primary-light #F2D5C0 / 文字 brand-primary-dark #B5663A,沿用项目 token,非新增色值)。
- **NoMatchView.tsx(新建)**:温柔收尾页,含共情文案 + "再讲一个故事"渐变描边按钮 + "换一道雅思题来练 →"文字链接。
- **matching/page.tsx**:消费 FunnelResult;noMatch → 路由 NoMatchView;matchedViaSecondary → 顶部说明块;题数>8 折叠"查看更多(还有N道)";isPrimaryMatch 传给每张卡。

---

## 三、关键设计决策(为什么这么做,避免后人推翻)

1. **VAL_01 公平"没题可配"不是缺陷**:雅思题库本身不考"公平/维权/冲突"题材(逐题核查:Part2 无、Part3 仅1道讲体育规则)。VAL_01 的价值是**灵魂标记**(让故事被正确理解、内核透传到练习、决定降级文案),不是匹配靶子。这是反直觉但关键的认知,详见产品介绍 2.0 第二节。

2. **三个 VALUE 观察点是"恰好等于真正的缺口数"**:感恩归 REL、责任归 GRO、尊重归 REL、环保归 SPA_07——只有公平/诚实/坚持原则在其他 5 维找不到家,故只设这 3 个。

3. **环保不单设观察点**:环保的 Part3 讨论题挂在 SPA_07(自然的地方/野生动物等)下,环保故事通过 SPA_07 借道进入即可,不需要独立 VALUE 点。

4. **题库公平缺口处理 = 方案3(混合)**:不硬塞烂题、不自造题污染"真题"卖点、把"补价值观/冲突类题"记进 backlog。

5. **Part3 覆盖率 100%(无遗漏)**:故事模式(萃取匹配 53 卡 = 312 道 Part3 / 84%)+ 雅思模式切换池(topic_only + 用户未匹配题,兜底 10 卡 = 58 道 / 15%)= 100%。
   - ⚠️ **作废的旧判断**:曾以为"58 道 Part3 够不到、需补 9 张 topic_only 卡观察点"——错!漏算了雅思模式入口。那 9 张卡补观察点是**锦上添花(让其也能从故事模式进入),非修遗漏的必做项,优先级低**。

6. **完整版 vs 省事版**:用户选完整版(副标签真正参与匹配),所以做了 4c 查询参数化。但 VAL_03 目前仍主要靠 secondary 借道 GRO_07(因为给"An Important Decision"挂的是副标签,需 includeSecondary=true 才查得到)。

7. **"需切换角度"标签用橙色、第二层用低调说明块**:标签橙色(brand-primary 系)以区别于绿色维度标签;第二层顶部**不用橙色横幅**(警告感),用半透明白浅色块,保持温暖低压调性。

8. **共情句用固定通用模板,不做 AI 现场生成**:内测阶段避免 LLM 延迟/成本/翻车风险。定稿见第四节。

---

## 四、未完成事项 / 紧接着要做的

### A. 待跑:小修补 prompt(共情句 + 第二层 banner)

步骤⑤ 落地时,NoMatchView 的共情句是**占位 + TODO**,第二层顶部被做成了**橙色横幅**(与设计不符)。需一个小修补:
1. **NoMatchView 共情句换成固定定稿**(一字不差):
   > 这段故事,我们暂时没在当季雅思题库里找到对应的题目,但请相信雅思口语讨论的仅仅只是大多数人人生体验的一小部分,而你分享的内容却是真实且独一无二的。别停下来,表达是有意义的,持续不断地表达,你会走得更远。
   - 删掉"接入 AI 共情文案"的 TODO 和仅为现场生成预留的无用 props。
2. **第二层顶部 banner 从橙色改低调浅色块**(半透明白 + 0.5px 边框 + rounded-[14px],文字 v2-text 系,关键词 brand-primary-dark 点缀)。

### B. 待做:总验收(见下方清单)

修补跑完后,用 6 个故事走完整链路验证。

---

## 五、总验收清单

### 功能与标准

| # | 功能 | 标准 |
|---|---|---|
| 1 | VAL_02 诚实萃取 | 诚实故事 primary=VAL_02,直配 "A Time You Told a Truth" |
| 2 | VAL_03 借道 | 坚持原则故事 primary=VAL_03,经 secondary=GRO_07 配到 "An Important Decision" |
| 3 | VAL_01 + 三层兜底 | 公平故事 primary=VAL_01;有人际事件角度走第二层,纯抽象走第三层 |
| 4 | secondary 闸门 | 提到某人但非重点时,secondary 不误判为人际 |
| 5 | 第一层+副维度 | 主维度题在前无标签,副维度在后带橙标签 |
| 6 | 第二层 | primary 无题时顶部低调说明块,题卡带"需切换角度" |
| 7 | 第三层 | 都无题时走温柔收尾页,显示固定通用文案 |
| 8 | SPA_08 拆分 | 自然故事不再混入种菜/植物题 |
| 9 | 折叠 | 题数>8 显示前8 + 查看更多 |
| 10 | GRO_07 修复 | 重要决定故事能正常萃取到 GRO_07 |

### 六个验收故事

**① 诚实(验 VAL_02)**:室友偷用我健身房卡,我犹豫后还是当面讲清楚,他道歉、关系反而更坦诚。→ 预期 primary=VAL_02,直配 "A Time You Told a Truth"。

**② 坚持原则(验 VAL_03 借道)**:领导让我改难看的数据,我没改、另写说明解释,领导起初不悦后认可。→ 预期 primary=VAL_03,经 GRO_07 配到 "An Important Decision"。

**③ 公平·纯抽象(验第三层收尾)**:二手平台卖相机,买家自己摔了却退款成功,申诉三次都是机器人回复,被无人情味的系统碾过。→ 预期 primary=VAL_01,走温柔收尾页。

**④ 公平·有人际角度(验第二层)**:小组作业有人没干活却上台抢功,我私下摊牌、摆出分工记录,他道歉并向老师澄清。→ 预期 primary=VAL_01,secondary 是冲突/道歉事件角度,走第二层。**验 secondary 非 REL_03 人物描述**。

**⑤ 自然(验 SPA_08 + 折叠)**:郊外湿地公园,芦苇荡、白鹭、观景台看夕阳染金水面,被自然包围很治愈。→ 预期 primary=SPA_07,**只配风景类题,无种菜/植物题**;题数>8 验折叠。

**⑥ 质量闸门(验 secondary 不误判)**:迷上手冲咖啡,周末研究豆子水温,我妈来时顺便教她闻香,但主要是自己琢磨参数、记录萃取时间、很解压。→ 预期 primary=EMO/GRO 类,**secondary 不应误判成 REL/和家人相处**(妈妈非重点)。

### 检查清单

```
□ ① 诚实 → VAL_02,配 A Time You Told a Truth
□ ② 坚持原则 → VAL_03,配 An Important Decision
□ ③ 纯抽象公平 → 温柔收尾页 + 固定文案("别停下来…")
□ ③ 收尾页两出口("再讲一个""换道题")正常,无占位残留
□ ④ 有人际角度公平 → 低调说明块(非橙色横幅)+ 题卡橙色"需切换角度"标签
□ ④ secondary 是事件角度,没匹配到"一个重要的朋友"人物卡
□ ⑤ 自然 → 无种菜/植物题,只有风景类
□ ⑤ 题数>8 → 前8 + 查看更多,可展开
□ ⑥ 咖啡 → secondary 没误判成 REL/和家人相处
□ 通用:主维度题永远排副维度题前
□ 通用:"需切换角度"标签橙色非绿色
□ 通用:题卡视觉符合 DESIGN.md
```

---

## 六、后续路线图(详见 Notion「第一阶段·核心质量 待办」)

**第一阶段(核心质量)剩余:**
- **相关性排序功能**(P1,第一阶段收口):LLM 或 embedding 给每道题打相关性分;做完后把"临时前8折叠"升级成"按相关性阈值展示"(超出阈值才折叠)。这是让匹配真正精准的根治方案——观察点粗粒度是设计权衡(粗=覆盖广、细=精准但维护重),相关性排序在不牺牲覆盖的前提下提升精准度。
- **教练话术用上灵魂标记**(P1):并入 practice 重写任务,让 VAL primary 引导教练方向。数据层 primary 已透传到位。

**之后梯队(详见路线图文档):**
- analysis 围绕用户故事重写 → practice 结合 analysis(顺序:先 analysis 验证好再 practice)
- 修坏链接(MyStoriesTab 查看)、article mock 决策
- 上架准备(录音页布局 bug、PWA 图标)
- 数据归属 + 登录(Apple Sign In,放最后,数据已按 user_id 持久化)

**Backlog:**
- 补"价值观/冲突"类题(方案3 留口子)
- 9 张 topic_only 卡补观察点(非必做,锦上添花,优先级低)
- ~12 个未被任何题使用的观察点 / 8 个只被 Part1 用的观察点(覆盖广度优化,非遗漏)

---

## 七、验证铁律(延续)

每个写库/RPC 改动都要在 Supabase Dashboard 跑 SQL 或在 app 实测验证真实数据,再往下走。**代码 tsc 过 ≠ 运行时正确**(三层漏斗判定写错了 tsc 照样过)。

---

*本文档记录 2026-06-05 一轮工作。下一步:跑小修补 prompt → 总验收 → 进相关性排序。*
