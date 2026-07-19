import { readFileSync } from 'node:fs';
import type { ParsedDocument, DocumentIR } from './types.js';
import type { DiagnosticCollector } from './errors.js';
import { ParseError, ValidationError } from './errors.js';
import { parseTksp } from './yaml-parse.js';
import { validate } from './validator.js';
import { toIR } from './ir.js';

export interface CompileResult {
  ir?: DocumentIR;
  parsed?: ParsedDocument;
  diagnostics: DiagnosticCollector;
}

export function parseSource(source: string, filename?: string): { parsed?: ParsedDocument; diagnostics: DiagnosticCollector } {
  void ParseError;
  const result = parseTksp(source, filename);
  return { parsed: result.document, diagnostics: result.diagnostics };
}

export function compileSource(source: string, filename?: string): CompileResult {
  void ValidationError;
  const { parsed, diagnostics } = parseSource(source, filename);
  if (!parsed || diagnostics.hasErrors()) {
    return { diagnostics };
  }
  const valDiags = validate(parsed, filename);
  diagnostics.extend(valDiags);
  if (diagnostics.hasErrors()) {
    return { parsed, diagnostics };
  }
  const ir = toIR(parsed);
  return { ir, parsed, diagnostics };
}

export function compileFile(filepath: string): CompileResult {
  const source = readFileSync(filepath, 'utf8');
  return compileSource(source, filepath);
}
