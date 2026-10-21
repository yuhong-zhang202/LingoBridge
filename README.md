# LingoBridge

> 用真实生活故事练雅思口语，而不是先编故事、再背答案。

LingoBridge 是一个 **AI Native 雅思口语练习产品**。用户可以用中文文字或录音输入自己的真实经历，系统将内容整理成可复用的故事素材，匹配真正能够回答的雅思口语题，再进入题目分析、对话练习与反馈。

项目从真实备考痛点出发：题库很大，很多学习方式要求用户先“编一套故事”再反复背诵。LingoBridge 反过来做——**先从用户已经拥有的真实经历出发，再寻找能回答的题目。**

## 核心体验

```text
真实故事输入
   ↓
AI 整理 / 语音转写校对
   ↓
题目匹配
   ↓
题目分析
   ↓
对话练习
   ↓
反馈与复习
```

产品早期曾直接生成完整口语稿，后来发现“生成更多稿子”仍可能变成新的背诵负担，因此逐步转向 **匹配 → 分析 → 练习 → 反馈** 的训练路径。

文字与语音输入也采用不同流程：文字由用户自己输入，正常链路跳过额外的整理确认页；语音仍保留校对环节，用于处理 ASR 转写错误。

## 当前 AI 匹配方案

当前主链路采用 **Semantic Retrieval + Question Key Ranking**，对应代码入口：

- `src/services/scheme3-matching.ts`
- `src/app/api/matching/route.ts`

流程如下：

1. 使用 `text-embedding-v3` 将用户故事向量化。
2. 从冻结的题目资产中做语义检索，召回 Top 20 候选题。
3. 为候选题附加 Question Key，显式描述人物、事件、时间、态度等“作答要求”。
4. 使用 `qwen-plus` 进行二次判断与排序。
5. 只有真正达到可作答标准的题目才进入用户可见结果。

这里刻意区分两个问题：

- **False Negative / 漏匹配**：用户的故事明明能回答某道题，但系统返回“无匹配”。
- **False Positive / 误匹配**：题目主题看起来相关，但用户无法直接用原故事回答。

产品目标不是“尽可能多地给题”，而是同时减少这两种错误。

## Evaluation：不是只看模型输出

LingoBridge 把 Evaluation 当成产品流程的一部分，而不是上线前的一次性测试。

项目中包含：

- 人工标注评测集
- Rubric / 判定标准
- Prompt 与 Ranking 回归脚本
- Product Invariants（产品红线）
- 独立评审与 pipeline audit
- 结果留档与回归检查

相关入口：

- `scripts/eval/`
- `docs/PRODUCT_INVARIANTS.md`
- `docs/匹配链路-权威文档.md`

一次同批 **45 条开发语料**的方案对照中：

| 指标 | 旧方案 | 新方案 |
| --- | ---: | ---: |
| Top-1 可作答准确率 | 46.2% (12/26) | 90.5% (38/42) |
| False Negative | 14/38 | 0/38 |

> 以上是开发集对照结果，用于方案迭代，不代表独立测试集或线上准确率。

## 数据驱动的产品迭代

除了模型效果，项目也持续观察真实使用链路。

运营 Dashboard 用于跟踪：

- 用户反馈
- 核心漏斗与流失位置
- 页面停留时间
- 练习次数
- No Match 情况
- 各 AI 环节延迟与调用表现
- 成本与异常

一个实际迭代案例：分析 **51 条真实用户链路数据**后发现，文字输入的整理确认页停留中位数仅 **13.4 秒**，而超过 60 秒的长停留全部来自语音路径。由此取消文字输入的额外校对页面，保留语音校对流程，减少不必要的交互。

## AI Coding 工作方式

LingoBridge 采用 AI-assisted development：

- 产品定义、优先级、验收标准与关键技术取舍由人负责
- 使用 Claude / Codex 辅助实现、测试、代码审查与问题定位
- 对关键改动使用独立评审与回归验证，避免“代码能跑”直接等于“产品正确”

仓库中的 `.claude/`、`.agents/` 与评测脚本记录了这套协作方式。

## Tech Stack

| 层 | 技术 |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Mobile experience | PWA / Add to Home Screen |
| Backend & Data | Supabase / PostgreSQL |
| LLM | qwen-flash, qwen-plus |
| Embedding | text-embedding-v3 |
| Testing | Jest + custom evaluation scripts |
| Charts / Dashboard | Recharts |
| AI Coding | Claude, Codex |

## Repository Map

```text
src/
├─ app/                 # 页面与 API Routes
├─ services/            # LLM、匹配、分析等核心服务
├─ lib/                 # 数据访问、规则、共享逻辑
└─ components/          # UI 组件

scripts/
└─ eval/                # Evaluation、Golden Set、回归脚本

docs/
├─ PRODUCT_INVARIANTS.md
└─ 匹配链路-权威文档.md

PRODUCT.md              # 产品定位与设计原则
DESIGN.md               # UI / UX 设计规范
ENGINEERING.md          # 工程与本地开发说明
```

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后访问：

```text
http://localhost:3000
```

环境变量说明见 `.env.example`。涉及模型、数据库与第三方服务的配置需要使用自己的测试环境。

常用命令：

```bash
npm test
npm run eval:extraction
npm run eval:ranking
npm run build
```

## Documentation

如果想快速理解项目，推荐按这个顺序阅读：

1. `README.md`：产品与系统总览
2. `PRODUCT.md`：用户、产品目的与设计原则
3. `docs/PRODUCT_INVARIANTS.md`：哪些产品承诺不能被技术改动破坏
4. `ENGINEERING.md`：工程结构与本地开发
5. `scripts/eval/`：Evaluation 与回归验证

> 仓库中保留了部分历史 Mapping 方案与旧文档，用于追溯迭代过程。当前匹配主线以 `scheme3-matching.ts` 的 **Embedding Top20 + Question Key Ranking** 为准。

## Status

项目已完成从 0→1 的产品上线与内测，目前仍在持续优化匹配质量、Evaluation 与用户体验。

---

**LingoBridge 的核心问题不是“AI 能不能生成一段英语”，而是：能不能把用户真实的人生经历，稳定地变成真正可练、可复用的口语素材。**
