#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { Command } from 'commander';
import { parseTksp, compileSource } from './compiler/index.js';
import type { DiagnosticCollector } from './compiler/errors.js';

function readSource(filepath: string): { source?: string; diagnostics?: string } {
  try {
    if (!existsSync(filepath)) {
      return { diagnostics: `${filepath}: file not found` };
    }
    return { source: readFileSync(filepath, 'utf8') };
  } catch (e) {
    return { diagnostics: `${filepath}: ${(e as Error).message}` };
  }
}

function countBy(diags: DiagnosticCollector): { errors: number; warnings: number } {
  const all = diags.getDiagnostics();
  let errors = 0;
  let warnings = 0;
  for (const d of all) {
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
  }
  return { errors, warnings };
}

function formatJSON(value: unknown, pretty: boolean): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

const program = new Command();
program
  .name('tickspec')
  .description('Tickspec DSL compiler')
  .version('0.1.0')
  .option('--no-color', 'disable color');

program
  .command('parse')
  .description('Parse .tksp files and dump YAML parse tree + AST as JSON')
  .argument('<files...>', 'files to parse')
  .option('--pretty', 'pretty JSON output', true)
  .action((files: string[], opts: { pretty: boolean }) => {
    let hadError = false;
    for (const file of files) {
      const { source, diagnostics } = readSource(file);
      if (diagnostics) {
        process.stderr.write(diagnostics + '\n');
        hadError = true;
        continue;
      }
      const result = parseTksp(source!, file);
      if (result.diagnostics.hasErrors()) {
        process.stderr.write(result.diagnostics.formatAll() + '\n');
        hadError = true;
        continue;
      }
      const warnings = result.diagnostics
        .getDiagnostics()
        .filter((d: { severity: string }) => d.severity === 'warning' || d.severity === 'note');
      if (warnings.length > 0) {
        process.stderr.write(result.diagnostics.formatAll() + '\n');
      }
      process.stdout.write(formatJSON(result.document, opts.pretty) + '\n');
    }
    if (hadError) process.exit(1);
  });

program
  .command('validate')
  .description('Validate .tksp files; exit 0 if no errors, exit 1 otherwise')
  .argument('<files...>', 'files to validate')
  .action((files: string[]) => {
    let totalErrors = 0;
    let totalWarnings = 0;
    let hadError = false;
    for (const file of files) {
      const { source, diagnostics } = readSource(file);
      if (diagnostics) {
        process.stderr.write(diagnostics + '\n');
        hadError = true;
        totalErrors++;
        continue;
      }
      const result = compileSource(source!, file);
      const { errors, warnings } = countBy(result.diagnostics);
      totalErrors += errors;
      totalWarnings += warnings;
      if (errors > 0) {
        hadError = true;
        process.stderr.write(result.diagnostics.formatAll() + '\n');
        process.stderr.write(`\u2717 ${file}: ${errors} error(s), ${warnings} warning(s)\n`);
      } else {
        process.stdout.write(`\u2713 ${file}: ok` + (warnings > 0 ? ` (${warnings} warning(s))` : '') + '\n');
        if (warnings > 0) process.stderr.write(result.diagnostics.formatAll() + '\n');
      }
    }
    process.stderr.write(`\n${totalErrors} error(s), ${totalWarnings} warning(s)\n`);
    if (hadError) process.exit(1);
  });

program
  .command('compile')
  .description('Compile .tksp to Canonical JSON IR')
  .argument('<files...>', 'files to compile')
  .option('-o, --out <file>', 'output file (single file only)')
  .option('--pretty', 'pretty JSON output', true)
  .action((files: string[], opts: { out?: string; pretty: boolean }) => {
    if (opts.out && files.length > 1) {
      process.stderr.write('error: cannot use -o/--out with multiple input files\n');
      process.exit(1);
    }
    let hadError = false;
    for (const file of files) {
      const { source, diagnostics } = readSource(file);
      if (diagnostics) {
        process.stderr.write(diagnostics + '\n');
        hadError = true;
        continue;
      }
      const result = compileSource(source!, file);
      if (result.diagnostics.hasErrors() || !result.ir) {
        process.stderr.write(result.diagnostics.formatAll() + '\n');
        hadError = true;
        continue;
      }
      const warnings = result.diagnostics
        .getDiagnostics()
        .filter((d: { severity: string }) => d.severity === 'warning' || d.severity === 'note');
      if (warnings.length > 0) {
        process.stderr.write(result.diagnostics.formatAll() + '\n');
      }
      const json = formatJSON(result.ir, opts.pretty);
      if (opts.out) {
        writeFileSync(opts.out, json + '\n', 'utf8');
      } else if (files.length === 1 && !process.stdout.isTTY) {
        process.stdout.write(json + '\n');
      } else {
        const dir = dirname(file);
        const base = basename(file).replace(/\.tksp$/, '');
        const outPath = join(dir, `${base}.ir.json`);
        writeFileSync(outPath, json + '\n', 'utf8');
        process.stdout.write(`${file} -> ${outPath}\n`);
      }
    }
    if (hadError) process.exit(1);
  });

program.parse(process.argv);
