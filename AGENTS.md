# AGENTS.md

## What is this

tickspec — a YAML-based DSL for quant trading signals/strategies. Single TypeScript package (not a monorepo). Parses `.tksp` files into a Canonical JSON IR.

## Quick commands

```bash
npm install          # first time only
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit (fast, no output files)
npm run lint         # eslint on src/**/*.ts + test/**/*.ts
npm test             # vitest run
npm run test:watch   # vitest in watch mode
```

**Order matters for verification**: `typecheck → lint → test` (or just `npm run build && npm test`). CI runs all four.

## Architecture

```
src/
  cli.ts              # CLI entry: parse | validate | compile
  compiler/
    index.ts          # public API re-exports
    types.ts          # all AST/IR types (read this first)
    yaml-parse.ts     # YAML → parsed AST
    expr-parser.ts    # expression parser
    validator.ts      # semantic validation
    ir.ts             # AST → canonical JSON IR
    compile.ts        # full pipeline: parse → validate → IR
    errors.ts         # DiagnosticCollector
    metadata.ts       # metadata header parsing
test/
  fixtures/           # .tksp test fixtures (good + bad)
  __snapshots__/      # vitest snapshots (ir-golden)
```

Entry points:
- Library: `src/compiler/index.ts` (exports `parseTksp`, `validate`, `toIR`, `compileSource`, etc.)
- CLI: `src/cli.ts` → `dist/cli.js`

## ESM project

`"type": "module"` in package.json. All TS imports use `.js` extensions (`from './foo.js'`). Node >= 20.

## Testing

- **vitest** with `globals: true` (no need to import `describe`/`it`/`expect` in new tests, but existing tests do import them — keep consistent with the file you're editing).
- Tests in `test/*.test.ts`, fixtures in `test/fixtures/*.tksp`.
- **Snapshots**: `test/__snapshots__/ir-golden.test.ts.snap`. If you change IR output, run `npm test -- --update` to update snapshots.
- To run a single test file: `npx vitest run test/yaml-parse.test.ts`
- Bad fixtures (`bad-*.tksp`) test error cases — don't modify them unless the language spec changes.

## Linting

ESLint config (`eslint.config.js`) enforces:
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/consistent-type-imports`: error (use `import type { ... }`)

## CI

GitHub Actions workflow (`.github/workflows/hy-workflow.yml`) runs on push/PR:
1. Detects package manager (npm here), runs `npm ci` then build/typecheck/lint/test
2. Runs **doclint** and **codelint** (external tools from pinned tarballs)
3. Base branch for codelint/doclint: `dev`

## .tksp files

The DSL files. Metadata is in YAML comments (`# key: value`). Factor types annotated inline: `- factor_name #number`. Two kinds: `signal` (outputs `[-1,1]`) and `strategy` (combines signals, outputs operations).

## Gotchas

- `verbatimModuleSyntax: false` in tsconfig — type-only imports are allowed without `type` keyword, but eslint enforces `import type` anyway.
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`. Use `!` or null-check.
- `noImplicitAny: true` + `strictNullChecks: true` — full strict mode.
- CLI writes IR to `<name>.ir.json` adjacent to source when stdout is a TTY.
