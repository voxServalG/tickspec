import { describe, it, expect } from 'vitest';
import { parseTksp } from '../src/compiler/yaml-parse.js';

describe('metadata', () => {
  const fullBody = `
inputs:
  - x
output:
  o: [-1, 1]
scheduled_checks:
  - name: c
    every: 1d
    emit:
      - [x < 0, 0]
`;

  it('parses valid signal metadata', () => {
    const src = `# language: tickspec\n# kind: signal\n# name: foo\n${fullBody}`;
    const { document, diagnostics } = parseTksp(src);
    expect(document).toBeDefined();
    expect(document?.kind).toBe('signal');
    expect(document?.name).toBe('foo');
    expect(diagnostics.errors()).toEqual([]);
  });

  it('emits METADATA_LANGUAGE when language header missing', () => {
    const src = `# kind: signal\n# name: foo\n${fullBody}`;
    const { diagnostics } = parseTksp(src);
    expect(diagnostics.getDiagnostics().some((d) => d.code === 'METADATA_LANGUAGE')).toBe(true);
  });

  it('emits METADATA_KIND when kind header missing', () => {
    const src = `# language: tickspec\n# name: foo\n${fullBody}`;
    const { diagnostics } = parseTksp(src);
    expect(diagnostics.getDiagnostics().some((d) => d.code === 'METADATA_KIND')).toBe(true);
  });

  it('emits METADATA_NAME when name header missing', () => {
    const src = `# language: tickspec\n# kind: signal\n${fullBody}`;
    const { diagnostics } = parseTksp(src);
    expect(diagnostics.getDiagnostics().some((d) => d.code === 'METADATA_NAME')).toBe(true);
  });

  it('flags invalid kind value', () => {
    const src = `# language: tickspec\n# kind: widget\n# name: foo\n${fullBody}`;
    const { diagnostics, document } = parseTksp(src);
    expect(document).toBeUndefined();
    expect(diagnostics.getDiagnostics().some((d) => d.code === 'METADATA_KIND' || d.code === 'METADATA')).toBe(true);
  });
});
