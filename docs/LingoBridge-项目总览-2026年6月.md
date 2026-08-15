# LingoBridge 项目总览 · 2026年6月

> 雅思口语练习App | 用真实人生故事作为备考素材 | 6维度画像 + 题库匹配 + AI反馈

---

## 1. 产品定位

**核心观点**：真实生活的碎片（一个人讲述的故事）是最好的口语练习素材。App 帮助用户：
1. **录入**：讲述自己的故事（语音/文本）
2. **整理**：AI 把故事整理成清晰的叙述
3. **映射**：识别这个故事对应 IELTS 题库的哪些题
4. **复用**：通过题库反向查询，找出还没有准备的题目，激发新的故事

**画像哲学**（最关键）：
- 观察点 ≠ 题库索引表
- 观察点 = 一个人的生活里真实、反复、值得讲述的切面
- 加点标准：「这个点是不是一个人的人生里真实出现的」，而非「这个点能接住哪些题」
- 结果：43 个观察点（后续审计为 44 个）能稳定映射 ~930 题，结构不会因题库而崩坏

---

## 2. 技术栈

| 组件 | 选型 | 用途 |
|---|---|---|
| **前端** | Next.js 14 + PWA | 页面框架 + 离线支持 |
| **样式** | Tailwind CSS v3 | UI 体系 |
| **数据库** | Supabase (PostgreSQL) | 语料、观察点、题库、得分 |
| **部署** | Vercel | CI/CD + 域名 |
| **语料整理** | Qwen Flash (DashScope API) | 速度优先 |
| **维度萃取** | Claude Sonnet 4.6 | 精准性优先 |
| **练习对话** | Gemini Flash | 口语练习反馈 |

**模型分工**（已定稿）：
- 语料整理 → `qwen-flash`（国际站 DashScope，便宜快速）
- 维度萃取 → `claude-sonnet-4-6`（准确性最高，43→44 个观察点的精细识别）
- 练习对话 → `Gemini Flash`（对话流畅度）

**项目结构**：
```
yuhong-zhang202/LingoBridge
├── src/app/
│   ├── page.tsx（首页）
│   ├── recording/（录音页）
│   ├── restructure/（整理语料页）
│   ├── matching/（题库匹配）
│   ├── analysis/（维度分析）
│   ├── practice/（练习）
│   ├── feedback/（反馈）
│   ├── library/（题库列表）
│   ├── article-view/（文章详情）
│   └── api/（后端路由）
├── src/components/
│   └── library/DimensionTab.tsx（已接真实数据）
├── src/services/
│   ├── restructure.ts（千问）
│   └── extraction.ts（Claude，完整 43 点 system prompt）
├── src/lib/
│   ├── types.ts / constants.ts / utils.ts / env.ts / supabase.ts
│   └── db/（数据库查询）
├── supabase/
│   ├── migrations/0001_init_schema.sql
│   ├── migrations/0002_dimension_scores.sql
│   └── seed.sql（6 维度 + 43 观察点 + 话题型标记）
└── ENGINEERING.md / DESIGN.md / PRODUCT.md
```

**Supabase**：
- 项目 ID：`jzoxnxgbvshiwctwvrwd`（2026-07 迁自旧库 `tvdzkcnnszjynzzvtptk`）
- 区域：ap-southeast-1 (Singapore)（原 eu-central-1 / Frankfurt，已迁；迁移经过见 `docs/交接-统一交接稿-2026-07-25.md`）
- 数据库：PostgreSQL

---

## 3. 已完成的工作

### 数据库设计 ✅
- `0001_init_schema.sql`：语料表、观察点表、维度表
- `0002_dimension_scores.sql`：饱和度计算表
- `seed.sql`：6 维度、43 观察点（审计后 44）、雷达图算法

### 已验证的 Claude Code Prompts（1-5）

| # | 标题 | 状态 | 文件 |
|---|---|---|---|
| 1 | 数据库地基 | ✅ | `claude-code-prompt-01-数据库地基.md` |
| 2 | Supabase 客户端 + 语料数据层 | ✅ | `claude-code-prompt-02-保存语料.md` |
| 3 | 整理语料（千问） | ✅ | `claude-code-prompt-03-整理语料.md` |
| 4 | 维度萃取（Claude） | ✅ | `claude-code-prompt-04-维度萃取.md` |
| 5 | 维度得分 + 雷达图 | ✅ | `claude-code-prompt-05-雷达图算分.md` |

每条 prompt 已单独跑过、验证过，结果稳定。

### 前端组件
- `DimensionTab.tsx`：已接入真实数据库，雷达图渲染完成

---

## 4. 维度设计全景（审计后最新）

### 6 个维度（44 个观察点）

#### 情绪内核 · EMO（13 个）
状态(2) → 整体状态、能量节奏  
节律(6) → 独处、放松、充电、习惯、压力模式、食物  
波动(5) → 压力事件、情绪波动、失眠、难以启齿、外表形象

#### 人际羁绊 · REL（11 个）
- REL_01/02：家人（日常 + 事件）
- REL_03/04：朋友（舒服的朋友 + 共度）
- REL_05：亲密关系
- **REL_06**：**印象深刻的弱关系**（⭐ 审计重点：含敬佩的人、名人、一面之缘）
- REL_07/08：宠物（日常 + 事件）
- REL_09/10：互助（你帮 + 被帮）
- REL_11：关系摩擦

#### 空间感知 · SPA（7 个）
栖居(2) → 居住空间、通勤  
城市(2) → 所在城市、建筑/公共空间  
远行(2) → 旅行者类型、一次远行  
自然(1) → 自然时刻

#### 精神栖所 · SPI（6 个）
作品(4) → 反复回去的、特定时期的、改变看法的、音乐/艺术感受  
物件(1) → 特别的物品  
数字(1) → 数字世界栖居（APP、社媒、播客）

#### 成长演进 · GRO（7 个）⭐ **新增 GRO_07**
能力支(3) → 长期投入、学会的技能、死磕做成  
认知支(3) → 失败复盘、想法转变、未来方向  
**新增(1) → GRO_07 一次重要的选择/决定**（波动层，阈值 1）

#### 价值底色 · VALUE（不设观察点）
- 没有子切片，靠从前 5 维语料**横向萃取**
- Part 3 全部归 value（暂不匹配）

### 两条关键规则

**Rule 1：主副维度**  
一段语料（1-2 分钟）只有一个主维度，最多顺带一个副维度。主维度计入饱和度，副维度作素材标签。

**Rule 2：三层结构**  
每维度内的观察点按时间尺度分层：
- 状态层：基调（3 以内）
- 节律层：日常模式（最多，表现丰富）
- 波动层：单次事件（故事密度最高）

---

## 5. 观察点审计结果（2026年6月）

### 题库来源
**新东方 IELTS 口语题库**（2026年1-4月版）
- Part 1：约 37 个话题、550+ 题
- Part 2：约 63 张卡（People/Places/Objects/Events）
- Part 3：每卡 4-6 追问、315+ 题
- **合计：约 930 题**

### 审计结论

| 项 | 结果 |
|---|---|
| 结构稳定性 | ✅ 设计经住压力测试，75% 题干净映射 |
| 新增观察点 | **1 个**：GRO_07（一次重要的选择） |
| 定义更新 | **1 处**：REL_06 扩为「印象深刻的弱关系」（吸收 ~10 张人物卡） |
| 可选新增 | 1 个（EMO_14「难忘经历」），**建议不加**，避免文件柜化 |
| 话题型留白 | ~8-10 张卡（故意不映射，如停电、科学领域、好服务等） |

### 关键改动

**GRO_07 新增**（强烈推荐）
- 名称：一次重要的选择/决定
- 维度：成长 · 波动层
- 阈值：1（单个事件）
- 接住的题：An Important Decision, 部分 A Positive Change
- 理由：人生里的岔路口（换工作、搬城、选专业）是真实、反复、值得讲述的切面

**REL_06 定义扩展**（性价比最高）
- 从：「印象深刻的陌生人」
- 改为：「印象深刻的弱关系」
- 包含：一面之缘的陌生人、敬佩的人、名人、老师、远端崇拜者
- 效果：一处改动，~10 张人物卡（A Famous Person / A Creative Person / A Person Who Solved a Problem 等）全部有家

**话题型标记**（新增数据库字段）
- 题库表需加 `topic_only` 字段
- 值为 True 的题：不进「切换」池，提示用户用传统话题方式准备
- 示例：A Wild Animal（描述野生动物知识）、An Area of Science、停电、好服务等

---

## 6. 当前决策（待拍板）

用户已确认产品架构（切换按钮 = 录入引导接口），现有 4 条决策需拍板：

### ✅ 需拍板的 4 条

1. **加 GRO_07 吗？**（建议：加）
   - 一次重要的选择/决定
   - 真实、高频的人生切面

2. **REL_06 扩为弱关系吗？**（建议：扩）
   - 从字面「陌生人」→「弱关系」（含敬佩的人、名人）
   - 效果：10+ 卡直接有家

3. **可选的 EMO_14「难忘经历」**？（建议：不加）
   - 方案 A：不加，分流到现有点（音乐现场→SPI_04，刺激活动→EMO_05）
   - 方案 B：收紧加点（风险：磁铁效应，吸收本该进 SPI/REL 的语料）
   - 推荐 A（保护结构完整）

4. **话题型留白清单**（确认列表）
   - A Traditional Story / A Time You Told a Truth 归价值底色还是话题型？

---

## 7. 下一步（已规划）

### Phase 1：维度设计定稿（这一轮）
- [ ] 用户拍板上述 4 条决策
- [x] ~~更新 seed.sql（加 GRO_07，标注话题型）~~ → **2026-08-15 以另一种方式了结：`supabase/seed.sql` 已删除**，不再补它。这条 TODO 挂了两个月没做，期间缺口从 GRO_07 一个长到 6 个（含整个 `value` 维度）——说明问题不是"忘了补"，是**手写副本这个形态本身会漂**。建库真源改为 `scripts/data/*-seed.json` + `npm run seed:reference`，步骤见 `ENGINEERING.md` §13。
- [ ] 更新维度设计文档（Notion）

### Phase 2：题库建设（Prompt 6）
- 建表：`questions` + `question_observation_links`
- Seed：930 题一条条映射
- 后端匹配：给定观察点，返回对应题目列表
- 前端「题库」tab 接入

### Phase 3：前端核心功能
- [ ] Prompt 7：分析页（维度数据可视化）
- [ ] Prompt 8：练习对话（Gemini 集成）
- [ ] Prompt 9：反馈卡片（评分、建议）

### Phase 4：价值底色
- [ ] Prompt 10：Part 3 价值观萃取（等前 5 维饱和后激活）

---

## 8. 关键约束和工程规范

### 代码规范
- **TypeScript**：strict 模式，禁止 any
- **Page ≤150 行**，UI 组件 ≤80 行
- **AI 调用**：30s 超时（AbortController），记录耗时 + token
- **环境变量**：统一走 `lib/env.ts`，不散落
- **每次任务单一职责**：一条 Prompt 只改指定文件

### 设计文档铁律
- DESIGN.md 写死的：视觉、布局、class 一律不动
- 参考文件：`/mnt/user-data/outputs/DESIGN.md`

### 饱和度算法（最终版·乙）
```
维度得分 = Σmin(主维语料数, 该点阈值) ÷ Σ阈值
    └→ 空点算分母（留白可见）
    └→ 每条语料等值（高阈值点需更多语料）
    └→ 单点封顶（防止单方向饱和过快）
```

### 双层饱和机制
- **浅色**：1 条语料 = 观察点亮灯（快速反馈）
- **深色**：达到丰富阈值 = 满格（可灵活应对多题）

---

## 9. 数据库 Schema（核心表）

### corpus（语料）
```sql
id, user_id, audio_path, transcript, 
restructured_text, created_at
```

### observation_points（观察点）
```sql
id, dimension, layer, name, definition,
description, example_prompt
```

### dimension_scores（得分）
```sql
id, user_id, observation_point_id, 
primary_language_count, saturated_threshold,
last_updated
```

### questions（题库）⭐ **待建**
```sql
id, part(1/2/3), topic, cue_text, 
question_text, topic_only(布尔)
```

### question_observation_links（映射）⭐ **待建**
```sql
question_id, observation_point_id, is_primary
```

---

## 10. 文件清单

### 已产出的 Prompts
| 文件 | 状态 |
|---|---|
| `claude-code-prompt-01-数据库地基.md` | ✅ 已验证 |
| `claude-code-prompt-02-保存语料.md` | ✅ 已验证 |
| `claude-code-prompt-03-整理语料.md` | ✅ 已验证 |
| `claude-code-prompt-04-维度萃取.md` | ✅ 已验证 |
| `claude-code-prompt-05-雷达图算分.md` | ✅ 已验证 |

### 本轮新增
| 文件 | 用途 |
|---|---|
| `观察点审计.md` | 题库对照、新增点理由、话题型清单 |
| `LingoBridge-项目总览-2026年6月.md` | **本文档**：新 Claude 窗口的完整背景 |

### Notion 文档
- **📐 维度设计**：已更新，加入 GRO_07、REL_06 扩展注记
- **📋 产品总览 & 开发计划**：父页面，包含设计决策链

### 生产数据
- ~~**Supabase seed.sql**：待更新，加入 GRO_07 + 话题型标记~~ → **2026-08-15：该文件已删除**（见上方 Phase 1 同条）。建库真源见 `ENGINEERING.md` §13。

---

## 11. 新 Claude 窗口快速开始

### 如果你是新的 Claude，做这些

1. **读本文档**（你在这里） ← 全局背景
2. **读审计文档** → `/mnt/user-data/outputs/观察点审计.md` ← 题库映射细节
3. **待拍板决策** → 用户确认 4 条后，进入 Phase 2
4. **Prompt 6 任务** → 建题库表 + seed ~930 题 + 后端匹配查询

### 关键查询
- **Git 仓**：`yuhong-zhang202/LingoBridge`
- **Supabase**：`jzoxnxgbvshiwctwvrwd.supabase.co`（新加坡；旧 `tvdzkcnnszjynzzvtptk` 2026-07 已迁）
- **技术疑问**：参考 `/mnt/user-data/outputs/claude-code-prompt-05-*.md` 的模式
- **设计疑问**：查 Notion「📐 维度设计」或本地 `DESIGN.md`

---

## 12. 构建顺序（时间线）

```
✅ 地基（DB Schema）
  ↓
✅ 保存语料（Supabase 客户端）
  ↓
✅ 整理语料（千问）
  ↓
✅ 维度萃取（Claude）
  ↓
✅ 算分+雷达（前端）
  ↓
⬅️ 审计+决策（本轮）← 你在这里
  ↓
📋 Prompt 6：题库建设 ← 下一步
  ↓
📋 Prompt 7：分析页
  ↓
📋 Prompt 8：练习对话
  ↓
📋 Prompt 9：反馈卡片
  ↓
📋 Prompt 10：价值底色
```

---

## 13. 联系与讨论

- **产品决策**：见用户在审计文档的拍板备注
- **技术问题**：参考已验证的 5 条 Prompt
- **维度问题**：Notion「📐 维度设计」是源头真理

---

**文档生成**：2026年6月3日  
**审计完成**：930 题全扫，结论稳定  
**下一里程**：拍板 4 条决策 → 启动 Prompt 6（题库建设）
