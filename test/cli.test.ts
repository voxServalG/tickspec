import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const cli = resolve(repoRoot, 'src/cli.ts');
const fixture = (name: string) => resolve(__dirname, 'fixtures', name);

const run = (args: string[], cwd = repoRoot) =>
  spawnSync('node', ['--import', 'tsx', cli, ...args], { cwd, encoding: 'utf8' });

describe('cli', () => {
  const outPath = '/tmp/qqq-test.ir.json';
  afterAll(() => {
    try { if (existsSync(outPath)) rmSync(outPath); } catch { /* noop */ }
  });

  it('exposes --help with parse/validate/compile', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/parse/);
    expect(out).toMatch(/validate/);
    expect(out).toMatch(/compile/);
  });

  it('validate exits 0 for a legal signal fixture', () => {
    const r = run(['validate', fixture('qqq_signal.tksp')]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/ok/);
  });

  it('validate exits non-zero for bad-missing-kind fixture', () => {
    const r = run(['validate', fixture('bad-missing-kind.tksp')]);
    expect(r.status).not.toBe(0);
  });

  it('compile writes IR JSON to -o path and output is parseable JSON', () => {
    const r = run(['compile', fixture('qqq_signal.tksp'), '-o', outPath]);
    expect(r.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const json = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(json.kind).toBe('signal');
    expect(json.language).toBe('tickspec');
  });
});
