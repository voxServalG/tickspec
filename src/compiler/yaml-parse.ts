import { parseDocument, isSeq, isMap, isScalar, LineCounter } from 'yaml';
import type { Document, ParsedNode, YAMLMap, YAMLSeq, Scalar, Pair } from 'yaml';
import type {
  CombineDecl,
  EmitBranch,
  FactorType,
  FileKind,
  InputDecl,
  Operation,
  OutputDecl,
  ParsedDocument,
  ParsedSignal,
  ParsedStrategy,
  ScheduledCheck,
  SourcePos,
  Trigger,
} from './types.js';
import { extractMetadata, offsetToPos } from './metadata.js';
import { parseExpr, ExprParseError } from './expr-parser.js';
import { DiagnosticCollector } from './errors.js';

const VALID_FACTOR_TYPES: ReadonlySet<string> = new Set(['number', 'bool', 'enum', 'ordinal']);
const VALID_DIRECTIONS: ReadonlySet<string> = new Set(['buy', 'sell']);

export interface ParseResult {
  document?: ParsedDocument;
  diagnostics: DiagnosticCollector;
}

export function parseTksp(source: string, filename?: string): ParseResult {
  const diags = new DiagnosticCollector();
  const lineCounter = new LineCounter();
  const doc: Document.Parsed<ParsedNode> = parseDocument(source, {
    lineCounter,
    keepSourceTokens: true,
    version: '1.2',
  });

  for (const err of doc.errors) {
    const pos = err.pos ? offsetToPos(source, err.pos[0]) : { line: 0, col: 0 };
    diags.error('YAML_PARSE', `YAML parse error: ${err.message}`, { start: pos }, filename);
  }

  const { metadata, errors: metaErrors } = extractMetadata(doc, source);
  for (const e of metaErrors) diags.error('METADATA', e.message, e.span, filename);
  if (!metadata.language || metadata.language !== 'tickspec') {
    diags.error('METADATA_LANGUAGE', 'missing or invalid "# language: tickspec" header', undefined, filename);
  }
  if (!metadata.kind) diags.error('METADATA_KIND', 'missing "# kind: signal|strategy" header', undefined, filename);
  if (!metadata.name) diags.error('METADATA_NAME', 'missing "# name: <name>" header', undefined, filename);

  if (diags.hasErrors() || !metadata.kind || !metadata.name) return { diagnostics: diags };

  const kind: FileKind = metadata.kind;
  try {
    const document: ParsedDocument =
      kind === 'signal'
        ? parseSignal(doc, source, metadata.name, diags, filename)
        : parseStrategy(doc, source, metadata.name, diags, filename);
    if (diags.hasErrors()) return { diagnostics: diags };
    return { document, diagnostics: diags };
  } catch (e) {
    if (e instanceof ExprParseError) diags.error('EXPR_PARSE', e.message, e.span, filename);
    else if (e instanceof Error) diags.error('INTERNAL', `parser internal error: ${e.message}`, undefined, filename);
    return { diagnostics: diags };
  }
}

function posOf(doc: Document.Parsed<ParsedNode>, node: unknown): SourcePos | undefined {
  if (node && typeof node === 'object' && 'range' in node) {
    const range = (node as { range?: [number, number, number] }).range;
    if (range && range[0] !== undefined) {
      const src = doc.toString();
      return offsetToPos(src, range[0]);
    }
  }
  return undefined;
}

function parseInlineAnnotated(s: string): { name: string; typeAnnotation?: string; description?: string } {
  const hashIdx = s.indexOf('#');
  let before: string;
  let after = '';
  if (hashIdx === -1) before = s;
  else { before = s.slice(0, hashIdx); after = s.slice(hashIdx + 1); }
  const name = before.trim();
  if (!after.trim()) return { name };
  const typeMatch = after.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/);
  const typeAnnotation = typeMatch ? typeMatch[1] : undefined;
  const description = after.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*/, '').trim() || undefined;
  return { name, typeAnnotation, description };
}

function spanOf(doc: Document.Parsed<ParsedNode>, node: unknown): { start: SourcePos } | undefined {
  const p = posOf(doc, node);
  return p ? { start: p } : undefined;
}

function parseInputs(
  doc: Document.Parsed<ParsedNode>,
  source: string,
  diags: DiagnosticCollector,
  filename?: string,
): InputDecl[] {
  const inputsNode = doc.get('inputs', true);
  if (inputsNode === undefined || inputsNode === null) {
    diags.error('INPUTS_MISSING', 'missing "inputs:" section', undefined, filename);
    return [];
  }
  if (!isSeq(inputsNode)) {
    diags.error('INPUTS_NOT_SEQ', '"inputs:" must be a sequence', spanOf(doc, inputsNode), filename);
    return [];
  }
  const inputs: InputDecl[] = [];
  for (const item of (inputsNode as YAMLSeq).items) {
    if (!isScalar(item) || typeof (item as Scalar).value !== 'string') {
      diags.error('INPUT_NOT_SCALAR', 'each input must be a scalar string', spanOf(doc, item), filename);
      continue;
    }
    const nameValue = (item as Scalar).value as string;
    const trailingComment = (item as Scalar).comment;
    const pseudoRaw = trailingComment ? `${nameValue} #${trailingComment.trim()}` : nameValue;
    const { name, typeAnnotation, description } = parseInlineAnnotated(pseudoRaw);
    let type: FactorType = 'number';
    if (typeAnnotation) {
      if (!VALID_FACTOR_TYPES.has(typeAnnotation)) {
        diags.error('INPUT_TYPE_UNKNOWN', `unknown input type "${typeAnnotation}" for "${name}"`, spanOf(doc, item), filename);
        continue;
      }
      type = typeAnnotation as FactorType;
    } else {
      diags.warn('INPUT_TYPE_DEFAULT', `input "${name}" missing type; defaulting to "number"`, spanOf(doc, item), filename);
    }
    if (!name) {
      diags.error('INPUT_NAME_EMPTY', 'input name must not be empty', spanOf(doc, item), filename);
      continue;
    }
    inputs.push({ name, type, description, span: spanOf(doc, item) });
  }
  return inputs;
}

function parseOutput(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): OutputDecl {
  const fallback: OutputDecl = { range: [0, 1] };
  const outputNode = doc.get('output', true);
  if (outputNode === undefined || outputNode === null) {
    diags.error('OUTPUT_MISSING', 'missing "output:" section', undefined, filename);
    return fallback;
  }
  if (!isMap(outputNode)) {
    diags.error('OUTPUT_NOT_MAP', '"output:" must be a mapping', spanOf(doc, outputNode), filename);
    return fallback;
  }
  const oNode = (outputNode as YAMLMap).get('o', true);
  if (oNode === undefined || oNode === null) {
    diags.error('OUTPUT_O_MISSING', 'missing "output.o:" range', spanOf(doc, outputNode), filename);
    return fallback;
  }
  if (!isSeq(oNode)) {
    diags.error('OUTPUT_O_NOT_SEQ', '"output.o:" must be a sequence [min, max]', spanOf(doc, oNode), filename);
    return fallback;
  }
  const items = (oNode as YAMLSeq).items;
  if (items.length !== 2) {
    diags.error('OUTPUT_O_LENGTH', '"output.o:" must be exactly [min, max]', spanOf(doc, oNode), filename);
    return fallback;
  }
  const vals: number[] = [];
  for (const it of items) {
    if (!isScalar(it) || typeof (it as Scalar).value !== 'number') {
      diags.error('OUTPUT_O_NOT_NUMBER', '"output.o:" values must be numbers', spanOf(doc, it), filename);
      return fallback;
    }
    vals.push((it as Scalar).value as number);
  }
  const min = vals[0];
  const max = vals[1];
  if (typeof min !== 'number' || typeof max !== 'number' || !(min < max)) {
    diags.error('OUTPUT_O_RANGE', '"output.o:" requires min < max', spanOf(doc, oNode), filename);
    return fallback;
  }
  return { range: [min, max], span: spanOf(doc, oNode) };
}

function parseEvery(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return null;
}

function parseEmitNumber(
  emitNode: unknown,
  diags: DiagnosticCollector,
  scope: string,
  doc: Document.Parsed<ParsedNode>,
  filename?: string,
): EmitBranch<number>[] {
  if (!isSeq(emitNode)) {
    diags.error('EMIT_NOT_SEQ', `${scope}: "emit:" must be a sequence`, spanOf(doc, emitNode), filename);
    return [];
  }
  const branches: EmitBranch<number>[] = [];
  for (const item of (emitNode as YAMLSeq).items) {
    if (!isSeq(item)) {
      diags.error('EMIT_BRANCH_NOT_SEQ', `${scope}: each emit branch must be [cond, number]`, spanOf(doc, item), filename);
      continue;
    }
    const arr = item as YAMLSeq;
    if (arr.items.length < 2) {
      diags.error('EMIT_BRANCH_LENGTH', `${scope}: emit branch must have [cond, value]`, spanOf(doc, item), filename);
      continue;
    }
    const condNode = arr.items[0];
    const valNode = arr.items[1];
    let when;
    if (isScalar(condNode) && (condNode as Scalar).value === true) {
      when = { type: 'bool' as const, value: true, span: spanOf(doc, condNode) };
    } else if (!isScalar(condNode) || typeof (condNode as Scalar).value !== 'string') {
      diags.error('EMIT_COND_NOT_STRING', `${scope}: emit condition must be a string expression or true`, spanOf(doc, condNode), filename);
      continue;
    } else {
      const condStr = (condNode as Scalar).value as string;
      try { when = parseExpr(condStr); }
      catch (e) {
        if (e instanceof ExprParseError) diags.error('EXPR_PARSE', `${scope}: ${e.message}`, e.span, filename);
        else diags.error('EXPR_PARSE', `${scope}: expression parse error`, spanOf(doc, condNode), filename);
        continue;
      }
    }
    if (!isScalar(valNode) || typeof (valNode as Scalar).value !== 'number') {
      diags.error('EMIT_VALUE_NOT_NUMBER', `${scope}: emit value must be a number`, spanOf(doc, valNode), filename);
      continue;
    }
    const value = (valNode as Scalar).value as number;
    branches.push({ when, value, span: spanOf(doc, item) });
  }
  return branches;
}

function parseOperationValue(
  node: unknown,
  diags: DiagnosticCollector,
  scope: string,
  doc: Document.Parsed<ParsedNode>,
  filename?: string,
): Operation | null {
  if (isScalar(node)) {
    const v = (node as Scalar).value;
    if (v === 'hold') return { kind: 'hold' };
    diags.error('OP_SCALAR_INVALID', `${scope}: scalar operation must be "hold"`, spanOf(doc, node), filename);
    return null;
  }
  if (!isMap(node)) {
    diags.error('OP_NOT_MAP', `${scope}: operation must be "hold" or a map`, spanOf(doc, node), filename);
    return null;
  }
  const map = node as YAMLMap;
  const targetNode = map.get('target', true);
  const actionNode = map.get('action', true);
  const hasTarget = targetNode !== undefined && targetNode !== null;
  const hasAction = actionNode !== undefined && actionNode !== null;
  if (!hasTarget && !hasAction) {
    diags.error('OP_EMPTY', `${scope}: operation map must contain "target" and/or "action"`, spanOf(doc, node), filename);
    return null;
  }
  const target: Record<string, number> = {};
  const action: Record<string, { buy?: number; sell?: number }> = {};
  if (hasTarget) {
    if (!isMap(targetNode)) {
      diags.error('OP_TARGET_NOT_MAP', `${scope}: "target" must be a mapping of symbol -> weight`, spanOf(doc, targetNode), filename);
      return null;
    }
    for (const pair of (targetNode as YAMLMap).items as Pair[]) {
      const k = pair.key;
      const v = pair.value;
      if (!isScalar(k) || typeof (k as Scalar).value !== 'string') {
        diags.error('OP_TARGET_KEY', `${scope}: target symbol key must be string`, spanOf(doc, k), filename);
        return null;
      }
      const sym = (k as Scalar).value as string;
      if (!isScalar(v) || typeof (v as Scalar).value !== 'number') {
        diags.error('OP_TARGET_WEIGHT', `${scope}: target weight for "${sym}" must be a number`, spanOf(doc, v), filename);
        return null;
      }
      target[sym] = (v as Scalar).value as number;
    }
  }
  if (hasAction) {
    if (!isMap(actionNode)) {
      diags.error('OP_ACTION_NOT_MAP', `${scope}: "action" must be a mapping of symbol -> {buy,sell}`, spanOf(doc, actionNode), filename);
      return null;
    }
    for (const pair of (actionNode as YAMLMap).items as Pair[]) {
      const k = pair.key;
      const v = pair.value;
      if (!isScalar(k) || typeof (k as Scalar).value !== 'string') {
        diags.error('OP_ACTION_KEY', `${scope}: action symbol key must be string`, spanOf(doc, k), filename);
        return null;
      }
      const sym = (k as Scalar).value as string;
      if (!isMap(v)) {
        diags.error('OP_ACTION_VALUE_NOT_MAP', `${scope}: action value for "${sym}" must be a mapping {buy,sell}`, spanOf(doc, v), filename);
        return null;
      }
      const dirMap = v as YAMLMap;
      const rec: { buy?: number; sell?: number } = {};
      for (const dp of dirMap.items as Pair[]) {
        const dk = dp.key;
        const dv = dp.value;
        if (!isScalar(dk) || typeof (dk as Scalar).value !== 'string') {
          diags.error('OP_ACTION_DIR_KEY', `${scope}: action direction key for "${sym}" must be string`, spanOf(doc, dk), filename);
          return null;
        }
        const dir = (dk as Scalar).value as string;
        if (!VALID_DIRECTIONS.has(dir)) {
          diags.error('OP_ACTION_DIR_INVALID', `${scope}: action direction "${dir}" must be buy|sell`, spanOf(doc, dk), filename);
          return null;
        }
        if (!isScalar(dv) || typeof (dv as Scalar).value !== 'number') {
          diags.error('OP_ACTION_QTY', `${scope}: action ${dir} qty for "${sym}" must be a number`, spanOf(doc, dv), filename);
          return null;
        }
        rec[dir as 'buy' | 'sell'] = (dv as Scalar).value as number;
      }
      action[sym] = rec;
    }
  }
  if (hasTarget && hasAction) return { kind: 'mixed', target, action };
  if (hasTarget) return { kind: 'target', positions: target };
  return { kind: 'action', actions: action };
}

function parseEmitOperation(
  emitNode: unknown,
  diags: DiagnosticCollector,
  scope: string,
  doc: Document.Parsed<ParsedNode>,
  filename?: string,
): EmitBranch<Operation>[] {
  if (!isSeq(emitNode)) {
    diags.error('EMIT_NOT_SEQ', `${scope}: "emit:" must be a sequence`, spanOf(doc, emitNode), filename);
    return [];
  }
  const branches: EmitBranch<Operation>[] = [];
  for (const item of (emitNode as YAMLSeq).items) {
    if (!isSeq(item)) {
      diags.error('EMIT_BRANCH_NOT_SEQ', `${scope}: each emit branch must be [cond, operation]`, spanOf(doc, item), filename);
      continue;
    }
    const arr = item as YAMLSeq;
    if (arr.items.length < 2) {
      diags.error('EMIT_BRANCH_LENGTH', `${scope}: emit branch must have [cond, operation]`, spanOf(doc, item), filename);
      continue;
    }
    const condNode = arr.items[0];
    const valNode = arr.items[1];
    let when;
    if (isScalar(condNode) && (condNode as Scalar).value === true) {
      when = { type: 'bool' as const, value: true, span: spanOf(doc, condNode) };
    } else if (!isScalar(condNode) || typeof (condNode as Scalar).value !== 'string') {
      diags.error('EMIT_COND_NOT_STRING', `${scope}: emit condition must be a string expression or true`, spanOf(doc, condNode), filename);
      continue;
    } else {
      const condStr = (condNode as Scalar).value as string;
      try { when = parseExpr(condStr); }
      catch (e) {
        if (e instanceof ExprParseError) diags.error('EXPR_PARSE', `${scope}: ${e.message}`, e.span, filename);
        else diags.error('EXPR_PARSE', `${scope}: expression parse error`, spanOf(doc, condNode), filename);
        continue;
      }
    }
    const op = parseOperationValue(valNode, diags, scope, doc, filename);
    if (!op) continue;
    branches.push({ when, value: op, span: spanOf(doc, item) });
  }
  return branches;
}

function parseScheduledChecks<T>(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  parser: (emit: unknown, scope: string) => EmitBranch<T>[],
  filename?: string,
): ScheduledCheck<T>[] {
  const node = doc.get('scheduled_checks', true);
  if (node === undefined || node === null) return [];
  if (!isSeq(node)) {
    diags.error('SCHEDULED_NOT_SEQ', '"scheduled_checks:" must be a sequence', spanOf(doc, node), filename);
    return [];
  }
  const out: ScheduledCheck<T>[] = [];
  for (const item of (node as YAMLSeq).items) {
    if (!isMap(item)) {
      diags.error('SCHEDULED_ITEM_NOT_MAP', 'each scheduled_check must be a map', spanOf(doc, item), filename);
      continue;
    }
    const m = item as YAMLMap;
    const nameNode = m.get('name', true);
    const everyNode = m.get('every', true);
    const emitNode = m.get('emit', true);
    if (!isScalar(nameNode) || typeof (nameNode as Scalar).value !== 'string') {
      diags.error('SCHEDULED_NAME', 'scheduled_check "name" must be a string', spanOf(doc, nameNode ?? item), filename);
      continue;
    }
    const name = (nameNode as Scalar).value as string;
    const every = parseEvery(isScalar(everyNode) ? (everyNode as Scalar).value : undefined);
    if (!every) {
      diags.error('SCHEDULED_EVERY', `scheduled_check "${name}" requires string "every"`, spanOf(doc, everyNode ?? item), filename);
      continue;
    }
    if (emitNode === undefined || emitNode === null) {
      diags.error('SCHEDULED_EMIT', `scheduled_check "${name}" requires "emit:"`, spanOf(doc, item), filename);
      continue;
    }
    const emit = parser(emitNode, `scheduled_check "${name}"`);
    if (emit.length === 0 && diags.hasErrors()) continue;
    out.push({ name, every, emit, span: spanOf(doc, item) });
  }
  return out;
}

function parseScheduledNumber(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): ScheduledCheck<number>[] {
  return parseScheduledChecks<number>(
    doc,
    diags,
    (emit, scope) => parseEmitNumber(emit, diags, scope, doc, filename),
    filename,
  );
}

function parseScheduledOperation(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): ScheduledCheck<Operation>[] {
  return parseScheduledChecks<Operation>(
    doc,
    diags,
    (emit, scope) => parseEmitOperation(emit, diags, scope, doc, filename),
    filename,
  );
}

function detectTriggerKind(whenSrc: string): 'edge' | 'level' {
  return /\bcross_over\s*\(/.test(whenSrc) ? 'edge' : 'level';
}

function parseTriggers<T>(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  parser: (emit: unknown, scope: string) => EmitBranch<T>[],
  filename?: string,
): Trigger<T>[] {
  const node = doc.get('triggers', true);
  if (node === undefined || node === null) return [];
  if (!isSeq(node)) {
    diags.error('TRIGGER_NOT_SEQ', '"triggers:" must be a sequence', spanOf(doc, node), filename);
    return [];
  }
  const out: Trigger<T>[] = [];
  for (const item of (node as YAMLSeq).items) {
    if (!isMap(item)) {
      diags.error('TRIGGER_ITEM_NOT_MAP', 'each trigger must be a map', spanOf(doc, item), filename);
      continue;
    }
    const m = item as YAMLMap;
    const nameNode = m.get('name', true);
    const whenNode = m.get('when', true);
    const emitNode = m.get('emit', true);
    const prioNode = m.get('priority', true);
    if (!isScalar(nameNode) || typeof (nameNode as Scalar).value !== 'string') {
      diags.error('TRIGGER_NAME', 'trigger "name" must be a string', spanOf(doc, nameNode ?? item), filename);
      continue;
    }
    const name = (nameNode as Scalar).value as string;
    if (!isScalar(whenNode) || typeof (whenNode as Scalar).value !== 'string') {
      diags.error('TRIGGER_WHEN', `trigger "${name}" requires string "when"`, spanOf(doc, whenNode ?? item), filename);
      continue;
    }
    const whenSrc = (whenNode as Scalar).value as string;
    let when;
    try { when = parseExpr(whenSrc); }
    catch (e) {
      if (e instanceof ExprParseError) diags.error('EXPR_PARSE', `trigger "${name}": ${e.message}`, e.span, filename);
      else diags.error('EXPR_PARSE', `trigger "${name}": expression parse error`, spanOf(doc, whenNode), filename);
      continue;
    }
    if (emitNode === undefined || emitNode === null) {
      diags.error('TRIGGER_EMIT', `trigger "${name}" requires "emit:"`, spanOf(doc, item), filename);
      continue;
    }
    const emit = parser(emitNode, `trigger "${name}"`);
    let priority = 0;
    if (prioNode !== undefined && prioNode !== null) {
      const prioVal = isScalar(prioNode) ? (prioNode as Scalar).value : undefined;
      if (typeof prioVal !== 'number' || !Number.isInteger(prioVal) || prioVal < 0) {
        diags.error('TRIGGER_PRIORITY_INVALID', `trigger "${name}" priority must be non-negative integer`, spanOf(doc, prioNode), filename);
        continue;
      }
      priority = prioVal;
    }
    const kind = detectTriggerKind(whenSrc);
    out.push({ name, when, emit, priority, kind, span: spanOf(doc, item) });
  }
  return out;
}

function parseTriggersNumber(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): Trigger<number>[] {
  return parseTriggers<number>(
    doc,
    diags,
    (emit, scope) => parseEmitNumber(emit, diags, scope, doc, filename),
    filename,
  );
}

function parseTriggersOperation(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): Trigger<Operation>[] {
  return parseTriggers<Operation>(
    doc,
    diags,
    (emit, scope) => parseEmitOperation(emit, diags, scope, doc, filename),
    filename,
  );
}

function parseCombine(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): CombineDecl[] {
  const node = doc.get('combine', true);
  if (node === undefined || node === null) {
    diags.error('COMBINE_MISSING', 'missing "combine:" section', undefined, filename);
    return [];
  }
  if (!isSeq(node)) {
    diags.error('COMBINE_NOT_SEQ', '"combine:" must be a sequence', spanOf(doc, node), filename);
    return [];
  }
  const out: CombineDecl[] = [];
  for (const item of (node as YAMLSeq).items) {
    if (!isMap(item)) {
      diags.error('COMBINE_ITEM_NOT_MAP', 'each combine item must be a map {name: expr}', spanOf(doc, item), filename);
      continue;
    }
    const m = item as YAMLMap;
    const pairs = m.items as Pair[];
    if (pairs.length !== 1 || !pairs[0]) {
      diags.error('COMBINE_ITEM_SINGLE_KEY', 'each combine item must have exactly one key', spanOf(doc, item), filename);
      continue;
    }
    const p = pairs[0];
    const k = p.key;
    const v = p.value;
    if (!isScalar(k) || typeof (k as Scalar).value !== 'string') {
      diags.error('COMBINE_KEY', 'combine key must be a string', spanOf(doc, k), filename);
      continue;
    }
    const name = (k as Scalar).value as string;
    if (!isScalar(v) || typeof (v as Scalar).value !== 'string') {
      diags.error('COMBINE_EXPR_NOT_STRING', `combine "${name}" expr must be a string`, spanOf(doc, v), filename);
      continue;
    }
    const exprStr = (v as Scalar).value as string;
    let expr;
    try { expr = parseExpr(exprStr); }
    catch (e) {
      if (e instanceof ExprParseError) diags.error('EXPR_PARSE', `combine "${name}": ${e.message}`, e.span, filename);
      else diags.error('EXPR_PARSE', `combine "${name}": expression parse error`, spanOf(doc, v), filename);
      continue;
    }
    out.push({ name, expr, span: spanOf(doc, item) });
  }
  return out;
}

function parseSignalsList(
  doc: Document.Parsed<ParsedNode>,
  diags: DiagnosticCollector,
  filename?: string,
): string[] {
  const node = doc.get('signals', true);
  if (node === undefined || node === null) {
    diags.error('SIGNALS_MISSING', 'missing "signals:" section', undefined, filename);
    return [];
  }
  if (!isSeq(node)) {
    diags.error('SIGNALS_NOT_SEQ', '"signals:" must be a sequence of strings', spanOf(doc, node), filename);
    return [];
  }
  const out: string[] = [];
  for (const item of (node as YAMLSeq).items) {
    if (!isScalar(item) || typeof (item as Scalar).value !== 'string') {
      diags.error('SIGNAL_NOT_STRING', 'each signal must be a string name', spanOf(doc, item), filename);
      continue;
    }
    out.push((item as Scalar).value as string);
  }
  return out;
}

function parseSignal(
  doc: Document.Parsed<ParsedNode>,
  source: string,
  name: string,
  diags: DiagnosticCollector,
  filename?: string,
): ParsedSignal {
  const inputs = parseInputs(doc, source, diags, filename);
  const output = parseOutput(doc, diags, filename);
  const scheduledChecks = parseScheduledNumber(doc, diags, filename);
  const triggers = parseTriggersNumber(doc, diags, filename);
  return {
    kind: 'signal',
    name,
    inputs,
    output,
    scheduledChecks,
    triggers,
  };
}

function parseStrategy(
  doc: Document.Parsed<ParsedNode>,
  source: string,
  name: string,
  diags: DiagnosticCollector,
  filename?: string,
): ParsedStrategy {
  void source;
  const signals = parseSignalsList(doc, diags, filename);
  const combine = parseCombine(doc, diags, filename);
  const scheduledChecks = parseScheduledOperation(doc, diags, filename);
  const triggers = parseTriggersOperation(doc, diags, filename);
  return {
    kind: 'strategy',
    name,
    signals,
    combine,
    scheduledChecks,
    triggers,
  };
}
