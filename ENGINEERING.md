# Engineering Standards

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
    openaiApiKey: process.env.OPENAI_API_KEY!,
    // ...
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
