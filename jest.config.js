// jest 配置（CommonJS，jest 原生解析——不依赖 ts-node；原 jest.config.ts 需 ts-node，CI 干净装无此依赖会挂）
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}
