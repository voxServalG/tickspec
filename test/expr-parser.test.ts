import { describe, it, expect } from 'vitest';
import { parseExpr, ExprParseError } from '../src/compiler/expr-parser.js';

describe('expr-parser', () => {
  it('parses number literals', () => {
    expect(parseExpr('42')).toMatchObject({ type: 'number', value: 42 });
    expect(parseExpr('-3.14')).toMatchObject({ type: 'unary', op: '-', operand: { type: 'number', value: 3.14 } });
    expect(parseExpr('0.5')).toMatchObject({ type: 'number', value: 0.5 });
  });

  it('parses booleans', () => {
    expect(parseExpr('true')).toMatchObject({ type: 'bool', value: true });
    expect(parseExpr('false')).toMatchObject({ type: 'bool', value: false });
  });

  it('parses refs', () => {
    expect(parseExpr('foo')).toMatchObject({ type: 'ref', name: 'foo' });
    expect(parseExpr('qqq_drawdown_3mo')).toMatchObject({ type: 'ref', name: 'qqq_drawdown_3mo' });
  });

  it('respects arithmetic precedence (* before +)', () => {
    const ast = parseExpr('1 + 2 * 3');
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') {
      expect(ast.op).toBe('+');
      expect(ast.left).toMatchObject({ type: 'number', value: 1 });
      expect(ast.right).toMatchObject({ type: 'binary', op: '*', left: { type: 'number', value: 2 }, right: { type: 'number', value: 3 } });
    }
  });

  it('respects parentheses', () => {
    const ast = parseExpr('(1 + 2) * 3');
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') {
      expect(ast.op).toBe('*');
      expect(ast.left).toMatchObject({ type: 'binary', op: '+' });
      expect(ast.right).toMatchObject({ type: 'number', value: 3 });
    }
  });

  it('parses unary minus and logical not', () => {
    expect(parseExpr('-x')).toMatchObject({ type: 'unary', op: '-', operand: { type: 'ref', name: 'x' } });
    expect(parseExpr('!flag')).toMatchObject({ type: 'unary', op: '!', operand: { type: 'ref', name: 'flag' } });
  });

  it('parses -x * -y as binary of two unaries', () => {
    const ast = parseExpr('-x * -y');
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') {
      expect(ast.op).toBe('*');
      expect(ast.left).toMatchObject({ type: 'unary', op: '-' });
      expect(ast.right).toMatchObject({ type: 'unary', op: '-' });
    }
  });

  it('parses comparisons', () => {
    expect(parseExpr('a < b')).toMatchObject({ type: 'binary', op: '<' });
    expect(parseExpr('x >= 0.05')).toMatchObject({ type: 'binary', op: '>=' });
    expect(parseExpr('a == b')).toMatchObject({ type: 'binary', op: '==' });
    expect(parseExpr('a != b')).toMatchObject({ type: 'binary', op: '!=' });
  });

  it('parses logical operators (and before or)', () => {
    const ast = parseExpr('a and b or c');
    expect(ast.type).toBe('binary');
    if (ast.type === 'binary') {
      expect(ast.op).toBe('or');
      expect(ast.left).toMatchObject({ type: 'binary', op: 'and' });
    }
  });

  it('parses function calls', () => {
    const co = parseExpr('cross_over(score, 0.0)');
    expect(co).toMatchObject({ type: 'call', name: 'cross_over', args: [{ type: 'ref', name: 'score' }, { type: 'number', value: 0 }] });
    const cl = parseExpr('clamp(x, -1, 1)');
    expect(cl).toMatchObject({ type: 'call', name: 'clamp', args: [{ type: 'ref', name: 'x' }, { type: 'unary', op: '-' }, { type: 'number', value: 1 }] });
  });

  it('throws on malformed input', () => {
    expect(() => parseExpr('1 +')).toThrow(ExprParseError);
    expect(() => parseExpr('(1 + 2')).toThrow(ExprParseError);
    expect(() => parseExpr('@')).toThrow(/Unexpected character/);
  });
});
