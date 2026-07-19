import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTksp } from '../src/compiler/yaml-parse.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures');
const readFixture = (name: string) => readFileSync(resolve(fixtureDir, name), 'utf8');

describe('yaml-parse', () => {
  it('parses qqq_signal.tksp', () => {
    const src = readFixture('qqq_signal.tksp');
    const { document, diagnostics } = parseTksp(src, 'qqq_signal.tksp');
    expect(diagnostics.errors()).toEqual([]);
    expect(document).toBeDefined();
    if (!document || document.kind !== 'signal') throw new Error('expected signal');
    expect(document.name).toBe('qqq_signal');
    expect(document.inputs).toHaveLength(2);
    expect(document.inputs[0]?.name).toBe('qqq_drawdown_3mo');
    expect(document.inputs[0]?.type).toBe('number');
    expect(document.inputs[1]?.name).toBe('qqq_return_1d');
    expect(document.output.range).toEqual([-1, 1]);
    expect(document.scheduledChecks).toHaveLength(1);
    expect(document.triggers).toHaveLength(2);
    const priorities = new Set(document.triggers.map((t) => t.priority));
    expect(priorities).toContain(0);
    expect(priorities).toContain(1);
    const names = document.triggers.map((t) => t.name);
    expect(names).toContain('one_day_fast_drop');
    expect(names).toContain('drawdown_cross_5');
  });

  it('parses qqq_strategy.tksp', () => {
    const src = readFixture('qqq_strategy.tksp');
    const { document, diagnostics } = parseTksp(src, 'qqq_strategy.tksp');
    expect(diagnostics.errors()).toEqual([]);
    expect(document).toBeDefined();
    if (!document || document.kind !== 'strategy') throw new Error('expected strategy');
    expect(document.name).toBe('qqq_strategy');
    expect(document.signals).toEqual(['qqq_signal', 'rate_signal', 'liquidity_signal']);
    expect(document.combine).toHaveLength(1);
    expect(document.combine[0]?.name).toBe('score');
    expect(document.scheduledChecks).toHaveLength(1);
    expect(document.triggers).toHaveLength(4);
    const tnames = document.triggers.map((t) => t.name).sort();
    expect(tnames).toEqual(['fast_rally', 'panic_sell', 'score_cross_down', 'score_cross_up']);
  });

  it('parses inline #type annotations with description', () => {
    const src = [
      '# language: tickspec',
      '# kind: signal',
      '# name: inline_test',
      'inputs:',
      '  - foo #number my desc',
      'output:',
      '  o: [-1,1]',
      'scheduled_checks:',
      '  - name: c',
      '    every: 1d',
      '    emit:',
      '      - [true, 0]',
      '',
    ].join('\n');
    const { document, diagnostics } = parseTksp(src);
    expect(document).toBeDefined();
    if (!document || document.kind !== 'signal') throw new Error('expected signal');
    expect(document.inputs[0]?.name).toBe('foo');
    expect(document.inputs[0]?.type).toBe('number');
    const hasDescWarn = diagnostics.getDiagnostics().some(
      (d) => d.code === 'INPUT_TYPE_DEFAULT',
    );
    expect(hasDescWarn).toBe(false);
  });

  it('flags bad-missing-kind fixture', () => {
    const src = readFixture('bad-missing-kind.tksp');
    const { diagnostics, document } = parseTksp(src, 'bad-missing-kind.tksp');
    expect(document).toBeUndefined();
    expect(diagnostics.getDiagnostics().some((d) => d.code === 'METADATA_KIND')).toBe(true);
  });

  it('records non-zero source positions on inputs', () => {
    const src = readFixture('qqq_signal.tksp');
    const { document } = parseTksp(src);
    if (!document || document.kind !== 'signal') throw new Error('expected signal');
    expect(document.inputs[0]?.span?.start.line).toBeGreaterThan(0);
  });
});
