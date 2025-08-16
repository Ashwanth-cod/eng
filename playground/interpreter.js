// interpreter.js
// Full ENG interpreter with classes, functions, loops, if/else, break/continue, input, say, etc.

// --------------------------
// Runtime & Environment
// --------------------------
class Environment {
  constructor(parent = null) {
    this.vars = {};
    this.consts = {};
    this.parent = parent;
  }

  isDeclared(name) {
    if (name in this.vars || name in this.consts) return true;
    if (this.parent) return this.parent.isDeclared(name);
    return false;
  }

  declareVar(name, value) {
    this.vars[name] = value;
  }

  declareConst(name, value) {
    this.consts[name] = value;
  }

  set(name, value) {
    if (name in this.vars) {
      this.vars[name] = value;
    } else if (this.parent && this.parent.isDeclared(name)) {
      this.parent.set(name, value);
    } else if (this.parent && !(name in this.parent.vars) && name in this.parent.consts) {
      throw new Error(`Cannot assign to constant "${name}"`);
    } else {
      // convenient behavior: if not declared anywhere, create in current scope
      this.vars[name] = value;
    }
  }

  get(name) {
    if (name in this.vars) return this.vars[name];
    if (name in this.consts) return this.consts[name];
    if (this.parent) return this.parent.get(name);
    throw new Error(`Variable "${name}" not found`);
  }
}

const runtime = {
  globalEnv: new Environment(),
  functions: {},   // user functions / builtins: { name: { params:[], body:[] } }
  classes: {},     // classes: { ClassName: { methods: {name:{params,body}} } }
  output: []
};

// register small builtins
function registerBuiltIns() {
  runtime.functions.string = { params: ["value"], body: ["return String(value)"] };
  runtime.functions.number = { params: ["value"], body: ["return Number(value)"] };
  runtime.functions.bool   = { params: ["value"], body: ["return Boolean(value)"] };
  runtime.functions.print  = { params: ["v"], body: ["say v"] };
}
registerBuiltIns();

function resetRuntime() {
  runtime.globalEnv = new Environment();
  runtime.functions = {};
  runtime.classes = {};
  runtime.output = [];
  registerBuiltIns();
}

// --------------------------
// Helpers: indentation, arg splitting
// --------------------------
function normalizeLines(code) {
  // convert tabs to 4 spaces to unify indentation
  return code.replace(/\t/g, "    ").split(/\r?\n/);
}

function collectIndentedBlock(lines, startIndex) {
  // determine base indent from first non-empty line at or after startIndex
  let i = startIndex;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return { block: [], next: i };

  const baseIndentLen = (lines[i].match(/^\s*/)[0] || "").length;
  const block = [];
  let j = startIndex;
  while (j < lines.length) {
    const raw = lines[j];
    if (raw.trim() === "") { block.push(""); j++; continue; }
    const leadLen = (raw.match(/^\s*/)[0] || "").length;
    if (leadLen < baseIndentLen) break;
    block.push(raw.slice(baseIndentLen));
    j++;
  }
  return { block, next: j };
}

function splitArgs(argStr) {
  argStr = argStr.trim();
  if (!argStr) return [];
  const args = [];
  let depth = 0;
  let inStr = false;
  let strCh = null;
  let start = 0;
  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i];
    if (inStr) {
      if (ch === strCh && argStr[i-1] !== "\\") { inStr = false; strCh = null; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === '(' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === ']') { depth--; continue; }
    if (ch === ',' && depth === 0) {
      args.push(argStr.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = argStr.slice(start).trim();
  if (last !== "") args.push(last);
  return args;
}

function isStringLiteral(s) {
  return /^"(?:[^"\\]|\\.)*"$/.test(s) || /^'(?:[^'\\]|\\.)*'$/.test(s);
}

// split top-level operator by scanning right-to-left (handles multi-char ops)
function splitAtTopLevel(expr, operators) {
  let depth = 0;
  let inStr = false;
  let strCh = null;
  const sortedOps = operators.slice().sort((a,b)=>b.length - a.length);
  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i];
    if (inStr) {
      if (ch === strCh && expr[i-1] !== "\\") { inStr = false; strCh = null; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === ')') { depth++; continue; }
    if (ch === '(') { depth--; continue; }
    if (depth === 0) {
      for (const op of sortedOps) {
        const start = i - op.length + 1;
        if (start >= 0 && expr.slice(start, start + op.length) === op) {
          return [expr.slice(0, start), op, expr.slice(start + op.length)];
        }
      }
    }
  }
  return null;
}

// --------------------------
// Expression evaluation
// --------------------------
function evalExpression(raw, env) {
  let expr = String(raw).trim();

  // remove fully wrapping parentheses
  while (expr.startsWith("(") && expr.endsWith(")")) {
    let depth = 0, balanced = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")") depth--;
      if (depth === 0 && i < expr.length - 1) { balanced = false; break; }
    }
    if (balanced) expr = expr.slice(1, -1).trim();
    else break;
  }

  // comparison operators
  let parts = splitAtTopLevel(expr, ["==","!=","<=",">=","<",">"]);
  if (parts) {
    const left = evalExpression(parts[0], env);
    const op = parts[1];
    const right = evalExpression(parts[2], env);
    switch (op) {
      case "==": return left == right;
      case "!=": return left != right;
      case "<=": return left <= right;
      case ">=": return left >= right;
      case "<": return left < right;
      case ">": return left > right;
    }
  }

  // + and - (string concat handled)
  parts = splitAtTopLevel(expr, ["+","-"]);
  if (parts) {
    const a = evalExpression(parts[0], env);
    const b = evalExpression(parts[2], env);
    if (parts[1] === "+") {
      if (typeof a === "number" && typeof b === "number") return a + b;
      return String(a) + String(b);
    } else {
      return a - b;
    }
  }

  // * and /
  parts = splitAtTopLevel(expr, ["*","/"]);
  if (parts) {
    const a = evalExpression(parts[0], env);
    const b = evalExpression(parts[2], env);
    if (parts[1] === "*") return a * b;
    return a / b;
  }

  // string literal
  if (isStringLiteral(expr)) {
    return expr.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  // number
  if (!Number.isNaN(Number(expr))) return Number(expr);

  // boolean
  if (expr === "true") return true;
  if (expr === "false") return false;

  // list literal
  if (expr.startsWith("[") && expr.endsWith("]")) {
    try { return JSON.parse(expr.replace(/'/g, '"')); } catch { throw new Error("Invalid list literal"); }
  }

  // index: name[expr]
  let idx = expr.match(/^(\w+)\[(.+)\]$/);
  if (idx) {
    const base = env.get(idx[1]);
    const indexVal = evalExpression(idx[2], env);
    if ((Array.isArray(base) || typeof base === "string") && Number.isInteger(indexVal)) {
      if (indexVal < 0 || indexVal >= base.length) throw new Error("Index out of bounds");
      return base[indexVal];
    }
    throw new Error(`Cannot index into "${idx[1]}"`);
  }

  // property: obj.prop
  let prop = expr.match(/^(\w+)\.(\w+)$/);
  if (prop) {
    const obj = env.get(prop[1]);
    if (obj && typeof obj === "object" && prop[2] in obj) return obj[prop[2]];
    // if the object is a class instance with __fields store, try that
    if (obj && obj.__fields && prop[2] in obj.__fields) return obj.__fields[prop[2]];
    throw new Error(`Property "${prop[2]}" not found on "${prop[1]}"`);
  }

  // method or function call: name(args) or obj.method(args)
  let call = expr.match(/^(\w+)\((.*)\)$/);
  if (call) {
    const name = call[1];
    const argStr = call[2];
    const args = argStr.trim() ? splitArgs(argStr).map(a => evalExpression(a, env)) : [];

    // class constructor ClassName(...)
    if (name in runtime.classes) {
      return instantiateClass(name, args);
    }

    // function call (user-defined or builtin)
    if (name in runtime.functions) {
      return callFunction(name, args, env);
    }

    // If name is a variable that is an object with method
    if (env.isDeclared(name)) {
      const maybeObj = env.get(name);
      if (maybeObj && typeof maybeObj === "object" && maybeObj.__call) {
        return maybeObj.__call(...args);
      }
    }

    throw new Error(`Function or class "${name}" not found`);
  }

  // new ClassName(...)
  let newMatch = expr.match(/^new\s+(\w+)\((.*)\)$/);
  if (newMatch) {
    const cname = newMatch[1];
    const argStr = newMatch[2];
    const args = argStr.trim() ? splitArgs(argStr).map(a => evalExpression(a, env)) : [];
    return instantiateClass(cname, args);
  }

  // variable
  if (env.isDeclared(expr)) return env.get(expr);

  throw new Error(`Variable "${expr}" not found`);
}

// --------------------------
// Functions & Classes runtime
// --------------------------
function callFunction(name, args, callerEnv) {
  const func = runtime.functions[name];
  if (!func) throw new Error(`Function "${name}" not found`);
  const fenv = new Environment(runtime.globalEnv);
  (func.params || []).forEach((p, i) => { if (p) fenv.declareVar(p, args[i]); });

  try {
    interpretBlock(func.body.slice(), fenv);
  } catch (ctrl) {
    if (ctrl && ctrl.type === "return") return ctrl.value;
    throw ctrl;
  }
  return null;
}

function instantiateClass(className, args) {
  const cls = runtime.classes[className];
  if (!cls) throw new Error(`Class "${className}" not found`);

  // instance structure: __class (class def), __fields (property storage)
  const instance = { __className: className, __classDef: cls, __fields: {} };

  // attach methods as bound functions
  for (const mName of Object.keys(cls.methods)) {
    instance[mName] = function (...callArgs) {
      const method = cls.methods[mName];
      const menv = new Environment(runtime.globalEnv);
      // expose 'self' variable inside method environment
      menv.declareVar("self", instance);
      (method.params || []).forEach((p,i) => { if (p) menv.declareVar(p, callArgs[i]); });
      try {
        interpretBlock(method.body.slice(), menv);
      } catch (ctrl) {
        if (ctrl && ctrl.type === "return") return ctrl.value;
        throw ctrl;
      }
      return null;
    };
  }

  // call init/constructor method if exists (support init or constructor)
  if (cls.methods.init) {
    instance.init(...(args || []));
  } else if (cls.methods.constructor) {
    instance.constructor(...(args || []));
  }

  return instance;
}

// --------------------------
// Core interpreter (block)
 // --------------------------
function interpretBlock(lines, env) {
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) { i++; continue; }

    // BREAK / CONTINUE
    if (line === "break") throw { type: "break" };
    if (line === "continue") throw { type: "continue" };

    // function declaration: function name(params):
    let m = line.match(/^function\s+(\w+)\(([\w\s,]*)\):$/);
    if (m) {
      const name = m[1];
      const params = m[2].split(",").map(s => s.trim()).filter(Boolean);
      const { block, next } = collectIndentedBlock(lines, i+1);
      runtime.functions[name] = { params, body: block };
      i = next;
      continue;
    }

    // class declaration: class Name:
    m = line.match(/^class\s+(\w+):$/);
    if (m) {
      const className = m[1];
      const { block, next } = collectIndentedBlock(lines, i+1);
      // parse methods inside class
      const methods = {};
      let j = 0;
      while (j < block.length) {
        const ln = block[j].trim();
        const fnMatch = ln.match(/^function\s+(\w+)\(([\w\s,]*)\):$/);
        if (fnMatch) {
          const mName = fnMatch[1];
          const params = fnMatch[2].split(",").map(s => s.trim()).filter(Boolean);
          const { block: methodBody, next: mnext } = collectIndentedBlock(block, j+1);
          methods[mName] = { params, body: methodBody };
          j = mnext;
          continue;
        }
        j++;
      }
      runtime.classes[className] = { methods };
      i = next;
      continue;
    }

    // if ... else:
    m = line.match(/^if\s+(.+):$/);
    if (m) {
      const condExpr = m[1];
      const { block: ifBody, next } = collectIndentedBlock(lines, i+1);
      i = next;
      let elseBody = null;
      if (i < lines.length && lines[i].trim().startsWith("else:")) {
        const { block: eb, next: n2 } = collectIndentedBlock(lines, i+1);
        elseBody = eb;
        i = n2;
      }
      if (evalExpression(condExpr, env)) interpretBlock(ifBody, new Environment(env));
      else if (elseBody) interpretBlock(elseBody, new Environment(env));
      continue;
    }

    // while cond:
    m = line.match(/^while\s+(.+):$/);
    if (m) {
      const condExpr = m[1];
      const { block, next } = collectIndentedBlock(lines, i+1);
      i = next;
      loopWhile:
      while (evalExpression(condExpr, env)) {
        try {
          interpretBlock(block, env); // reuse env so outer vars persist
        } catch (ctrl) {
          if (ctrl.type === "break") break loopWhile;
          if (ctrl.type === "continue") continue loopWhile;
          throw ctrl;
        }
      }
      continue;
    }

    // repeat N:
    m = line.match(/^repeat\s+(.+):$/);
    if (m) {
      const countExpr = m[1];
      const { block, next } = collectIndentedBlock(lines, i+1);
      i = next;
      const val = evalExpression(countExpr, env);
      const count = Number(val);
      if (!Number.isFinite(count) || count < 0) throw new Error("repeat count must be a non-negative number");
      loopRepeat:
      for (let r = 0; r < Math.floor(count); r++) {
        try {
          interpretBlock(block, env); // reuse env intentionally
        } catch (ctrl) {
          if (ctrl.type === "break") break loopRepeat;
          if (ctrl.type === "continue") continue loopRepeat;
          throw ctrl;
        }
      }
      continue;
    }

    // for var = start to end:
    m = line.match(/^for\s+(\w+)\s*=\s*(.+)\s+to\s+(.+):$/);
    if (m) {
      const varName = m[1];
      const startVal = evalExpression(m[2], env);
      const endVal = evalExpression(m[3], env);
      const { block, next } = collectIndentedBlock(lines, i+1);
      i = next;
      loopFor:
      for (let v = Number(startVal); v <= Number(endVal); v++) {
        try {
          if (env.isDeclared(varName)) env.set(varName, v); else env.declareVar(varName, v);
          interpretBlock(block, env);
        } catch (ctrl) {
          if (ctrl.type === "break") break loopFor;
          if (ctrl.type === "continue") continue loopFor;
          throw ctrl;
        }
      }
      continue;
    }

    // for var in range(a,b):
    m = line.match(/^for\s+(\w+)\s+in\s+range\((.+),\s*(.+)\):$/);
    if (m) {
      const varName = m[1];
      const startVal = evalExpression(m[2], env);
      const endVal = evalExpression(m[3], env);
      const { block, next } = collectIndentedBlock(lines, i+1);
      i = next;
      loopFor2:
      for (let v = Number(startVal); v < Number(endVal); v++) {
        try {
          if (env.isDeclared(varName)) env.set(varName, v); else env.declareVar(varName, v);
          interpretBlock(block, env);
        } catch (ctrl) {
          if (ctrl.type === "break") break loopFor2;
          if (ctrl.type === "continue") continue loopFor2;
          throw ctrl;
        }
      }
      continue;
    }

    // input var = promptExpr
    m = line.match(/^input\s+(\w+)\s*=\s*(.+)$/);
    if (m) {
      const name = m[1];
      const promptExpr = m[2];
      const promptTxt = String(evalExpression(promptExpr, env));
      const userVal = (typeof window !== "undefined") ? window.prompt(promptTxt) : "";
      if (env.isDeclared(name)) env.set(name, userVal); else env.declareVar(name, userVal);
      i++; continue;
    }

    // property assignment: obj.prop = expr OR set this.prop = expr
    m = line.match(/^set\s+this\.(\w+)\s*=\s*(.+)$/);
    if (m) {
      // must be inside method with 'self' available in scope
      const prop = m[1], expr = m[2];
      // attempt to look up 'self' from current env chain
      let walker = env;
      let selfObj = null;
      while (walker) {
        if (walker.isDeclared && walker.isDeclared("self")) { selfObj = walker.get("self"); break; }
        // if walker doesn't have isDeclared method, break
        if (!walker.parent) break;
        walker = walker.parent;
      }
      if (!selfObj) {
        // fallback: try global variable "self"
        try { selfObj = runtime.globalEnv.get("self"); } catch {}
      }
      if (!selfObj) throw new Error("Cannot use 'this' outside method (no self found)");
      selfObj.__fields[prop] = evalExpression(expr, env);
      i++; continue;
    }

    // obj.prop = expr
    m = line.match(/^(\w+)\.(\w+)\s*=\s*(.+)$/);
    if (m) {
      const objName = m[1], prop = m[2], expr = m[3];
      const obj = env.get(objName);
      if (!obj) throw new Error(`Object ${objName} not found`);
      if (!obj.__fields) obj[prop] = evalExpression(expr, env);
      else obj.__fields[prop] = evalExpression(expr, env);
      i++; continue;
    }

    // say expr
    m = line.match(/^say\s+(.+)$/);
    if (m) {
      const val = evalExpression(m[1], env);
      runtime.output.push(String(val));
      // update UI instantly if attached
      const outEl = document.getElementById("output");
      if (outEl) outEl.textContent = runtime.output.join("\n");
      i++; continue;
    }

    // set CONST var
    m = line.match(/^set\s+(\w+)\s*=\s*(.+)$/);
    if (m) {
      const name = m[1], expr = m[2];
      if (env.isDeclared(name)) throw new Error(`Variable "${name}" already declared`);
      env.declareConst(name, evalExpression(expr, env));
      i++; continue;
    }

    // let var = expr
    m = line.match(/^let\s+(\w+)\s*=\s*(.+)$/);
    if (m) {
      const name = m[1], expr = m[2];
      const val = evalExpression(expr, env);
      if (env.isDeclared(name)) env.set(name, val); else env.declareVar(name, val);
      i++; continue;
    }

    // assignment var = expr
    m = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (m) {
      const name = m[1], expr = m[2];
      const val = evalExpression(expr, env);
      if (env.isDeclared(name)) env.set(name, val); else env.declareVar(name, val);
      i++; continue;
    }

    // return inside functions
    m = line.match(/^return\s+(.+)$/);
    if (m) {
      const v = evalExpression(m[1], env);
      throw { type: "return", value: v };
    }

    throw new Error(`Unknown or invalid syntax: "${line}"`);
  }
}

// --------------------------
// Runner & DOM hooks
// --------------------------
function clearOutputUI() {
  runtime.output = [];
  const outEl = document.getElementById("output");
  if (outEl) outEl.textContent = "";
}

function runCodeFromEditor(code) {
  resetRuntime();
  clearOutputUI();
  const lines = normalizeLines(code);
  try {
    const start = performance.now();
    interpretBlock(lines, runtime.globalEnv);
    const end = performance.now();
    runtime.output.push("");
    runtime.output.push(`Execution Time: ${(end - start).toFixed(2)} ms`);
    runtime.output.push(`Executed on: ${new Date().toLocaleString()}`);
    const outEl = document.getElementById("output");
    if (outEl) outEl.textContent = runtime.output.join("\n");
  } catch (e) {
    runtime.output.push(`Error: ${e && e.message ? e.message : String(e)}`);
    const outEl = document.getElementById("output");
    if (outEl) outEl.textContent = runtime.output.join("\n");
  }
}

// attach buttons (if present)
document.addEventListener("DOMContentLoaded", () => {
  const runBtn = document.getElementById("runButton");
  const clearBtn = document.getElementById("clearButton");
  const editorInput = document.getElementById("editorInput");

  if (runBtn) {
    runBtn.addEventListener("click", () => {
      const code = editorInput ? editorInput.value : "";
      runCodeFromEditor(code);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => clearOutputUI());
  }
});
