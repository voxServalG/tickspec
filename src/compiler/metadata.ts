import type { Document, ParsedNode } from 'yaml';
import type { FileKind, SourcePos, SourceSpan } from './types.js';

export interface Metadata {
  language: string;
  kind: FileKind;
  name: string;
}

export function extractMetadata(doc: Document.Parsed<ParsedNode>, source: string): {
  metadata: Partial<Metadata>;
  errors: { code: string; message: string; span?: SourceSpan }[];
} {
  const errors: { code: string; message: string; span?: SourceSpan }[] = [];
  const result: Partial<Metadata> = {};
  const lines = source.split('\n');
  const metadataKeys = new Set(['language', 'kind', 'name']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('#')) {
      if (trimmed === '' || trimmed.startsWith('#!')) {
        continue;
      }
      if (i > 0 && result.kind && result.language && result.name) {
        break;
      }
    }
    const hashIdx = line.indexOf('#');
    if (hashIdx === -1) continue;
    const after = line.slice(hashIdx + 1);
    const colonIdx = after.indexOf(':');
    if (colonIdx === -1) continue;
    const key = after.slice(0, colonIdx).trim();
    if (!metadataKeys.has(key)) continue;
    const value = after.slice(colonIdx + 1).trim();
    if (!value) {
      errors.push({
        code: 'METADATA_EMPTY',
        message: `metadata header "# ${key}:" has empty value`,
        span: { start: { line: i + 1, col: 1 }, end: { line: i + 1, col: line.length } },
      });
      continue;
    }
    const valueOnly = value.split('#')[0]!.trim();
    if (key === 'language') {
      result.language = valueOnly;
    } else if (key === 'kind') {
      if (valueOnly !== 'signal' && valueOnly !== 'strategy') {
        errors.push({
          code: 'METADATA_KIND_INVALID',
          message: `kind must be "signal" or "strategy", got "${valueOnly}"`,
          span: { start: { line: i + 1, col: 1 }, end: { line: i + 1, col: line.length } },
        });
      } else {
        result.kind = valueOnly;
      }
    } else if (key === 'name') {
      result.name = valueOnly;
    }
  }

  void doc;
  return { metadata: result, errors };
}

export function offsetToPos(source: string, offset: number): SourcePos {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
