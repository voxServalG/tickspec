# tickspec

tickspec 是基于 YAML 的量化交易信号/策略描述语言，并提供 TypeScript 语言处理器用于解析、校验和输出 Canonical JSON IR。

## 使用

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

CLI 提供三个命令：

```bash
node dist/cli.js parse src/qqq_signal.tksp
node dist/cli.js validate src/qqq_signal.tksp src/qqq_strategy.tksp
node dist/cli.js compile src/qqq_signal.tksp
```

语言规范见 [docs/README.md](./docs/README.md)。示例文件在 [src/qqq_signal.tksp](./src/qqq_signal.tksp) 和 [src/qqq_strategy.tksp](./src/qqq_strategy.tksp)。
