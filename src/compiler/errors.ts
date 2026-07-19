import type { Diagnostic, Severity, SourceSpan } from './types.js';

export class DiagnosticCollector {
  private diagnostics: Diagnostic[] = [];

  push(
    severity: Severity,
    code: string,
    message: string,
    span?: SourceSpan,
    file?: string,
  ): void {
    this.diagnostics.push({ severity, code, message, span, file });
  }

  error(code: string, message: string, span?: SourceSpan, file?: string): void {
    this.push('error', code, message, span, file);
  }

  warn(code: string, message: string, span?: SourceSpan, file?: string): void {
    this.push('warning', code, message, span, file);
  }

  note(code: string, message: string, span?: SourceSpan, file?: string): void {
    this.push('note', code, message, span, file);
  }

  hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === 'error');
  }

  getDiagnostics(): Diagnostic[] {
    return [...this.diagnostics];
  }

  errors(): Diagnostic[] {
    return this.diagnostics.filter((d) => d.severity === 'error');
  }

  formatDiagnostic(d: Diagnostic): string {
    const loc = d.span
      ? `${d.span.start.line}:${d.span.start.col}`
      : '?';
    const prefix = `${d.file ?? '<unknown>'}:${loc}`;
    return `${prefix} ${d.severity} [${d.code}]: ${d.message}`;
  }

  formatAll(): string {
    return this.diagnostics.map((d) => this.formatDiagnostic(d)).join('\n');
  }

  extend(other: DiagnosticCollector): void {
    for (const d of other.getDiagnostics()) this.diagnostics.push(d);
  }
}

export class ParseError extends Error {
  public readonly diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = 'ParseError';
    this.diagnostics = diagnostics;
  }
}

export class ValidationError extends Error {
  public readonly diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.diagnostics = diagnostics;
  }
}
