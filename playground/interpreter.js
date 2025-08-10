class Environment {
  constructor(parent = null) {
    this.vars = {};
    this.consts = {};
    this.parent = parent;
  }
  get(name) {
    if (name in this.vars) return this.vars[name];
    if (name in this.consts) return this.consts[name];
    if (this.parent) return this.parent.get(name);
    throw new Error(`Variable "${name}" not found`);
  }
  set(name, value) {
    if (name in this.vars) {
      this.vars[name] = value;
    } else if (this.parent) {
      this.parent.set(name, value);
    } else {
      throw new Error(`Variable "${name}" not declared`);
    }
  }
  declareVar(name, value) {
    this.vars[name] = value;
  }
  declareConst(name, value) {
    this.consts[name] = value;
  }
  isDeclared(name) {
    return (name in this.vars) || (name in this.consts);
  }
}

class Runtime {
  constructor() {
    this.globalEnv = new Environment();
    this.functions = {};
    this.output = [];
  }
  reset() {
    this.globalEnv = new Environment();
    this.functions = {};
    this.output = [];
  }
}

const runtime = new Runtime();

function parseValue(valStr, env) {
  valStr = valStr.trim();

  // String literal "text" or 'text'
  if (/^".*"$/.test(valStr) || /^'.*'$/.test(valStr)) {
    return valStr.slice(1, -1);
  }
  // Number literal
  if (!isNaN(Number(valStr))) {
    return Number(valStr);
  }
  // Boolean literal
  if (valStr === 'true') return true;
  if (valStr === 'false') return false;
  // List literal (basic, e.g. ['a', 'b', 'c'])
  if (valStr.startsWith('[') && valStr.endsWith(']')) {
    try {
      // replace single quotes to double for JSON parse
      return JSON.parse(valStr.replace(/'/g, '"'));
    } catch {
      throw new Error('Invalid list syntax');
    }
  }

  // Variable or variable with indexing e.g. fruits[0], name[1]
  let indexMatch = valStr.match(/^(\w+)(\[(.+)\])?$/);
  if (indexMatch) {
    let varName = indexMatch[1];
    let indexExpr = indexMatch[3];
    let val = env.get(varName);
    if (indexExpr !== undefined) {
      let idx = parseValue(indexExpr, env);
      if (val && (typeof val === 'string' || Array.isArray(val))) {
        if (idx < 0 || idx >= val.length) throw new Error('Index out of bounds');
        return val[idx];
      } else {
        throw new Error(`Cannot index into variable "${varName}"`);
      }
    } else {
      return val;
    }
  }

  // Function call e.g. getFruit(2)
  let funcCallMatch = valStr.match(/^(\w+)\((.*)\)$/);
  if (funcCallMatch) {
    let funcName = funcCallMatch[1];
    let argStr = funcCallMatch[2];
    if (!(funcName in runtime.functions)) {
      throw new Error(`Function "${funcName}" not found`);
    }
    let args = [];
    if (argStr.trim() !== '') {
      // Support comma separated arguments with trimming
      args = argStr.split(',').map(a => parseValue(a.trim(), env));
    }
    return callFunction(funcName, args, env);
  }

  // Variable only
  return env.get(valStr);
}

function evalExpression(expr, env) {
  expr = expr.trim();

  // Support multiplication * operator (only single '*' in expression)
  if (expr.includes('*')) {
    let parts = expr.split('*').map(p => p.trim());
    if (parts.length === 2) {
      let left = parseValue(parts[0], env);
      let right = parseValue(parts[1], env);
      if (typeof left === 'number' && typeof right === 'number') {
        return left * right;
      }
      throw new Error('Invalid operands for multiplication');
    }
  }

  return parseValue(expr, env);
}

function callFunction(name, args, callerEnv) {
  const func = runtime.functions[name];
  if (args.length !== func.params.length) {
    throw new Error(`Function "${name}" expects ${func.params.length} arguments but got ${args.length}`);
  }
  const funcEnv = new Environment(runtime.globalEnv);
  func.params.forEach((p, i) => funcEnv.declareVar(p, args[i]));

  for (let line of func.body) {
    line = line.trim();
    if (line.startsWith('return ')) {
      let retExpr = line.slice(7);
      return evalExpression(retExpr, funcEnv);
    } else if (line.startsWith('say ')) {
      let toSay = line.slice(4);
      let val = evalExpression(toSay, funcEnv);
      runtime.output.push(String(val));
    } else {
      // Could extend with more statements here (assign, repeat etc.)
      // For now only support say and return inside functions
    }
  }
  return null;
}

function interpretBlock(lines, env) {
  let output = [];
  runtime.output = output;
  let i = 0;

  while (i < lines.length) {
    let line = lines[i].trim();
    if (line === '' || line.startsWith('#')) {
      i++;
      continue;
    }

    // Variable declaration: let var = expr
    let letMatch = line.match(/^let\s+(\w+)\s*=\s*(.+)$/);
    if (letMatch) {
      const [, varName, expr] = letMatch;
      if (env.isDeclared(varName)) throw new Error(`Variable "${varName}" already declared`);
      const val = evalExpression(expr, env);
      env.declareVar(varName, val);
      i++;
      continue;
    }

    // Constant declaration: set var = expr
    let setMatch = line.match(/^set\s+(\w+)\s*=\s*(.+)$/);
    if (setMatch) {
      const [, varName, expr] = setMatch;
      if (env.isDeclared(varName)) throw new Error(`Variable "${varName}" already declared`);
      const val = evalExpression(expr, env);
      env.declareConst(varName, val);
      i++;
      continue;
    }

    // Variable assignment: var = expr
    let assignMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (assignMatch) {
      const [, varName, expr] = assignMatch;
      if (!env.isDeclared(varName)) throw new Error(`Variable "${varName}" not declared`);
      const val = evalExpression(expr, env);
      env.set(varName, val);
      i++;
      continue;
    }

    // say command
    if (line.startsWith('say ')) {
      const toSay = line.slice(4);
      const val = evalExpression(toSay, env);
      output.push(String(val));
      i++;
      continue;
    }

    // repeat loop: repeat count:
    let repeatMatch = line.match(/^repeat\s+(\d+):$/);
    if (repeatMatch) {
      const count = Number(repeatMatch[1]);
      // Gather block lines indented by 4 spaces
      const blockLines = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('    ') || lines[i].trim() === '')) {
        if (lines[i].trim() !== '') blockLines.push(lines[i].slice(4));
        i++;
      }
      for (let r = 0; r < count; r++) {
        interpretBlock(blockLines, env);
      }
      continue;
    }

    // function declaration: function name(params):
    let funcMatch = line.match(/^function\s+(\w+)\(([\w\s,]*)\):$/);
    if (funcMatch) {
      const [, fname, paramsStr] = funcMatch;
      const params = paramsStr.split(',').map(s => s.trim()).filter(Boolean);
      // Gather function body indented lines
      const bodyLines = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('    ') || lines[i].trim() === '')) {
        if (lines[i].trim() !== '') bodyLines.push(lines[i].slice(4));
        i++;
      }
      runtime.functions[fname] = { params, body: bodyLines };
      continue;
    }

    throw new Error(`Unknown or invalid syntax: "${line}"`);
  }

  return output;
}

function runCode(code) {
  runtime.reset();
  const lines = code.split('\n');
  const env = runtime.globalEnv;

  try {
    const startTime = performance.now();

    const outputLines = interpretBlock(lines, env);

    const endTime = performance.now();
    const execTimeMs = (endTime - startTime).toFixed(2);

    const executedAt = new Date().toLocaleString();

    outputLines.push('');
    outputLines.push(`Execution Time: ${execTimeMs} ms`);
    outputLines.push(`Executed on: ${executedAt}`);

    return outputLines.join('\n');
  } catch (e) {
    return `Error: ${e.message}`;
  }
}


// Hook to HTML buttons
document.getElementById('runButton').addEventListener('click', () => {
  const code = document.getElementById('editor').innerText;
  const result = runCode(code);
  document.getElementById('output').innerText = result;
});

document.getElementById('clearButton').addEventListener('click', () => {
  document.getElementById('output').innerText = '';
});
