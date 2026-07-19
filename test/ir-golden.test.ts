import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTksp } from '../src/compiler/yaml-parse.js';
import { toIR } from '../src/compiler/ir.js';
import { compileFile } from '../src/compiler/compile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures');
const fixture = (name: string) => resolve(fixtureDir, name);

describe('ir-golden', () => {
  it('emits a valid IR for qqq_signal.tksp with language/version/kind', () => {
    const { document } = parseTksp(readFileSync(fixture('qqq_signal.tksp'), 'utf8'));
    expect(document).toBeDefined();
    if (!document) throw new Error('parse failed');
    const ir = toIR(document);
    expect(ir.language).toBe('tickspec');
    expect(ir.version).toBe(1);
    expect(ir.kind).toBe('signal');
    if (ir.kind !== 'signal') throw new Error('expected signal IR');
    expect(ir.name).toBe('qqq_signal');
    expect(ir.inputs).toHaveLength(2);
    expect(ir.triggers).toHaveLength(2);
    const edgeTrigger = ir.triggers.find((t) => t.kind === 'edge');
    expect(edgeTrigger).toBeDefined();
    const levelTrigger = ir.triggers.find((t) => t.kind === 'level');
    expect(levelTrigger).toBeDefined();
    expect(ir.schedulers).toHaveLength(1);
    const roundTrip = JSON.parse(JSON.stringify(ir));
    expect(roundTrip).toEqual(ir);
    expect(ir).toMatchSnapshot();
  });

  it('emits IR for qqq_strategy.tksp via toIR (bypass validate) and matches snapshot', () => {
    const { document } = parseTksp(readFileSync(fixture('qqq_strategy.tksp'), 'utf8'));
    expect(document).toBeDefined();
    if (!document) throw new Error('parse failed');
    const ir = toIR(document);
    expect(ir.language).toBe('tickspec');
    expect(ir.version).toBe(1);
    expect(ir.kind).toBe('strategy');
    if (ir.kind !== 'strategy') throw new Error('expected strategy IR');
    expect(ir.signals).toHaveLength(3);
    expect(ir.combine).toHaveLength(1);
    expect(ir.combine[0]?.expr.type).toBe('call');
    if (ir.combine[0]?.expr.type === 'call') {
      expect(ir.combine[0]?.expr.name).toBe('clamp');
    }
    expect(ir.schedulers).toHaveLength(1);
    expect(ir.triggers).toHaveLength(4);
    expect(ir).toMatchSnapshot();
  });

  it('compileFile succeeds end-to-end on qqq_signal.tksp and produces valid JSON IR', () => {
    const result = compileFile(fixture('qqq_signal.tksp'));
    expect(result.diagnostics.errors()).toEqual([]);
    expect(result.ir).toBeDefined();
    expect(result.ir?.kind).toBe('signal');
  });
});
