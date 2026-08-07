// jest 配置（CommonJS，jest 原生解析——不依赖 ts-node；原 jest.config.ts 需 ts-node，CI 干净装无此依赖会挂）
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        // 根 tsconfig 是 jsx:'preserve'（Next 要求，构建侧不能动），但 jest 拿到保留了 JSX 的产物直接执行会
        // 报 SyntaxError: Unexpected token '<'——组件测试一律跑不起来。这里只在测试侧覆盖成 react-jsx。
        jsx: 'react-jsx',
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // .claude/worktrees/ 下是本仓库的 git worktree 副本（隔离改动用），里面有整套 src 和测试。
  // 不排除的话裸跑 `npx jest` 会把它们一并扫进来：副本里的 '@/' 会解析到【本 rootDir】的 src，
  // 跨版本串味、大面积假红（实测多扫 63 个测试文件），很容易被误读成「测试崩了」。
  // 两个都要：testPathIgnorePatterns 管「跑哪些测试」，modulePathIgnorePatterns 管「解析哪些模块」。
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
}
