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

describe('validator-signal', () => {
  it('validates qqq_signal.tksp with zero errors', () => {
    const { diagnostics } = loadAndValidate('qqq_signal.tksp');
    expect(diagnostics.errors()).toEqual([]);
  });

  it('flags UNDEFINED_REF for trigger referencing nonexistent factor', () => {
    const src = [
      '# language: tickspec',
      '# kind: signal',
      '# name: bad_ref',
      'inputs:',
      '  - x #number',
      'output:',
      '  o: [-1,1]',
      'triggers:',
      '  - name: t',
      '    when: bogus_factor < 0',
      '    emit:',
      '      - [true, 0.5]',
      '    priority: 0',
      '',
    ].join('\n');
    const { document } = parseTksp(src);
    expect(document).toBeDefined();
    if (!document) throw new Error('parse failed');
    const diags = validate(document);
    expect(diags.errors().some((d) => d.code === 'UNDEFINED_REF' && d.message.includes('bogus_factor'))).toBe(true);
  });

  it('warns OUTPUT_RANGE_NARROW when output does not include [-1,1]', () => {
    const src = [
      '# language: tickspec',
      '# kind: signal',
      '# name: narrow',
      'inputs:',
      '  - x #number',
      'output:',
      '  o: [0, 1]',
      'scheduled_checks:',
      '  - name: c',
      '    every: 1d',
      '    emit:',
      '      - [true, 0.5]',
      '',
    ].join('\n');
    const { document } = parseTksp(src);
    expect(document).toBeDefined();
    if (!document) throw new Error('parse failed');
    const diags = validate(document);
    expect(diags.getDiagnostics().some((d) => d.code === 'OUTPUT_RANGE_NARROW')).toBe(true);
  });

  describe('KR1: scalar math functions', () => {
    const functions = ['abs', 'sign', 'sqrt', 'log', 'exp'];
    for (const fn of functions) {
      it(`accepts ${fn}(x) with numeric argument`, () => {
        const src = [
          '# language: tickspec',
          '# kind: signal',
          '# name: test_' + fn,
          'inputs:',
          '  - x #number',
          'output:',
          '  o: [-1,1]',
          'scheduled_checks:',
          '  - name: c',
          '    every: 1d',
          '    emit:',
          `      - [${fn}(x) > 0, 0.5]`,
          '',
        ].join('\n');
        const { document } = parseTksp(src);
        expect(document).toBeDefined();
        if (!document) throw new Error('parse failed');
        const diags = validate(document);
        expect(diags.errors()).toEqual([]);
      });

      it(`rejects ${fn}(true) with non-numeric argument`, () => {
        const src = [
          '# language: tickspec',
          '# kind: signal',
          '# name: test_' + fn + '_bad',
          'inputs:',
          '  - x #number',
          'output:',
          '  o: [-1,1]',
          'triggers:',
          '  - name: t',
          `    when: ${fn}(true)`,
          '    emit:',
          '      - [true, 0.5]',
          '    priority: 0',
          '',
        ].join('\n');
        const { document } = parseTksp(src);
        expect(document).toBeDefined();
        if (!document) throw new Error('parse failed');
        const diags = validate(document);
        expect(diags.errors().some((d) => d.code === 'TYPE_MISMATCH')).toBe(true);
      });

      it(`rejects ${fn}(x, y) with wrong arity`, () => {
        const src = [
          '# language: tickspec',
          '# kind: signal',
          '# name: test_' + fn + '_arity',
          'inputs:',
          '  - x #number',
          '  - y #number',
          'output:',
          '  o: [-1,1]',
          'triggers:',
          '  - name: t',
          `    when: ${fn}(x, y)`,
          '    emit:',
          '      - [true, 0.5]',
          '    priority: 0',
          '',
        ].join('\n');
        const { document } = parseTksp(src);
        expect(document).toBeDefined();
        if (!document) throw new Error('parse failed');
        const diags = validate(document);
        expect(diags.errors().some((d) => d.code === 'ARITY')).toBe(true);
      });
    }

    const binaryFunctions = ['min', 'max'];
    for (const fn of binaryFunctions) {
      it(`accepts ${fn}(x, y) with numeric arguments`, () => {
        const src = [
          '# language: tickspec',
          '# kind: signal',
          '# name: test_' + fn,
          'inputs:',
          '  - x #number',
          '  - y #number',
          'output:',
          '  o: [-1,1]',
          'triggers:',
          '  - name: t',
          `    when: ${fn}(x, y) > 0`,
          '    emit:',
          '      - [true, 0.5]',
          '    priority: 0',
          '',
        ].join('\n');
        const { document } = parseTksp(src);
        expect(document).toBeDefined();
        if (!document) throw new Error('parse failed');
        const diags = validate(document);
        expect(diags.errors()).toEqual([]);
      });

      it(`rejects ${fn}(x) with wrong arity`, () => {
        const src = [
          '# language: tickspec',
          '# kind: signal',
          '# name: test_' + fn + '_arity',
          'inputs:',
          '  - x #number',
          'output:',
          '  o: [-1,1]',
          'triggers:',
          '  - name: t',
          `    when: ${fn}(x)`,
          '    emit:',
          '      - [true, 0.5]',
          '    priority: 0',
          '',
        ].join('\n');
        const { document } = parseTksp(src);
        expect(document).toBeDefined();
        if (!document) throw new Error('parse failed');
        const diags = validate(document);
        expect(diags.errors().some((d) => d.code === 'ARITY')).toBe(true);
      });
    }
  });
});
