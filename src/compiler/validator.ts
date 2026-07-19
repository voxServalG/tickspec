import type {
  ParsedDocument,
  ParsedSignal,
  ParsedStrategy,
  Expr,
  BinOp,
  SourceSpan,
  Operation,
} from './types.js';
import { DiagnosticCollector } from './errors.js';

type ValType = 'number' | 'bool' | 'unknown';
type RefCtx = Record<string, ValType>;

export function walkExpr(expr: Expr, fn: (e: Expr) => void): void {
  fn(expr);
  if (expr.type === 'unary') {
    walkExpr(expr.operand, fn);
  } else if (expr.type === 'binary') {
    walkExpr(expr.left, fn);
    walkExpr(expr.right, fn);
  } else if (expr.type === 'call') {
    for (const a of expr.args) walkExpr(a, fn);
  }
}

export function inferExprType(expr: Expr, ctx: RefCtx): ValType {
  if (expr.type === 'number') return 'number';
  if (expr.type === 'bool') return 'bool';
  if (expr.type === 'ref') return ctx[expr.name] ?? 'unknown';
  if (expr.type === 'unary') {
    if (expr.op === '-') {
      const t = inferExprType(expr.operand, ctx);
      return t === 'bool' ? 'unknown' : t;
    }
    return inferExprType(expr.operand, ctx) === 'bool' ? 'bool' : 'unknown';
  }
  if (expr.type === 'binary') {
    return inferBinType(expr.op, expr.left, expr.right, ctx);
  }
  if (expr.name === 'cross_over' || expr.name === 'clamp') return 'number';
  return 'unknown';
}

function isArith(op: BinOp): boolean {
  return op === '+' || op === '-' || op === '*' || op === '/';
}
function isCmp(op: BinOp): boolean {
  return op === '<' || op === '<=' || op === '>' || op === '>=';
}
function isEq(op: BinOp): boolean {
  return op === '==' || op === '!=';
}
function isLogic(op: BinOp): op is 'and' | 'or' {
  return op === 'and' || op === 'or';
}

function inferBinType(op: BinOp, l: Expr, r: Expr, ctx: RefCtx): ValType {
  const lt = inferExprType(l, ctx);
  const rt = inferExprType(r, ctx);
  if (isArith(op)) {
    if (lt === 'number' && rt === 'number') return 'number';
    return 'unknown';
  }
  if (isCmp(op)) {
    if (lt === 'number' && rt === 'number') return 'bool';
    return 'unknown';
  }
  if (isEq(op)) {
    if (lt === 'unknown' || rt === 'unknown') return 'unknown';
    if (lt === rt) return 'bool';
    return 'unknown';
  }
  if (isLogic(op)) {
    if (lt === 'bool' && rt === 'bool') return 'bool';
    return 'unknown';
  }
  return 'unknown';
}

export interface SimpleRange {
  var: string;
  op: BinOp;
  value: number;
}

export function extractSimpleRange(expr: Expr): SimpleRange | null {
  if (expr.type !== 'binary') return null;
  const op = expr.op;
  if (!isCmp(op)) return null;
  const evalConst = (e: Expr): number | null => {
    if (e.type === 'number') return e.value;
    if (e.type === 'unary' && e.op === '-' && e.operand.type === 'number') return -e.operand.value;
    return null;
  };
  if (expr.left.type === 'ref') {
    const v = evalConst(expr.right);
    if (v !== null) return { var: expr.left.name, op, value: v };
  }
  if (expr.right.type === 'ref') {
    const v = evalConst(expr.left);
    if (v !== null) {
      const flipLess: Record<string, BinOp> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
      const flipped = flipLess[op];
      if (flipped) return { var: expr.right.name, op: flipped, value: v };
    }
  }
  return null;
}

interface Interval { lo: number; hi: number; loInc: boolean; hiInc: boolean; }

function allReals(): Interval {
  return { lo: -Infinity, hi: Infinity, loInc: false, hiInc: false };
}

function intervalFromRange(r: SimpleRange): Interval {
  if (r.op === '<') return { lo: -Infinity, hi: r.value, loInc: false, hiInc: false };
  if (r.op === '<=') return { lo: -Infinity, hi: r.value, loInc: false, hiInc: true };
  if (r.op === '>') return { lo: r.value, hi: Infinity, loInc: false, hiInc: false };
  if (r.op === '>=') return { lo: r.value, hi: Infinity, loInc: true, hiInc: false };
  return allReals();
}

function intervalsOverlap(a: Interval, b: Interval): boolean {
  if (a.hi < b.lo || b.hi < a.lo) return false;
  if (a.hi === b.lo) return a.hiInc && b.loInc;
  if (b.hi === a.lo) return b.hiInc && a.loInc;
  return true;
}

function intervalsCoverReals(intervals: readonly Interval[]): boolean {
  if (intervals.length === 0) return false;
  const sorted = intervals
    .map((iv) => ({ ...iv }))
    .sort((x, y) => (x.lo === y.lo ? 0 : x.lo < y.lo ? -1 : 1));
  const first = sorted[0];
  if (first?.lo !== -Infinity) return false;
  let curHi = first.hi;
  let curHiInc = first.hiInc;
  for (let i = 1; i < sorted.length; i++) {
    const nxt = sorted[i];
    if (!nxt || nxt.lo === -Infinity) return false;
    if (nxt.lo > curHi) return false;
    if (nxt.lo === curHi && !(nxt.loInc && curHiInc)) return false;
    if (nxt.hi > curHi || (nxt.hi === curHi && nxt.hiInc)) {
      curHi = nxt.hi;
      curHiInc = nxt.hiInc;
    }
  }
  return curHi === Infinity;
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function validate(doc: ParsedDocument, filename?: string): DiagnosticCollector {
  const diags = new DiagnosticCollector();
  if (doc.kind === 'signal') validateSignal(doc, diags, filename);
  else validateStrategy(doc, diags, filename);
  return diags;
}

function checkExpr(
  expr: Expr,
  ctx: RefCtx,
  diags: DiagnosticCollector,
  filename: string | undefined,
): void {
  walkExpr(expr, (e) => {
    if (e.type === 'ref') {
      if (!(e.name in ctx)) {
        diags.error('UNDEFINED_REF', `undefined reference "${e.name}"`, e.span, filename);
      }
      return;
    }
    if (e.type === 'unary') {
      const t = inferExprType(e.operand, ctx);
      if (e.op === '-') {
        if (t === 'bool') diags.error('TYPE_MISMATCH', 'unary "-" requires numeric operand', e.span, filename);
      } else if (t === 'number') {
        diags.error('TYPE_MISMATCH', '"!" requires bool operand', e.span, filename);
      }
      return;
    }
    if (e.type === 'binary') {
      const lt = inferExprType(e.left, ctx);
      const rt = inferExprType(e.right, ctx);
      const op = e.op;
      if (isArith(op) || isCmp(op)) {
        if (lt !== 'number' || rt !== 'number') {
          diags.error('TYPE_MISMATCH', `"${op}" requires numeric operands`, e.span, filename);
        }
      } else if (isEq(op)) {
        if (lt !== 'unknown' && rt !== 'unknown' && lt !== rt) {
          diags.error('TYPE_MISMATCH', `"${op}" requires same-type operands`, e.span, filename);
        }
      } else if (isLogic(op)) {
        if (lt !== 'bool' || rt !== 'bool') {
          diags.error('TYPE_MISMATCH', `"${op}" requires bool operands`, e.span, filename);
        }
      }
      return;
    }
    if (e.type === 'call') {
      if (e.name === 'cross_over') {
        if (e.args.length !== 2) {
          diags.error('CROSS_OVER_ARITY', 'cross_over requires exactly 2 arguments', e.span, filename);
        } else {
          const a0 = e.args[0];
          const a1 = e.args[1];
          if (a0 && a1 && (inferExprType(a0, ctx) !== 'number' || inferExprType(a1, ctx) !== 'number')) {
            diags.error('TYPE_MISMATCH', 'cross_over arguments must be numeric', e.span, filename);
          }
        }
      } else if (e.name === 'clamp') {
        if (e.args.length !== 3) {
          diags.error('CLAMP_ARITY', 'clamp requires exactly 3 arguments', e.span, filename);
        } else {
          let bad = false;
          for (const a of e.args) {
            if (inferExprType(a, ctx) !== 'number') { bad = true; break; }
          }
          if (bad) diags.error('TYPE_MISMATCH', 'clamp arguments must be numeric', e.span, filename);
        }
      } else {
        diags.error('UNKNOWN_FUNCTION', `unknown function "${e.name}"`, e.span, filename);
      }
    }
  });
}

interface NamedItem { name: string; span?: SourceSpan; }

function checkDuplicates(
  items: readonly NamedItem[],
  diags: DiagnosticCollector,
  code: string,
  label: string,
  filename?: string,
): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.name)) {
      diags.error(code, `duplicate ${label} "${it.name}"`, it.span, filename);
    } else {
      seen.add(it.name);
    }
  }
}

interface EmitLike { when: Expr; value: number | Operation; span?: SourceSpan; }

function analyzeRanges(
  emits: readonly EmitLike[],
  diags: DiagnosticCollector,
  owner: string,
  filename: string | undefined,
  checkNumberRange: boolean,
  outRange?: [number, number],
): void {
  const simple: (SimpleRange & { idx: number })[] = [];
  let allSameVar = true;
  let singleVar: string | null = null;
  for (let i = 0; i < emits.length; i++) {
    const br = emits[i];
    if (!br) { allSameVar = false; break; }
    const r = extractSimpleRange(br.when);
    if (!r) { allSameVar = false; break; }
    if (singleVar === null) singleVar = r.var;
    else if (singleVar !== r.var) { allSameVar = false; break; }
    simple.push({ ...r, idx: i });
  }
  const intervals: Interval[] = [];
  if (allSameVar && simple.length > 0) {
    for (const s of simple) intervals.push(intervalFromRange(s));
    let overlapped = false;
    for (let i = 0; i < intervals.length && !overlapped; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const ii = intervals[i];
        const jj = intervals[j];
        if (ii && jj && intervalsOverlap(ii, jj)) {
          const hit = simple[i];
          diags.error(
            'EMIT_OVERLAP',
            `${owner}: emit branches overlap (conditions may both be true)`,
            hit ? emits[hit.idx]?.span : undefined,
            filename,
          );
          overlapped = true;
          break;
        }
      }
    }
    if (!intervalsCoverReals(intervals)) {
      diags.warn(
        'EMIT_NON_EXHAUSTIVE',
        `${owner}: emit conditions may not cover full domain (non-exhaustive)`,
        undefined,
        filename,
      );
    }
  } else if (emits.length > 0) {
    diags.warn(
      'EMIT_NON_EXHAUSTIVE',
      `${owner}: emit conditions may not be exhaustive or mutually exclusive`,
      undefined,
      filename,
    );
  }
  if (checkNumberRange && outRange) {
    const [rLo, rHi] = outRange;
    for (const br of emits) {
      const v = br.value;
      if (typeof v === 'number' && (v < rLo || v > rHi)) {
        diags.warn(
          'EMIT_OUT_OF_RANGE',
          `${owner}: emit value ${String(v)} outside output range [${String(rLo)}, ${String(rHi)}]`,
          br.span,
          filename,
        );
      }
    }
  }
}

function couldOverlap(a: Expr, b: Expr): 'proven' | 'possible' | 'disjoint' {
  const ra = extractSimpleRange(a);
  const rb = extractSimpleRange(b);
  if (!ra || !rb) return 'possible';
  if (ra.var !== rb.var) return 'possible';
  if (intervalsOverlap(intervalFromRange(ra), intervalFromRange(rb))) return 'proven';
  return 'disjoint';
}

function collectRefs(expr: Expr, set: Set<string>): void {
  walkExpr(expr, (e) => { if (e.type === 'ref') set.add(e.name); });
}

function validateSignal(doc: ParsedSignal, diags: DiagnosticCollector, filename?: string): void {
  const ctx: RefCtx = {};
  for (const inp of doc.inputs) ctx[inp.name] = inp.type === 'bool' ? 'bool' : 'number';
  checkDuplicates(doc.inputs, diags, 'DUP_INPUT', 'input name', filename);

  const lo = doc.output.range[0];
  const hi = doc.output.range[1];
  if (lo > -1 || hi < 1) {
    diags.warn(
      'OUTPUT_RANGE_NARROW',
      `output range [${String(lo)}, ${String(hi)}] does not include [-1, 1]; spec recommends clamp range includes [-1, 1]`,
      doc.output.span,
      filename,
    );
  }

  for (const sc of doc.scheduledChecks) {
    for (const br of sc.emit) checkExpr(br.when, ctx, diags, filename);
    analyzeRanges(sc.emit, diags, `scheduled_check "${sc.name}"`, filename, true, doc.output.range);
  }

  for (const tr of doc.triggers) {
    checkExpr(tr.when, ctx, diags, filename);
    for (const br of tr.emit) checkExpr(br.when, ctx, diags, filename);
    analyzeRanges(tr.emit, diags, `trigger "${tr.name}"`, filename, true, doc.output.range);
  }

  checkDuplicates(doc.scheduledChecks, diags, 'DUP_SCHEDULED', 'scheduled_check name', filename);
  checkDuplicates(doc.triggers, diags, 'DUP_TRIGGER', 'trigger name', filename);

  const byPriority = new Map<number, ParsedSignal['triggers']>();
  for (const tr of doc.triggers) {
    const arr = byPriority.get(tr.priority) ?? [];
    arr.push(tr);
    byPriority.set(tr.priority, arr);
  }
  for (const arr of byPriority.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (a && b) {
          const ov = couldOverlap(a.when, b.when);
          if (ov === 'proven') {
            diags.error(
              'TRIGGER_PRIORITY_OVERLAP',
              `triggers "${a.name}" and "${b.name}" share priority ${String(a.priority)} with overlapping when conditions`,
              b.span,
              filename,
            );
          } else if (ov === 'possible') {
            diags.warn(
              'TRIGGER_PRIORITY_OVERLAP',
              `triggers "${a.name}" and "${b.name}" share priority ${String(a.priority)}; ensure their when conditions are mutually exclusive`,
              b.span,
              filename,
            );
          }
        }
      }
    }
  }
}

interface OpLike { value: Operation; span?: SourceSpan; }

function validateOperations(
  emits: readonly OpLike[],
  diags: DiagnosticCollector,
  owner: string,
  filename?: string,
): void {
  for (const br of emits) {
    const op = br.value;
    if (op.kind === 'hold') continue;
    const tMap: Record<string, number> | null =
      op.kind === 'target' ? op.positions :
      op.kind === 'mixed' ? op.target : null;
    const aMap: Record<string, { buy?: number; sell?: number }> | null =
      op.kind === 'action' ? op.actions :
      op.kind === 'mixed' ? op.action : null;
    if (tMap && aMap) {
      for (const sym of Object.keys(tMap)) {
        if (Object.prototype.hasOwnProperty.call(aMap, sym)) {
          diags.error(
            'OP_SYMBOL_CONFLICT',
            `${owner}: symbol "${sym}" appears in both target and action`,
            br.span,
            filename,
          );
        }
      }
    }
    if (aMap) {
      for (const [sym, rec] of Object.entries(aMap)) {
        if (rec.buy !== undefined && rec.sell !== undefined) {
          diags.error(
            'OP_BUY_SELL_CONFLICT',
            `${owner}: symbol "${sym}" has both buy and sell`,
            br.span,
            filename,
          );
        }
      }
    }
  }
}

function validateStrategy(doc: ParsedStrategy, diags: DiagnosticCollector, filename?: string): void {
  if (doc.signals.length === 0) {
    diags.error('SIGNALS_EMPTY', 'strategy requires non-empty signals list', undefined, filename);
  }
  if (doc.combine.length === 0) {
    diags.error('COMBINE_EMPTY', 'strategy requires at least one combine entry', undefined, filename);
  }
  if (doc.combine.length > 1) {
    diags.warn('COMBINE_MULTIPLE', 'multiple combine entries; only first will be used', undefined, filename);
  }

  const ctx: RefCtx = {};
  for (const s of doc.signals) ctx[s] = 'number';

  for (const c of doc.combine) {
    if (!isValidIdent(c.name)) {
      diags.error('COMBINE_NAME_INVALID', `combine name "${c.name}" is not a valid identifier`, c.span, filename);
    }
    checkExpr(c.expr, ctx, diags, filename);
  }

  for (const c of doc.combine) {
    if (isValidIdent(c.name)) ctx[c.name] = 'number';
  }

  for (const sc of doc.scheduledChecks) {
    for (const br of sc.emit) checkExpr(br.when, ctx, diags, filename);
    analyzeRanges(sc.emit, diags, `scheduled_check "${sc.name}"`, filename, false);
    validateOperations(sc.emit, diags, `scheduled_check "${sc.name}"`, filename);
  }

  for (const tr of doc.triggers) {
    checkExpr(tr.when, ctx, diags, filename);
    for (const br of tr.emit) checkExpr(br.when, ctx, diags, filename);
    analyzeRanges(tr.emit, diags, `trigger "${tr.name}"`, filename, false);
    validateOperations(tr.emit, diags, `trigger "${tr.name}"`, filename);
  }

  checkDuplicates(doc.scheduledChecks, diags, 'DUP_SCHEDULED', 'scheduled_check name', filename);
  checkDuplicates(doc.triggers, diags, 'DUP_TRIGGER', 'trigger name', filename);

  const byPriority = new Map<number, ParsedStrategy['triggers']>();
  for (const tr of doc.triggers) {
    const arr = byPriority.get(tr.priority) ?? [];
    arr.push(tr);
    byPriority.set(tr.priority, arr);
  }
  for (const arr of byPriority.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (a && b) {
          const ov = couldOverlap(a.when, b.when);
          if (ov === 'proven') {
            diags.error(
              'TRIGGER_PRIORITY_OVERLAP',
              `triggers "${a.name}" and "${b.name}" share priority ${String(a.priority)} with overlapping when conditions`,
              b.span,
              filename,
            );
          } else if (ov === 'possible') {
            diags.warn(
              'TRIGGER_PRIORITY_OVERLAP',
              `triggers "${a.name}" and "${b.name}" share priority ${String(a.priority)}; ensure their when conditions are mutually exclusive`,
              b.span,
              filename,
            );
          }
        }
      }
    }
  }

  const referenced = new Set<string>();
  for (const c of doc.combine) collectRefs(c.expr, referenced);
  for (const sc of doc.scheduledChecks) for (const br of sc.emit) collectRefs(br.when, referenced);
  for (const tr of doc.triggers) {
    collectRefs(tr.when, referenced);
    for (const br of tr.emit) collectRefs(br.when, referenced);
  }
  for (const s of doc.signals) {
    if (!referenced.has(s)) {
      diags.warn('SIGNAL_UNUSED', `signal "${s}" declared but never referenced in combine/when`, undefined, filename);
    }
  }
}
