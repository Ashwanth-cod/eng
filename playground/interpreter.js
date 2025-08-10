// --- INTERPRETER.JS ---

// Globals
window.variables = {};
window.constants = {};
window.functions = {};
window.classes = {};

// Environment stack for scopes and blocks (for nested blocks, loops, functions)
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

// Runtime context
class Runtime {
  constructor() {
    this.globalEnv = new Environment();
    this.currentEnv = this.globalEnv;
    this.functions = {};
    this.classes = {};
  }

  reset() {
    this.globalEnv = new Environment();
    this.currentEnv = this.globalEnv;
    this.functions = {};
    this.classes = {};
  }

  declareVariable(name, value, isConst) {
    if (this.currentEnv.isDeclared(name))
      throw new Error(`Variable "${name}" already declared in this scope`);
    if (isConst) this.currentEnv.declareConst(name, value);
    else this.currentEnv.declareVar(name, value);
  }

  assignVariable(name, value) {
    this.currentEnv.set(name, value);
  }

  getVariable(name) {
    return this.currentEnv.get(name);
  }
}

const runtime = new Runtime();

// === Helpers ===

// Parse a value string into JS type
function parseValue(valStr) {
  valStr = valStr.trim();
  if (valStr.match(/^".*"$/) || valStr.match(/^'.*'$/)) {
    return valStr.slice(1, -1); // string
  }
  if (!isNaN(Number(valStr))) {
    return Number(valStr);
  }
  if (valStr === 'true') return true;
  if (valStr === 'false') return false;
  if (valStr.startsWith('[') && valStr.endsWith(']')) {
    try {
      return JSON.parse(valStr.replace(/'/g, '"'));
    } catch {
      throw new Error('Invalid list syntax');
    }
  }
  if (valStr.startsWith('{') && valStr.endsWith('}')) {
    try {
      return JSON.parse(valStr.replace(/'/g, '"'));
    } catch {
      throw new Error('Invalid map syntax');
    }
  }
  // Could be variable
  return runtime.getVariable(valStr);
}

// Evaluate expressions with indexing support
function evalExpression(expr, env = runtime.currentEnv) {
  expr = expr.trim();

  // Replace variables with their values, supporting indexing like var[0], var[1]
  let safeExpr = expr.replace(/[^\w\s\[\]\(\)\.\,\+\-\*\/\%\>\<\=\!\&\|\^\~\'\"\:\?\{\}\d\.]+/g, (m) => m); // sanitize but allow necessary chars

  // Extract variable/index patterns and replace with literal values recursively
  const varIndexRegex = /([a-zA-Z_]\w*(?:\[\d+\])*)/g;

  safeExpr = safeExpr.replace(varIndexRegex, (match) => {
    try {
      // Split e.g. name[0][1] -> ['name', '0', '1']
      let parts = match.split(/[\[\]]/).filter(p => p !== '');
      let val = env.get(parts[0]);
      for (let i = 1; i < parts.length; i++) {
        let index = Number(parts[i]);
        if (val == null) {
          throw new Error(`Cannot index into null or undefined`);
        }
        if (typeof val === 'string') {
          if (index < 0 || index >= val.length) {
            throw new Error(`Index ${index} out of range for string`);
          }
          val = val.charAt(index);
        } else if (Array.isArray(val) || typeof val === 'object') {
          if (!(index in val)) {
            throw new Error(`Index ${index} out of range`);
          }
          val = val[index];
        } else {
          throw new Error(`Cannot index into type ${typeof val}`);
        }
      }
      // Return string literals quoted
      if (typeof val === 'string') return JSON.stringify(val);
      return val;
    } catch (e) {
      throw new Error(`Variable or index error: ${match} - ${e.message}`);
    }
  });

  // Evaluate safely with Function constructor
  try {
    // eslint-disable-next-line no-new-func
    return Function('"use strict";return (' + safeExpr + ')')();
  } catch (e) {
    throw new Error(`Expression evaluation failed: ${expr}`);
  }
}

// === Main interpreter function

async function interpret(lines) {
  runtime.reset();

  function indentLevel(line) {
    let match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  return interpretBlock(lines, 0, lines.length, runtime.globalEnv);
}

function interpretBlock(lines, start, end, env) {
  let output = [];
  let i = start;

  while (i < end) {
    let line = lines[i];
    line = line.trim();
    if (line === '' || line.startsWith('#')) {
      i++;
      continue;
    }

    // let var = expr  (mutable)
    let letMatch = line.match(/^let\s+(\w+)\s*=\s*(.+)$/);
    if (letMatch) {
      const [, varName, expr] = letMatch;
      const val = evalExpression(expr, env);
      if (env.isDeclared(varName))
        throw new Error(`Variable "${varName}" already declared`);
      env.declareVar(varName, val);
      i++;
      continue;
    }

    // set var = expr  (const)
    let setMatch = line.match(/^set\s+(\w+)\s*=\s*(.+)$/);
    if (setMatch) {
      const [, varName, expr] = setMatch;
      const val = evalExpression(expr, env);
      if (env.isDeclared(varName))
        throw new Error(`Variable "${varName}" already declared`);
      env.declareConst(varName, val);
      i++;
      continue;
    }

    // Assignment: var = expr (must already exist)
    let assignMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (assignMatch) {
      const [, varName, expr] = assignMatch;
      if (!env.isDeclared(varName))
        throw new Error(`Variable "${varName}" not declared`);
      const val = evalExpression(expr, env);
      env.set(varName, val);
      i++;
      continue;
    }

    // say "text" or say var/expression
    let sayMatch = line.match(/^say\s+(.+)$/);
    if (sayMatch) {
      let arg = sayMatch[1];
      if (/^["'].*["']$/.test(arg)) {
        output.push(arg.slice(1, -1));
      } else {
        try {
          let val = evalExpression(arg, env);
          output.push(String(val));
        } catch (e) {
          output.push('Error in say: ' + e.message);
        }
      }
      i++;
      continue;
    }

    // if condition:
    let ifMatch = line.match(/^if\s+(.+):$/);
    if (ifMatch) {
      const condExpr = ifMatch[1];
      const condResult = evalExpression(condExpr, env);
      let blockStart = i + 1;
      let blockEnd = blockStart;
      while (blockEnd < lines.length && lines[blockEnd].startsWith('    ')) blockEnd++;
      if (condResult) {
        const blockOutput = interpretBlock(lines, blockStart, blockEnd, new Environment(env));
        output.push(...blockOutput);
      }
      i = blockEnd;
      continue;
    }

    // else:
    let elseMatch = line.match(/^else:$/);
    if (elseMatch) {
      let blockStart = i + 1;
      let blockEnd = blockStart;
      while (blockEnd < lines.length && lines[blockEnd].startsWith('    ')) blockEnd++;
      const blockOutput = interpretBlock(lines, blockStart, blockEnd, new Environment(env));
      output.push(...blockOutput);
      i = blockEnd;
      continue;
    }

    // repeat n:
    let repeatMatch = line.match(/^repeat\s+(\d+):$/);
    if (repeatMatch) {
      const count = parseInt(repeatMatch[1], 10);
      let blockStart = i + 1;
      let blockEnd = blockStart;
      while (blockEnd < lines.length && lines[blockEnd].startsWith('    ')) blockEnd++;
      for (let c = 0; c < count; c++) {
        const blockOutput = interpretBlock(lines, blockStart, blockEnd, new Environment(env));
        output.push(...blockOutput);
      }
      i = blockEnd;
      continue;
    }

    // while cond:
    let whileMatch = line.match(/^while\s+(.+):$/);
    if (whileMatch) {
      const condExpr = whileMatch[1];
      let blockStart = i + 1;
      let blockEnd = blockStart;
      while (blockEnd < lines.length && lines[blockEnd].startsWith('    ')) blockEnd++;
      while (evalExpression(condExpr, env)) {
        const blockOutput = interpretBlock(lines, blockStart, blockEnd, new Environment(env));
        output.push(...blockOutput);
      }
      i = blockEnd;
      continue;
    }

    // function funcName(params):
    let funcMatch = line.match(/^function\s+(\w+)\s*\(([^)]*)\):$/);
    if (funcMatch) {
      const [, funcName, paramsStr] = funcMatch;
      let params = paramsStr.trim() ? paramsStr.split(',').map(s => s.trim()) : [];
      // Find function body
      let blockStart = i + 1;
      let blockEnd = blockStart;
      while (blockEnd < lines.length && lines[blockEnd].startsWith('    ')) blockEnd++;
      runtime.functions[funcName] = {
        params,
        bodyStart: blockStart,
        bodyEnd: blockEnd,
        bodyLines: lines.slice(blockStart, blockEnd)
      };
      i = blockEnd;
      continue;
    }

    // return expr
    let returnMatch = line.match(/^return\s+(.+)$/);
    if (returnMatch) {
      let val = evalExpression(returnMatch[1], env);
      throw { type: 'return', value: val };
    }

    // call functionName(args)
    let callMatch = line.match(/^(\w+)\((.*)\)$/);
    if (callMatch) {
      let [, funcName, argsStr] = callMatch;
      if (!(funcName in runtime.functions))
        throw new Error(`Function "${funcName}" not found`);
      let args = argsStr.trim() ? argsStr.split(',').map(a => evalExpression(a.trim(), env)) : [];
      let func = runtime.functions[funcName];
      if (args.length !== func.params.length)
        throw new Error(`Function "${funcName}" expects ${func.params.length} arguments`);
      let funcEnv = new Environment(runtime.globalEnv);
      for (let j = 0; j < args.length; j++) {
        funcEnv.declareVar(func.params[j], args[j]);
      }
      try {
        return interpretBlock(func.bodyLines, 0, func.bodyLines.length, funcEnv).output;
      } catch (e) {
        if (e.type === 'return') return e.value;
        else throw e;
      }
    }

    // TODO: Add class, try/catch support here (if needed)

    // If no known command
    throw new Error(`Unknown or unsupported statement: ${line}`);
  }

  return output;
}

// Export interpreter
window.interpret = interpret;
