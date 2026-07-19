import type { BinOp, Expr, SourcePos, SourceSpan } from './types.js';

interface Token {
  type:
    | 'number'
    | 'ident'
    | 'lparen'
    | 'rparen'
    | 'comma'
    | 'op'
    | 'and'
    | 'or'
    | 'true'
    | 'false'
    | 'eof';
  value: string;
  pos: SourcePos;
}

const KEYWORDS: Record<string, Token['type']> = {
  and: 'and',
  or: 'or',
  true: 'true',
  false: 'false',
};

const TWO_CHAR_OPS = new Set(['<=', '>=', '==', '!=']);
const ONE_CHAR_OPS = new Set(['<', '>', '+', '-', '*', '/', '!']);

class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly src: string) {}

  private peek(): string {
    return this.src[this.pos] ?? '';
  }

  private advance(): string {
    const ch = this.src[this.pos] ?? '';
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    this.pos++;
    return ch;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.src.length) {
      this.skipWs();
      if (this.pos >= this.src.length) break;
      const startLine = this.line;
      const startCol = this.col;
      const ch = this.peek();

      if (ch === '(') {
        this.advance();
        tokens.push({ type: 'lparen', value: '(', pos: { line: startLine, col: startCol } });
        continue;
      }
      if (ch === ')') {
        this.advance();
        tokens.push({ type: 'rparen', value: ')', pos: { line: startLine, col: startCol } });
        continue;
      }
      if (ch === ',') {
        this.advance();
        tokens.push({ type: 'comma', value: ',', pos: { line: startLine, col: startCol } });
        continue;
      }

      const two = this.src.slice(this.pos, this.pos + 2);
      if (TWO_CHAR_OPS.has(two)) {
        this.advance();
        this.advance();
        tokens.push({ type: 'op', value: two, pos: { line: startLine, col: startCol } });
        continue;
      }
      if (ONE_CHAR_OPS.has(ch)) {
        this.advance();
        tokens.push({ type: 'op', value: ch, pos: { line: startLine, col: startCol } });
        continue;
      }

      if (/[0-9.]/.test(ch) || (ch === '-' && /[0-9.]/.test(this.src[this.pos + 1] ?? ''))) {
        const start = this.pos;
        if (ch === '-') this.advance();
        while (/[0-9.]/.test(this.peek())) this.advance();
        tokens.push({
          type: 'number',
          value: this.src.slice(start, this.pos),
          pos: { line: startLine, col: startCol },
        });
        continue;
      }

      if (/[a-zA-Z_]/.test(ch)) {
        const start = this.pos;
        while (/[a-zA-Z0-9_]/.test(this.peek())) this.advance();
        const ident = this.src.slice(start, this.pos);
        const kw = KEYWORDS[ident];
        tokens.push({
          type: kw ?? 'ident',
          value: ident,
          pos: { line: startLine, col: startCol },
        });
        continue;
      }

      throw new ExprParseError(`Unexpected character '${ch}'`, {
        start: { line: startLine, col: startCol },
      });
    }
    tokens.push({ type: 'eof', value: '', pos: { line: this.line, col: this.col } });
    return tokens;
  }
}

export class ExprParseError extends Error {
  public readonly span?: SourceSpan;
  constructor(msg: string, span?: SourceSpan) {
    super(msg);
    this.name = 'ExprParseError';
    this.span = span;
  }
}

// Precedence (lower binds looser):
//  1: or
//  2: and
//  3: ==, !=
//  4: <, <=, >, >=
//  5: +, -
//  6: *, /
//  7: unary -, !
class Parser {
  private idx = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.idx]!;
  }

  private advance(): Token {
    const t = this.tokens[this.idx]!;
    this.idx++;
    return t;
  }

  private expect(type: Token['type'], value?: string): Token {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new ExprParseError(
        `expected ${type}${value ? ` "${value}"` : ''}, got ${t.type} "${t.value}"`,
        { start: t.pos },
      );
    }
    return this.advance();
  }

  parse(): Expr {
    const expr = this.parseOr();
    if (this.peek().type !== 'eof') {
      const t = this.peek();
      throw new ExprParseError(`unexpected token "${t.value}"`, { start: t.pos });
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.peek().type === 'or') {
      const op = this.advance();
      const right = this.parseAnd();
      left = {
        type: 'binary',
        op: 'or',
        left,
        right,
        span: { start: left.span?.start ?? op.pos, end: right.span?.end },
      };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.peek().type === 'and') {
      const op = this.advance();
      const right = this.parseEquality();
      left = {
        type: 'binary',
        op: 'and',
        left,
        right,
        span: { start: left.span?.start ?? op.pos, end: right.span?.end },
      };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.peek().type === 'op' && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.advance();
      const right = this.parseComparison();
      left = {
        type: 'binary',
        op: op.value as BinOp,
        left,
        right,
        span: { start: left.span?.start ?? op.pos, end: right.span?.end },
      };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAddSub();
    while (this.peek().type === 'op' && ['<', '<=', '>', '>='].includes(this.peek().value)) {
      const op = this.advance();
      const right = this.parseAddSub();
      left = {
        type: 'binary',
        op: op.value as BinOp,
        left,
        right,
        span: { start: left.span?.start ?? op.pos, end: right.span?.end },
      };
    }
    return left;
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance();
      const right = this.parseMulDiv();
      left = {
        type: 'binary',
        op: op.value as BinOp,
        left,
        right,
        span: { start: left.span?.start ?? op.pos, end: right.span?.end },
      };
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parseUnary();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.advance();
      const right = this.parseUnary();
      left = {
        type: 'binary',
        op: op.value as BinOp,
        left,
        right,
        span: { start: left.span?.start ?? op.pos, end: right.span?.end },
      };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '!')) {
      this.advance();
      const operand = this.parseUnary();
      return {
        type: 'unary',
        op: t.value as '-' | '!',
        operand,
        span: { start: t.pos, end: operand.span?.end },
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === 'number') {
      this.advance();
      const num = Number(t.value);
      if (Number.isNaN(num)) {
        throw new ExprParseError(`invalid number literal "${t.value}"`, { start: t.pos });
      }
      return { type: 'number', value: num, span: { start: t.pos } };
    }
    if (t.type === 'true') {
      this.advance();
      return { type: 'bool', value: true, span: { start: t.pos } };
    }
    if (t.type === 'false') {
      this.advance();
      return { type: 'bool', value: false, span: { start: t.pos } };
    }
    if (t.type === 'lparen') {
      this.advance();
      const inner = this.parseOr();
      this.expect('rparen', ')');
      return inner;
    }
    if (t.type === 'ident') {
      this.advance();
      if (this.peek().type === 'lparen') {
        this.advance();
        const args: Expr[] = [];
        if (this.peek().type !== 'rparen') {
          args.push(this.parseOr());
          while (this.peek().type === 'comma') {
            this.advance();
            args.push(this.parseOr());
          }
        }
        const close = this.expect('rparen', ')');
        return {
          type: 'call',
          name: t.value,
          args,
          span: { start: t.pos, end: close.pos },
        };
      }
      return { type: 'ref', name: t.value, span: { start: t.pos } };
    }
    throw new ExprParseError(`unexpected token "${t.value}"`, { start: t.pos });
  }
}

export function parseExpr(src: string): Expr {
  const lexer = new Lexer(src);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}
