export type FileKind = 'signal' | 'strategy';

export type FactorType = 'number' | 'bool' | 'enum' | 'ordinal';

export type EveryFrequency = string;

export interface SourcePos {
  line: number;
  col: number;
}

export interface SourceSpan {
  start: SourcePos;
  end?: SourcePos;
}

export interface InputDecl {
  name: string;
  type: FactorType;
  description?: string;
  span?: SourceSpan;
}

export interface OutputDecl {
  range: [number, number];
  span?: SourceSpan;
}

// ----- Expression AST -----
export type Expr =
  | { type: 'number'; value: number; span?: SourceSpan }
  | { type: 'bool'; value: boolean; span?: SourceSpan }
  | { type: 'ref'; name: string; span?: SourceSpan }
  | { type: 'unary'; op: '-' | '!'; operand: Expr; span?: SourceSpan }
  | { type: 'binary'; op: BinOp; left: Expr; right: Expr; span?: SourceSpan }
  | { type: 'call'; name: string; args: Expr[]; span?: SourceSpan };

export type BinOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | 'and'
  | 'or';

// ----- Scheduled checks & Triggers -----
export interface EmitBranch<TOut> {
  when: Expr;
  value: TOut;
  span?: SourceSpan;
}

export interface ScheduledCheck<TOut> {
  name: string;
  every: EveryFrequency;
  emit: EmitBranch<TOut>[];
  span?: SourceSpan;
}

export interface Trigger<TOut> {
  name: string;
  when: Expr;
  emit: EmitBranch<TOut>[];
  priority: number;
  kind: 'level' | 'edge';
  span?: SourceSpan;
}

// ----- Operation types (strategy output) -----
export type Operation =
  | { kind: 'hold' }
  | { kind: 'target'; positions: Record<string, number> }
  | { kind: 'action'; actions: Record<string, { buy?: number; sell?: number }> }
  | { kind: 'mixed'; target: Record<string, number>; action: Record<string, { buy?: number; sell?: number }> };

// ----- Combine (strategy) -----
export interface CombineDecl {
  name: string;
  expr: Expr;
  span?: SourceSpan;
}

// ----- Parsed document (before validation) -----
export interface ParsedSignal {
  kind: 'signal';
  name: string;
  inputs: InputDecl[];
  output: OutputDecl;
  scheduledChecks: ScheduledCheck<number>[];
  triggers: Trigger<number>[];
}

export interface ParsedStrategy {
  kind: 'strategy';
  name: string;
  signals: string[];
  combine: CombineDecl[];
  scheduledChecks: ScheduledCheck<Operation>[];
  triggers: Trigger<Operation>[];
}

export type ParsedDocument = ParsedSignal | ParsedStrategy;

// ----- IR (canonical JSON) -----
export interface SignalIR {
  language: 'tickspec';
  kind: 'signal';
  name: string;
  version: 1;
  inputs: { name: string; type: FactorType }[];
  output: { range: [number, number] };
  schedulers: SchedulerIR<number>[];
  triggers: TriggerIR<number>[];
}

export interface StrategyIR {
  language: 'tickspec';
  kind: 'strategy';
  name: string;
  version: 1;
  signals: string[];
  combine: { name: string; expr: ExprJSON }[];
  schedulers: SchedulerIR<OperationJSON>[];
  triggers: TriggerIR<OperationJSON>[];
}

export type DocumentIR = SignalIR | StrategyIR;

export type ExprJSON =
  | { type: 'number'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'ref'; name: string }
  | { type: 'unary'; op: '-' | '!'; operand: ExprJSON }
  | { type: 'binary'; op: BinOp; left: ExprJSON; right: ExprJSON }
  | { type: 'call'; name: string; args: ExprJSON[] };

export interface SchedulerIR<T> {
  name: string;
  every: EveryFrequency;
  branches: { when: ExprJSON; emit: T }[];
}

export interface TriggerIR<T> {
  name: string;
  kind: 'level' | 'edge';
  when: ExprJSON;
  branches: { when: ExprJSON; emit: T }[];
  priority: number;
}

export type OperationJSON =
  | { kind: 'hold' }
  | { kind: 'target'; positions: Record<string, number> }
  | { kind: 'action'; actions: Record<string, { buy?: number; sell?: number }> }
  | { kind: 'mixed'; target: Record<string, number>; action: Record<string, { buy?: number; sell?: number }> };

// ----- Diagnostic -----
export type Severity = 'error' | 'warning' | 'note';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  span?: SourceSpan;
  file?: string;
}
