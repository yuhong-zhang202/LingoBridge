# Engineering Standards

> 📋 最新交接文档见 交接文档/HANDOVER-2026-06-06.md（包含产品逻辑、架构、已完成、待办、需关注文件，新会话请先读它）。

## 1. 模块化原则

- 单个文件不超过 **1000 行**，超过必须拆分为独立模块
- 按功能分模块：
  ```
  src/
  ├── components/   # UI 组件
  ├── hooks/        # 自定义 React Hooks
  ├── lib/          # 工具函数、通用逻辑
  ├── types/        # 类型定义
  └── api/          # API 调用封装
  ```
- 修改代码时删除旧实现，**不留注释掉的死代码**

## 2. TypeScript 规范

- `tsconfig.json` 必须开启 `"strict": true`
- 所有函数必须有明确的参数类型和返回类型：
  ```ts
  // ✅ 正确
  function parseResponse(raw: string): ParsedResult { ... }

  // ❌ 错误
  function parseResponse(raw) { ... }
  ```
- 禁止使用 `any`，改用 `unknown`：
  ```ts
  // ✅ 正确
  function handle(value: unknown): void { ... }

  // ❌ 错误
  function handle(value: any): void { ... }
  ```

## 3. 注释规范

**文件顶部注释**（每个文件必须包含）：
```ts
/**
 * @module   ComponentName
 * @desc     模块用途说明
 * @author   作者名
 * @created  YYYY-MM-DD
 */
```

**函数注释**（每个导出函数必须包含）：
```ts
/**
 * 功能说明
 * @param  paramName  参数说明
 * @returns           返回值说明
 * @sideEffect        副作用说明（如有）
 */
```

**行内注释**：只注释"为什么"，不注释"做什么"：
```ts
// ✅ 正确：解释原因
// OpenAI 流式接口在网络切换时不会自动重连，需要手动重试
await retryStream(call)

// ❌ 错误：解释做什么（代码本身已说明）
// 调用重试流
await retryStream(call)
```

## 4. 错误处理

- 所有 API 调用必须有 `try/catch`
- 统一错误类型定义在 `types/errors.ts`：
  ```ts
  export type AppError = {
    code: string
    message: string
    cause?: unknown
  }
  ```
- 用户可见的错误统一通过 `Toast` 组件展示，不直接 `alert()`
- AI 接口调用超时设置 **30 秒**：
  ```ts
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  ```

## 5. 环境变量

- API Key 只能放在 `.env.local`（已在 `.gitignore` 中排除）
- `.env.example` 提供所有需要的变量名（**不含值**），供新成员参考
- 代码中通过 `lib/env.ts` 统一访问，禁止直接使用 `process.env.XXX`：
  ```ts
  // lib/env.ts
  export const env = {
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? '',
    doubaoAsrAppId: process.env.DOUBAO_ASR_APP_ID ?? '',
    doubaoAsrAccessToken: process.env.DOUBAO_ASR_ACCESS_TOKEN ?? '',
    // ...其余字段见 env.ts
  }
  ```

## 6. 日志规范

- **开发环境**使用 `console.log`，格式：`[模块名] 动作 数据`：
  ```ts
  console.log('[AudioRecorder] start recording', { sampleRate })
  ```
- **生产环境**禁止裸 `console.log`，通过 `lib/logger.ts` 控制（生产自动静默）
- AI 接口调用必须记录以下信息：
  - 请求发送时间
  - 响应接收时间（耗时）
  - token 用量（`prompt_tokens` / `completion_tokens`）

## 7. Git 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

| 前缀         | 用途                         |
|------------|----------------------------|
| `feat:`    | 新功能                        |
| `fix:`     | 修复 bug                     |
| `refactor:`| 重构（不改变功能）                  |
| `style:`   | 样式调整（不影响逻辑）                |
| `test:`    | 测试相关                       |
| `docs:`    | 文档更新                       |
| `chore:`   | 构建/工具/依赖变更                 |

示例：
```
feat: add audio waveform visualization
fix: resolve crash when recording exceeds 10MB
refactor: extract API client to lib/api.ts
```

## 8. 测试规范

- 工具函数（`lib/`）必须有单元测试（Jest）
- AI 接口调用使用 mock 测试，不发真实请求
- 测试文件放在 `__tests__/` 目录，命名 `xxx.test.ts`：
  ```
  src/
  └── lib/
      ├── parser.ts
      └── __tests__/
          └── parser.test.ts
  ```
- 每个测试文件覆盖：正常路径、边界条件、异常路径

## 9. 性能规范

- 图片使用 `next/image` 实现懒加载，禁止裸 `<img>` 标签
- API 响应使用 **SWR** 或 **React Query** 管理缓存，避免重复请求
- 录音文件超过 **10MB** 时，向用户展示提示，终止录制或触发上传分片逻辑：
  ```ts
  if (blob.size > 10 * 1024 * 1024) {
    toast.warning('录音文件过大，请分段录制')
  }
  ```

## 10. 产品核心架构（题目匹配三段式）

题目匹配是本产品的技术核心，分三段串联，不可简化为单次 AI 调用：

**第一段 萃取**（`src/services/extraction.ts`）
- 模型：`MODEL_EXTRACTION`（qwen-plus）
- 输入：整理后的中文故事；输出：`{ primary, secondary }` 各带 `pointCode`（如 `EMO_04`）和 `reason`
- 观察点 taxonomy（49 个，6 维度）与判断规则完全写死在该文件的 `SYSTEM_PROMPT` 里，**它是观察点体系的唯一真源**（产品不变式 5）；DB / 邻接表 / 文档都是下游。改 prompt 须用老故事回归验证

**第二段 召回——三层漏斗**（`src/services/matching.ts` → `src/lib/db/questions.ts`）
- 关联表：`question_observation_links(observation_point_id, question_id, is_primary)`
- 第1层：primary code 查 `is_primary=true`；有结果则追加 secondary 补充（Set 去重）
- 第2层：primary 无结果且有 secondary → secondary 不限 `is_primary`，标记 `matchedViaSecondary`
- 第3层：均无结果 → `noMatch=true`，前端走温柔收尾页

**第三段 相关性重排**（`src/services/ranking.ts`）
- 模型：`MODEL_RANKING`（qwen-plus），`temperature: 0`（降波动，结果可复现）
- 判分标准：不用改故事即可回答 ≥85（高）；同故事换角度 60–84（中）；必须换故事 30–59（低）；<30 隐藏
- 降级策略：模型调用失败静默返回空数组，调用方保留漏斗排序原序展示

**分档阈值常量**（`src/lib/constants.ts`，改阈值只改这里）
```ts
export const SCORE_HIGH = 85   // 高匹配：默认显示
export const SCORE_MID  = 60   // 中匹配：折叠进「查看更多」
export const SCORE_LOW  = 40   // 低匹配：折叠进「查看更多」
// < SCORE_LOW：隐藏（软折叠，非硬删）
```

**架构决策记录（勿随意推翻）**
- 不把全部题塞进单次 AI 调用：题库规模下又慢又贵又不稳，两段式（召回+精排）是规模化必需
- 不加维度匹配加分公式：会退回粗粒度规则匹配，与 LLM 打分信号打架；提准确率途径是改 prompt，不加公式

## 11. AI 模型规范

**当前模型常量**（均在 `src/lib/constants.ts`，改模型只改这里）
```ts
export const MODEL_EXTRACTION   = 'qwen-plus'    // 故事萃取
export const MODEL_RANKING      = 'qwen-plus'    // 相关性重排
export const MODEL_ANALYSIS     = 'qwen-plus'    // 侧重点分析（flash 跟不住固定 3 点约束，回退 qwen-plus）
export const MODEL_PRACTICE     = 'qwen-plus'    // 练习对话 + 润色
export const MODEL_RESTRUCTURE  = 'qwen-flash'   // 语料整理（原写死在 restructure.ts，已收编至此）
// 转写用豆包 ASR（DOUBAO_ASR_APP_ID / DOUBAO_ASR_ACCESS_TOKEN）
```

**统一调用入口**：`src/lib/llm.ts` 的 `callLLMJson<T>()`，支持 `provider: 'dashscope' | 'anthropic'`。anthropic 分支保留作备用，不要删除。

**成本基准**

> 旧的实测基准数据已删除（模型配置调整后原数据失效）。上线后用真实故事重新跑一轮，建立新基准。

改动 AI 相关逻辑后，必须在 app 里跑真实故事并 `grep ApiLogger dev.log` 确认 service/成本，不能只信 `tsc`。

## 12. 安全红线（service_role key）

Supabase service_role key 拥有数据库管理员权限（绕过所有 RLS），泄露等同于数据库裸奔。

**隔离规则**
- key 只在 `src/lib/supabase-server.ts` 内部读取（`process.env.SUPABASE_SERVICE_ROLE_KEY`），**不经过** `src/lib/env.ts`（env.ts 是前后端两用文件，放进去会把变量名打包进前端 bundle）
- `src/lib/supabase-server.ts` 和 `src/lib/db/corpus-server.ts` 顶部必须保留 `import 'server-only'`，绝不能被任何 `'use client'` 文件或客户端可达的模块 import

**改动后必须验证**
```bash
npm run build
# 确认静态产物里搜不到 key 名称
grep -r "SUPABASE_SERVICE_ROLE_KEY" .next/static/ && echo "泄露！" || echo "安全"
```
