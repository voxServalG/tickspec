import type {
  ParsedDocument,
  ParsedSignal,
  ParsedStrategy,
  DocumentIR,
  SignalIR,
  StrategyIR,
  Expr,
  ExprJSON,
  Operation,
  OperationJSON,
} from './types.js';

export function toIR(doc: ParsedDocument): DocumentIR {
  if (doc.kind === 'signal') return signalToIR(doc);
  return strategyToIR(doc);
}

export function exprToJSON(e: Expr): ExprJSON {
  switch (e.type) {
    case 'number':
      return { type: 'number', value: e.value };
    case 'bool':
      return { type: 'bool', value: e.value };
    case 'ref':
      return { type: 'ref', name: e.name };
    case 'unary':
      return { type: 'unary', op: e.op, operand: exprToJSON(e.operand) };
    case 'binary':
      return {
        type: 'binary',
        op: e.op,
        left: exprToJSON(e.left),
        right: exprToJSON(e.right),
      };
    case 'call':
      return { type: 'call', name: e.name, args: e.args.map(exprToJSON) };
  }
}

export function opToJSON(op: Operation): OperationJSON {
  switch (op.kind) {
    case 'hold':
      return { kind: 'hold' };
    case 'target':
      return { kind: 'target', positions: { ...op.positions } };
    case 'action':
      return {
        kind: 'action',
        actions: Object.fromEntries(
          Object.entries(op.actions).map(([k, v]) => [
            k,
            { buy: v.buy, sell: v.sell },
          ]),
        ),
      };
    case 'mixed':
      return {
        kind: 'mixed',
        target: { ...op.target },
        action: Object.fromEntries(
          Object.entries(op.action).map(([k, v]) => [
            k,
            { buy: v.buy, sell: v.sell },
          ]),
        ),
      };
  }
}

function signalToIR(doc: ParsedSignal): SignalIR {
  return {
    language: 'tickspec',
    kind: 'signal',
    name: doc.name,
    version: 1,
    inputs: doc.inputs.map((i) => ({ name: i.name, type: i.type })),
    output: { range: [doc.output.range[0], doc.output.range[1]] },
    schedulers: doc.scheduledChecks.map((sc) => ({
      name: sc.name,
      every: sc.every,
      branches: sc.emit.map((b) => ({ when: exprToJSON(b.when), emit: b.value })),
    })),
    triggers: doc.triggers.map((tr) => ({
      name: tr.name,
      kind: tr.kind,
      when: exprToJSON(tr.when),
      branches: tr.emit.map((b) => ({ when: exprToJSON(b.when), emit: b.value })),
      priority: tr.priority,
    })),
  };
}

function strategyToIR(doc: ParsedStrategy): StrategyIR {
  return {
    language: 'tickspec',
    kind: 'strategy',
    name: doc.name,
    version: 1,
    signals: [...doc.signals],
    combine: doc.combine.map((c) => ({ name: c.name, expr: exprToJSON(c.expr) })),
    schedulers: doc.scheduledChecks.map((sc) => ({
      name: sc.name,
      every: sc.every,
      branches: sc.emit.map((b) => ({ when: exprToJSON(b.when), emit: opToJSON(b.value) })),
    })),
    triggers: doc.triggers.map((tr) => ({
      name: tr.name,
      kind: tr.kind,
      when: exprToJSON(tr.when),
      branches: tr.emit.map((b) => ({ when: exprToJSON(b.when), emit: opToJSON(b.value) })),
      priority: tr.priority,
    })),
  };
}
