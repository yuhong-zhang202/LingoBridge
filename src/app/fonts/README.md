# 自托管字体：Plus Jakarta Sans

本目录的 `plus-jakarta-sans-latin-{400,500,600,700}-normal.woff2` 为项目实际使用的字重
（latin subset，normal style），由 `src/app/layout.tsx` 经 `next/font/local` 引用。

## 来源
从 npm 包 `@fontsource/plus-jakarta-sans`（`node_modules/@fontsource/plus-jakarta-sans/files/`）取出，
仅复制项目用到的 4 个 latin 字重 woff2。更新字体只需重装该包后重新复制对应文件。

## 许可
Plus Jakarta Sans 采用 **SIL Open Font License 1.1 (OFL)**，允许自由使用、嵌入与分发。
字体版权归 Tokotype / Gumpita Rahayu 等原作者所有。OFL 全文见：
https://openfontlicense.org/
