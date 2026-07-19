import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTksp } from '../src/compiler/yaml-parse.js';
import { validate } from '../src/compiler/validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures');

function loadAndValidate(name: string) {
  const src = readFileSync(resolve(fixtureDir, name), 'utf8');
  const { document, diagnostics: parseDiags } = parseTksp(src, name);
  if (!document) return { document: undefined, diagnostics: parseDiags };
  const valDiags = validate(document, name);
  return { document, diagnostics: valDiags };
}

describe('validator-strategy', () => {
  it('validates qqq_strategy.tksp with zero errors', () => {
    const { diagnostics } = loadAndValidate('qqq_strategy.tksp');
    expect(diagnostics.errors()).toEqual([]);
  });

  it('flags OP_SYMBOL_CONFLICT for same symbol in target+action', () => {
    const { diagnostics, document } = loadAndValidate('bad-operation-conflict.tksp');
    expect(document).toBeDefined();
    expect(diagnostics.errors().some((d) => d.code === 'OP_SYMBOL_CONFLICT')).toBe(true);
  });

  it('flags TRIGGER_PRIORITY_OVERLAP for overlapping same-priority triggers', () => {
    const { diagnostics, document } = loadAndValidate('bad-priority.tksp');
    expect(document).toBeDefined();
    expect(diagnostics.errors().some((d) => d.code === 'TRIGGER_PRIORITY_OVERLAP')).toBe(true);
  });

  it('flags UNDEFINED_REF for unknown signal in combine', () => {
    const src = [
      '# language: tickspec',
      '# kind: strategy',
      '# name: bad_ref',
      'signals:',
      '  - s1',
      'combine:',
      '  - score: clamp(nonexistent, -1, 1)',
      'scheduled_checks:',
      '  - name: c',
      '    every: 1d',
      '    emit:',
      '      - [true, hold]',
      '',
    ].join('\n');
    const { document } = parseTksp(src);
    expect(document).toBeDefined();
    if (!document) throw new Error('parse failed');
    const diags = validate(document);
    expect(diags.errors().some((d) => d.code === 'UNDEFINED_REF' && d.message.includes('nonexistent'))).toBe(true);
  });

  it('resolves combine-defined score in trigger/scheduled conditions', () => {
    const src = [
      '# language: tickspec',
      '# kind: strategy',
      '# name: score_ref',
      'signals:',
      '  - s1',
      'combine:',
      '  - score: clamp(s1, -1, 1)',
      'triggers:',
      '  - name: t',
      '    when: score > 0.5',
      '    emit:',
      '      - [true, hold]',
      '    priority: 0',
      '',
    ].join('\n');
    const { document } = parseTksp(src);
    expect(document).toBeDefined();
    if (!document) throw new Error('parse failed');
    const diags = validate(document);
    expect(diags.errors().filter((d) => d.code === 'UNDEFINED_REF' && d.message.includes('score'))).toEqual([]);
  });
});
