/** Small mathematical grammar. No JavaScript, property access, assignment or callbacks. */
type Node = { kind: 'number'; value: number } | { kind: 'name'; name: string } |
  { kind: 'unary'; op: string; value: Node } | { kind: 'binary'; op: string; left: Node; right: Node } |
  { kind: 'call'; name: string; args: Node[] };
const functions: Record<string, { min: number; max: number; fn: (...args: number[]) => number }> = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt }, exp: { min: 1, max: 1, fn: Math.exp },
  log: { min: 1, max: 1, fn: Math.log }, sin: { min: 1, max: 1, fn: Math.sin },
  cos: { min: 1, max: 1, fn: Math.cos }, tan: { min: 1, max: 1, fn: Math.tan },
  atan: { min: 1, max: 1, fn: Math.atan }, abs: { min: 1, max: 1, fn: Math.abs },
  min: { min: 2, max: 8, fn: Math.min }, max: { min: 2, max: 8, fn: Math.max },
};
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
const powers: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '^': 8 };
export const validName = (name: string) => /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name) && !['constructor', 'prototype', '__proto__'].includes(name);

export function compileExpression(source: string, allowedNames: readonly string[]): (values: Record<string, number>) => number {
  if (typeof source !== 'string' || !source.length || source.length > 1024) throw new Error('Expression length is out of bounds.');
  const names = new Set(allowedNames);
  const tokens: string[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[+*/^(),<>!\-]))/y;
  let offset = 0;
  while (offset < source.trimEnd().length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match || tokens.length >= 256) throw new Error('Unsupported or oversized mathematical expression.');
    tokens.push(match[1] ?? match[2] ?? match[3]);
    offset = pattern.lastIndex;
  }
  let index = 0;
  function parse(minimum = 0, depth = 0): Node {
    if (depth > 32) throw new Error('Expression nesting is too deep.');
    const token = tokens[index++];
    let left: Node;
    if (token === '+' || token === '-' || token === '!') left = { kind: 'unary', op: token, value: parse(7, depth + 1) };
    else if (token === '(') {
      left = parse(0, depth + 1);
      if (tokens[index++] !== ')') throw new Error('Missing closing parenthesis.');
    } else if (token && /^(?:\d|\.)/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('Number must be finite.');
      left = { kind: 'number', value };
    } else if (token && validName(token)) {
      if (tokens[index] === '(') {
        if (!Object.hasOwn(functions, token)) throw new Error(`Unsupported function: ${token}`);
        index++;
        const args: Node[] = [];
        if (tokens[index] !== ')') do {
          if (args.length === 8) throw new Error('Too many function arguments.');
          args.push(parse(0, depth + 1));
          if (tokens[index] !== ',') break;
          index++;
        } while (true);
        if (tokens[index++] !== ')') throw new Error('Missing closing parenthesis.');
        const bounds = functions[token];
        if (args.length < bounds.min || args.length > bounds.max) throw new Error('Incorrect function arity.');
        left = { kind: 'call', name: token, args };
      } else {
        if (!Object.hasOwn(constants, token) && !names.has(token)) throw new Error(`Unknown mathematical name: ${token}`);
        left = { kind: 'name', name: token };
      }
    } else throw new Error('Expected a mathematical value.');
    while (index < tokens.length && Object.hasOwn(powers, tokens[index]) && powers[tokens[index]] >= minimum) {
      const op = tokens[index++];
      left = { kind: 'binary', op, left, right: parse(powers[op] + (op === '^' ? 0 : 1), depth + 1) };
    }
    return left;
  }
  const root = parse();
  if (index !== tokens.length) throw new Error('Unexpected expression content.');
  return (values) => {
    function run(node: Node): number {
      let value: number;
      if (node.kind === 'number') return node.value;
      if (node.kind === 'name') {
        value = Object.hasOwn(constants, node.name) ? constants[node.name] : Object.hasOwn(values, node.name) ? values[node.name] : NaN;
      } else if (node.kind === 'call') value = functions[node.name].fn(...node.args.map(run));
      else if (node.kind === 'unary') {
        const n = run(node.value);
        value = node.op === '-' ? -n : node.op === '!' ? Number(!n) : n;
      } else {
        const a = run(node.left);
        if (node.op === '&&' && !a) return 0;
        if (node.op === '||' && a) return 1;
        const b = run(node.right);
        switch (node.op) {
          case '+': value = a + b; break; case '-': value = a - b; break;
          case '*': value = a * b; break; case '/': value = a / b; break;
          case '^': value = a ** b; break; case '==': value = Number(a === b); break;
          case '!=': value = Number(a !== b); break; case '<': value = Number(a < b); break;
          case '<=': value = Number(a <= b); break; case '>': value = Number(a > b); break;
          case '>=': value = Number(a >= b); break; case '&&': value = Number(!!b); break;
          case '||': value = Number(!!b); break; default: throw new Error('Unsupported operator.');
        }
      }
      if (!Number.isFinite(value)) throw new Error('The expression is undefined for these inputs.');
      return value;
    }
    return run(root);
  };
}
