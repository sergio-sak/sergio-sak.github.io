/* ==========================
   0. Utilities & Storage
========================== */
const LS_KEYS = { //Keys In Local Storage
  HISTORY: "mspro_history_v1",
  OPENAI_KEY: "mspro_openai_key",
  OPENAI_MODEL: "mspro_openai_model",
  WA_APPID: "mspro_wa_appid"
};

function toLatexExpr(expr){
  let s = insertImplicitMultiplicationForLatex(expr.trim());


  if(!s) return "";

  // ---- constants (preview autocomplete) ----
  // replace whole-word pi with \pi
  s = s.replace(/\bpi\b/gi, "\\pi");
  // e is fine as plain "e" in KaTeX, but keep whole-word only
  s = s.replace(/\be\b/gi, "e");

  // ---- functions (autocomplete) ----
  // add backslashes + nicer parentheses
  s = s.replace(/sin\(/gi, "\\sin(");
s = s.replace(/cos\(/gi, "\\cos(");
s = s.replace(/tan\(/gi, "\\tan(");
s = s.replace(/ln\(/gi, "\\ln(");
s = s.replace(/exp\(/gi, "\\exp(");


  // sqrt needs braces in TeX
  s = s.replace(/sqrt\(/gi, "\\sqrt{");

  // abs(...) : turn into |...|
  // We'll do a simple transform: abs( -> \left| and later close with \right|
  s = s.replace(/abs\(/gi, "\\left|");

  // ---- operators ----
  s = s.replace(/\*/g, "\\cdot ");

  // Close sqrt braces + abs bars (simple but works for normal inputs)
  s = fixSqrtAndAbsClosings(s);

  return s;
}

function fixSqrtAndAbsClosings(s){
  let out = "";
  let sqrtStack = 0;
  let absStack = 0;

  for(let i=0;i<s.length;i++){
    // detect inserted "\sqrt{" and track it
    if(s.startsWith("\\sqrt{", i)){
      out += "\\sqrt{";
      sqrtStack++;
      i += "\\sqrt{".length - 1;
      continue;
    }

    // detect inserted "\left|" and track it
    if(s.startsWith("\\left|", i)){
      out += "\\left|";
      absStack++;
      i += "\\left|".length - 1;
      continue;
    }

    const c = s[i];

    // close sqrt at first ')' after it
    if(c === ")" && sqrtStack > 0){
      out += "}";
      sqrtStack--;
      continue;
    }

    // close abs at first ')' after it
    if(c === ")" && absStack > 0){
      out += "\\right|";
      absStack--;
      continue;
    }

    out += c;
  }

  return out;
}


function parseNumberWithConstants(str){
  if(typeof str !== "string") return NaN;

  let s = insertImplicitMultiplication(str.trim().toLowerCase());

  // basic replacements
  s = s.replaceAll("pi", Math.PI);
  s = s.replaceAll("e", Math.E);

  // handle simple expressions like "pi/2"
  try {
    return Function(`"use strict"; return (${s});`)();
  } catch {
    return NaN;
  }
}

function renderIntegralPreview(){
  const fx   = document.getElementById("int-fx").value.trim();
  const aStr = document.getElementById("int-a").value.trim();
  const bStr = document.getElementById("int-b").value.trim();

  const previewEl = document.getElementById("int-preview-math");

  if(!fx){
    previewEl.textContent = "";
    return;
  }

  if(typeof katex === "undefined"){
    previewEl.textContent = "KaTeX not loaded. Add CDN in <head>.";
    return;
  }

  const latexFx = toLatexExpr(fx);
  const latexA  = toLatexExpr(aStr || "0");
  const latexB  = toLatexExpr(bStr || "0");

  const latex = `\\int_{${latexA}}^{${latexB}} ${latexFx}\\, dx`;

  try{
    katex.render(latex, previewEl, {throwOnError: false});
  } catch(e){
    previewEl.textContent = "Preview error.";
  }
}



function loadLS(key, fallback=null){ //reads from lS
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return localStorage.getItem(key) ?? fallback; }
}
function saveLS(key, val){ //Obviously Saves
  if (typeof val === "string") localStorage.setItem(key, val);
  else localStorage.setItem(key, JSON.stringify(val));
}
function nowISO(){ return new Date().toISOString(); } //Way of parsing date(Used for the History Tab)
function fmt(x){ return (Math.abs(x) < 1e-12 ? 0 : x).toPrecision(12).replace(/\.?0+$/,''); } //Prettier Format, tiny numbers become zero

/* ==========================
   1. Math Keyboard
========================== */
const keyboardLayout = [ //Arr defininf the keypads and their order
  "7","8","9","("," )","^",
  "4","5","6","+","-","*",
  "1","2","3","/","x","y",
  "0",".","pi","e","abs(","sqrt(",
  "sin(","cos(","tan(","ln(","exp(","<-"
];

//Grabbing the ids from the ndex file

const kb = document.getElementById("keyboard");
let focusedField = document.getElementById("int-fx");

function setFocus(el){ //Basically Tracks which text area receives test
  document.querySelectorAll("textarea").forEach(t=>t.classList.remove("focus"));
  el.classList.add("focus");
  focusedField = el;
}

document.getElementById("int-fx").addEventListener("focus", e=>setFocus(e.target)); //When integral text clicked, focus
document.getElementById("ode-fxy").addEventListener("focus", e=>setFocus(e.target)); //Same

keyboardLayout.forEach(tok=>{ //For each token create a button
  const b = document.createElement("button");
  b.textContent = tok;
  b.onclick = () => insertToken(tok); //When clicked, insert it
  kb.appendChild(b);
});

function insertToken(tok){
  if(!focusedField) return;
  if(tok === "<-"){ // backspace
    const v = focusedField.value;
    focusedField.value = v.slice(0, -1);
    focusedField.focus();
    return;
  }
  // pretty spacing for operators, basically just adds spaces
  const ops = ["+","-","*","/","^"];
  if(ops.includes(tok)) tok = " " + tok + " ";
  focusedField.value += tok;
  focusedField.focus();
}

/* ==========================
   2. Tokenizer
========================== */

const FUNCTIONS = new Set(["sin","cos","tan","ln","exp","sqrt","abs"]);
const CONSTANTS = new Map([["pi",Math.PI],["e",Math.E]]); 
const OPERATORS = new Map([
  ["+", {prec:1, assoc:"L"}],
  ["-", {prec:1, assoc:"L"}],
  ["*", {prec:2, assoc:"L"}],
  ["/", {prec:2, assoc:"L"}],
  ["^", {prec:3, assoc:"R"}],
]); //Precision and associativity of operations

function insertImplicitMultiplication(expr){ //Self explanatory, allows 3x to be parsed as 3*x
  const s = (expr ?? "").replace(/\s+/g, ""); // remove spaces
  let out = "";
  let i = 0;

  const isDigit = c => /[0-9.]/.test(c);
  const isAlpha = c => /[a-zA-Z]/.test(c);

  let prevType = null;   // "num" | "word" | "open" | "close" | "op"
  let prevWord = null;   // last word token (sin, x, pi, etc.)

  while(i < s.length){
    const c = s[i];
    let tokenStr = "";
    let currType = null;
    let currWord = null;

    if(isDigit(c)){
      let j=i;
      while(j<s.length && isDigit(s[j])) j++;
      tokenStr = s.slice(i,j);
      currType = "num";
      i=j;
    } 
    else if(isAlpha(c)){
      let j=i;
      while(j<s.length && isAlpha(s[j])) j++;
      tokenStr = s.slice(i,j);
      currType = "word";
      currWord = tokenStr;
      i=j;
    } 
    else {
      tokenStr = c; 
      i++;
      if(c === "(") currType = "open";
      else if(c === ")") currType = "close";
      else currType = "op";
    }

    // should we insert * between prev and curr?
    if(out.length > 0){
      const prevIsValue = (prevType==="num" || prevType==="word" || prevType==="close");
      const currStartsValue = (currType==="num" || currType==="word" || currType==="open");

      if(prevIsValue && currStartsValue){
        // BUT don't insert between function name and "("  e.g. sin(, ln(, sqrt(
        const prevWasFunction = (prevType==="word" && currType==="open" && FUNCTIONS.has(prevWord));
        if(!prevWasFunction){
          out += "*";
        }
      }
    }

    out += tokenStr;
    prevType = currType;
    if(currWord) prevWord = currWord;
  }

  return out;
}

function insertImplicitMultiplicationForLatex(expr) {
  let s = expr ?? "";
  // Insert \cdot where needed so KaTeX renders nicely
  s = s.replace(/(\d)(?=\s*(pi|e|sin|cos|tan|ln|exp|sqrt|abs)\b)/gi, "$1\\cdot ");
  s = s.replace(/(pi|e)(?=\s*\()/gi, "$1\\cdot ");
  s = s.replace(/\)(?=\s*(pi|e|\d|\())/gi, ")\\cdot ");
  return s;
}



function tokenize(expr){
  const s = expr.replace(/\s+/g,''); //remove whitespaces to make my life easier
  const tokens = [];
  let i=0;

  const isDigit = c => /[0-9]/.test(c); //helpers
  const isAlpha = c => /[a-zA-Z]/.test(c);

  while(i < s.length){ //Scan left to right
    const c = s[i]; // c for Current

    // number (including leading minus) 
    if(isDigit(c) || (c===".")){
      let j=i;
      while(j<s.length && (isDigit(s[j]) || s[j]===".")) j++; // if number just push forward
      tokens.push({type:"num", value: parseFloat(s.slice(i,j))}); //add to tokens
      i=j; continue;
    }

    // Change unary minus to just 0 - expr
    if(c==="-" && (i===0 || s[i-1]==="(" || OPERATORS.has(s[i-1]))){ 
      tokens.push({type:"num", value:0});
      tokens.push({type:"op", value:"-"});
      i++; continue;
    }

    if(OPERATORS.has(c)){
      tokens.push({type:"op", value:c}); i++; continue; //push and move forward
    }

    if(c==="(" || c===")"){
      tokens.push({type:"paren", value:c}); i++; continue; //push as paren(thesis) and move
    }

    if(isAlpha(c)){
      let j=i;
      while(j<s.length && isAlpha(s[j])) j++;
      const name = s.slice(i,j); //get the word

      if(FUNCTIONS.has(name)){ //classifies word
        tokens.push({type:"func", value:name});
      } else if(CONSTANTS.has(name)){
        tokens.push({type:"num", value: CONSTANTS.get(name)});
      } else if(name==="x" || name==="y"){
        tokens.push({type:"var", value:name});
      } else {
        throw new Error("Unknown identifier: " + name);
      }
      i=j; continue;
    }

    throw new Error("Unexpected character: " + c); //if nothing matched throw error
  }
  return tokens;
}

/* ==========================
   3. Shunting-Yard -> RPN
   Algo that turns expressions to reverse polish notation, a notation that massively makes this process easier
   basically, 3 + 5 = 3 5 +
========================== */
function toRPN(tokens){
  const out = [];
  const stack = [];

  for(const t of tokens){
    if(t.type==="num" || t.type==="var"){
      out.push(t);
    } else if(t.type==="func"){
      stack.push(t);
    } else if(t.type==="op"){
      while(stack.length){
        const top = stack[stack.length-1];
        if(top.type==="func"){ out.push(stack.pop()); continue; }
        if(top.type==="op"){
          const a = OPERATORS.get(t.value);
          const b = OPERATORS.get(top.value);
          if( (a.assoc==="L" && a.prec<=b.prec) || (a.assoc==="R" && a.prec<b.prec) ){
            out.push(stack.pop()); continue;
          }
        }
        break;
      }
      stack.push(t);
    } else if(t.type==="paren" && t.value==="("){
      stack.push(t);
    } else if(t.type==="paren" && t.value===")"){
      while(stack.length && !(stack[stack.length-1].type==="paren" && stack[stack.length-1].value==="(")){
        out.push(stack.pop());
      }
      if(!stack.length) throw new Error("Mismatched parentheses");
      stack.pop(); // pop "("
      if(stack.length && stack[stack.length-1].type==="func"){
        out.push(stack.pop());
      }
    }
  }
  while(stack.length){
    const t = stack.pop();
    if(t.type==="paren") throw new Error("Mismatched parentheses");
    out.push(t);
  }
  return out;
}

/* ==========================
   4. RPN -> AST
   RPN to abstract syntax tree, basically a tree where the the operators preceed the objects
   Example: sin(x^2)+3 -> (RPN) x 2 ^ sin 3 + -> (AST)
          (+)
       /     \
     sin      3
     |
    (^)
   /   \
  x     2

========================== */

class Node { eval(vars){ throw "unimplemented"; } } //Tree structure

class NumNode extends Node { // Stores numeric value and eval returns it
  constructor(v){ super(); this.v=v; }
  eval(){ return this.v; }
}

class VarNode extends Node {  //Nodes for variables
  constructor(name){ super(); this.name=name; }
  eval(vars){  //reveives dict
    if(!(this.name in vars)) throw new Error("Variable "+this.name+" not provided");
    return vars[this.name];
  }
}

class UnaryNode extends Node {
  constructor(fn, child){ super(); this.fn=fn; this.child=child; } //function name, child name
  eval(vars){
    const x = this.child.eval(vars);
    switch(this.fn){ //Turns to actual functions that can me evaluated
      case "sin": return Math.sin(x);
      case "cos": return Math.cos(x);
      case "tan": return Math.tan(x);
      case "ln": return Math.log(x);
      case "exp": return Math.exp(x);
      case "sqrt": return Math.sqrt(x);
      case "abs": return Math.abs(x);
      default: throw new Error("Unknown function "+this.fn);
    }
  }
}
class BinNode extends Node {
  constructor(op, l, r){ super(); this.op=op; this.l=l; this.r=r; } //operation, left, right
  eval(vars){
    const a=this.l.eval(vars), b=this.r.eval(vars);
    switch(this.op){ //Apply the ops
      case "+": return a+b;
      case "-": return a-b;
      case "*": return a*b;
      case "/": return a/b;
      case "^": return Math.pow(a,b);
      default: throw new Error("Unknown op "+this.op);
    }
  }
}

function buildAST(rpn){ //self explanatory
  const st = []; //stack of nodes
  for(const t of rpn){ 
    if(t.type==="num") st.push(new NumNode(t.value));
    else if(t.type==="var") st.push(new VarNode(t.value));
    else if(t.type==="func"){
      const c = st.pop(); if(!c) throw new Error("Missing operand for "+t.value);
      st.push(new UnaryNode(t.value, c));
    } else if(t.type==="op"){
      const r=st.pop(), l=st.pop();
      if(!l||!r) throw new Error("Missing operand for "+t.value);
      st.push(new BinNode(t.value, l, r));
    }
  }
  if(st.length!==1) throw new Error("Invalid expression");
  return st[0];
}

function parseExpression(expr){ //pass the expression
  const fixed = insertImplicitMultiplication(expr);
  const toks = tokenize(fixed);
  const rpn = toRPN(toks);
  return buildAST(rpn);
}
/* ==========================
   5. Integral Solvers
========================== */
function trapezoidal(ast, a, b, n){
  const h=(b-a)/n;
  let sum = 0.5*(ast.eval({x:a}) + ast.eval({x:b}));
  for(let i=1;i<n;i++){
    sum += ast.eval({x:a+i*h});
  }
  return sum*h;
}

function simpson(ast, a, b, n){ 
  if(n%2===1) n++; // autofix incase user does not read the textbox ...
  const h=(b-a)/n;
  let sum = ast.eval({x:a}) + ast.eval({x:b});
  for(let i=1;i<n;i++){
    const x=a+i*h;
    sum += (i%2===0 ? 2 : 4)*ast.eval({x});
  }
  return sum*h/3;
}

/* ==========================
   6. ODE Solvers (IVP)
========================== */
function euler(astF, x0, y0, xEnd, h){ 
  const pts=[];
  let x=x0, y=y0;
  pts.push([x,y]);
  const steps = Math.ceil((xEnd-x0)/h);
  for(let k=0;k<steps;k++){
    const dy = astF.eval({x,y});
    y = y + h*dy;
    x = x + h;
    pts.push([x,y]);
  }
  return pts;
}

function rk4(astF, x0, y0, xEnd, h){
  const pts=[];
  let x=x0, y=y0;
  pts.push([x,y]);
  const steps = Math.ceil((xEnd-x0)/h);
  for(let k=0;k<steps;k++){
    const k1 = astF.eval({x, y});
    const k2 = astF.eval({x:x+h/2, y:y+h*k1/2});
    const k3 = astF.eval({x:x+h/2, y:y+h*k2/2});
    const k4 = astF.eval({x:x+h, y:y+h*k3});
    y = y + (h/6)*(k1+2*k2+2*k3+k4);
    x = x + h;
    pts.push([x,y]);
  }
  return pts;
}

/* ==========================
   7. History (LocalStorage)
========================== */

function getHistory(){ return loadLS(LS_KEYS.HISTORY, []); }
function pushHistory(entry){
  const h = getHistory();
  h.unshift(entry);
  saveLS(LS_KEYS.HISTORY, h.slice(0,50));
  renderHistory();
}
function clearHistory(){
  saveLS(LS_KEYS.HISTORY, []);
  renderHistory();
}

function renderHistory(){
  const wrap = document.getElementById("history");
  wrap.innerHTML = "";
  const h = getHistory();
  if(!h.length){
    wrap.innerHTML = "<div class='muted'>No problems yet.</div>";
    return;
  }
  h.forEach((e, idx)=>{
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div class="flex">
        <span class="pill">${e.type}</span>
        <span class="muted" style="font-size:11px;">${e.timestamp}</span>
      </div>
      <div style="margin-top:4px;"><b>${e.expression}</b></div>
      <div class="muted" style="font-size:12px;margin-top:2px;">${JSON.stringify(e.params)}</div>
      <div class="muted" style="font-size:12px;margin-top:2px;">Result: ${JSON.stringify(e.result)}</div>
      <div class="flex" style="margin-top:6px;">
        <button class="small ghost" data-idx="${idx}">Load</button>
      </div>`;
    div.querySelector("button").onclick = ()=>{
      if(e.type==="integral"){
        activateTab("integral");
        document.getElementById("int-fx").value = e.expression;
        document.getElementById("int-a").value = e.params.a;
        document.getElementById("int-b").value = e.params.b;
        document.getElementById("int-n").value = e.params.n;
        renderIntegralPreview();
      } else {
        activateTab("ode");
        document.getElementById("ode-fxy").value = e.expression;
        document.getElementById("ode-x0").value = e.params.x0;
        document.getElementById("ode-y0").value = e.params.y0;
        document.getElementById("ode-xend").value = e.params.xEnd;
        document.getElementById("ode-h").value = e.params.h;
      }
      setOutput("Loaded from history.");
    };
    wrap.appendChild(div);
  });
}

/* ==========================
   8. OpenAI Practice Generation
   Uses Responses API (client-side demo).
========================== */
async function openaiGeneratePractice(kind, solvedProblem){
  const key = localStorage.getItem(LS_KEYS.OPENAI_KEY);
  const model = localStorage.getItem(LS_KEYS.OPENAI_MODEL) || "gpt-4.1-mini";
  if(!key) throw new Error("OpenAI key missing. Set it in Settings.");

  const prompt = kind==="integral"
    ? `Create ONE new definite integral practice problem similar in technique and difficulty to this one:
       ${solvedProblem.expression} on [${solvedProblem.params.a}, ${solvedProblem.params.b}].
       Respond ONLY with a JSON object:
       {"type":"integral","expression":"...","a":..., "b":..., "n_suggested":...}`
    : `Create ONE new first-order ODE IVP similar in technique and difficulty to this one:
       y' = ${solvedProblem.expression}, y(${solvedProblem.params.x0})=${solvedProblem.params.y0}, solve up to x=${solvedProblem.params.xEnd}.
       Respond ONLY with a JSON object:
       {"type":"ode","expression":"...","x0":..., "y0":..., "xEnd":..., "h_suggested":...}`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization":`Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 200
    })
  });

  if(!res.ok){
    const t = await res.text();
    throw new Error("OpenAI error: "+t);
  }
  const data = await res.json();
  const text = (data.output_text || "").trim();

  let obj;
  try { obj = JSON.parse(text); }
  catch {
    // fallback: try to find json in text
    const m = text.match(/\{[\s\S]*\}/);
    if(!m) throw new Error("Could not parse practice JSON.");
    obj = JSON.parse(m[0]);
  }
  return obj;
}

/* ==========================
   9. WolframAlpha Verification
   Uses LLM API text endpoint.
========================== */
async function wolframVerifyIntegral(expr, a, b){
  const appid = localStorage.getItem(LS_KEYS.WA_APPID);
  if(!appid) throw new Error("WolframAlpha AppID missing. Set it in Settings.");

  const query = `integrate ${expr} from ${a} to ${b}`;
  const url = `https://www.wolframalpha.com/api/v1/llm-api?appid=${encodeURIComponent(appid)}&input=${encodeURIComponent(query)}`;

  const r = await fetch(url);
  if(!r.ok) throw new Error("WolframAlpha request failed.");
  const text = await r.text();

  // naive numeric extraction (good enough for IA demo)
  const num = extractFirstNumber(text);
  return {raw:text, value:num};
}

async function wolframVerifyODE(expr, x0, y0, xEnd){
  const appid = localStorage.getItem(LS_KEYS.WA_APPID);
  if(!appid) throw new Error("WolframAlpha AppID missing. Set it in Settings.");

  const query = `solve dy/dx = ${expr}, y(${x0})=${y0}, give y(${xEnd}) numeric`;
  const url = `https://www.wolframalpha.com/api/v1/llm-api?appid=${encodeURIComponent(appid)}&input=${encodeURIComponent(query)}`;

  const r = await fetch(url);
  if(!r.ok) throw new Error("WolframAlpha request failed.");
  const text = await r.text();

  const num = extractFirstNumber(text);
  return {raw:text, value:num};
}

function extractFirstNumber(text){
  const m = text.replace(/−/g,"-").match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/* ==========================
   10. UI Actions
========================== */
const outputEl = document.getElementById("output");
function setOutput(msg){ outputEl.textContent = msg; }

function activateTab(which){
  const tInt = document.getElementById("tab-integral");
  const tOde = document.getElementById("tab-ode");
  const pInt = document.getElementById("panel-integral");
  const pOde = document.getElementById("panel-ode");

  if(which==="integral"){
    tInt.classList.add("active"); tOde.classList.remove("active");
    pInt.style.display="block"; pOde.style.display="none";
    setFocus(document.getElementById("int-fx"));
  } else {
    tOde.classList.add("active"); tInt.classList.remove("active");
    pOde.style.display="block"; pInt.style.display="none";
    setFocus(document.getElementById("ode-fxy"));
  }
}
document.getElementById("tab-integral").onclick = ()=>activateTab("integral");
document.getElementById("tab-ode").onclick = ()=>activateTab("ode");

document.getElementById("solve-integral").onclick = ()=>{
  try{
    const fx = document.getElementById("int-fx").value;
    const a = parseNumberWithConstants(document.getElementById("int-a").value);
    const b = parseNumberWithConstants(document.getElementById("int-b").value);
    let n = parseInt(document.getElementById("int-n").value,10);
    const tol = parseFloat(document.getElementById("int-tol").value);

    const ast = parseExpression(fx);
    const trap = trapezoidal(ast, a, b, n);
    const simp = simpson(ast, a, b, n);
    const diff = Math.abs(trap-simp);

    if (!isFinite(trap) || !isFinite(simp)) {
    setOutput(
        "Possible improper integral detected.\n" +
        "The integrand may blow up or reach undefined values at the limits or inside the interval.\n" +
        "Try narrowing the interval or verifying the integrand's domain. For example try adding 0.001"
    );
    return;
}


    let msg = `Integral of f(x) from ${a} to ${b}\n`
            + `f(x) = ${fx}\n\n`
            + `Trapezoidal = ${fmt(trap)}\n`
            + `Simpson     = ${fmt(simp)}\n`
            + `|diff|      = ${fmt(diff)}\n`
            + (diff>tol ? `\nWARNING: methods differ above tolerance ${tol}` : `\nOK: within tolerance ${tol}`);

    setOutput(msg);

    pushHistory({
      type:"integral",
      expression: fx,
      params:{a,b,n},
      result:{trapezoidal:trap, simpson:simp, diff},
      timestamp: nowISO()
    });

    document.getElementById("int-status").textContent = "";
  } catch(e){
    setOutput("Error: "+e.message);
  }
};

document.getElementById("solve-ode").onclick = ()=>{
  try{
    const fxy = document.getElementById("ode-fxy").value;
    const x0 = parseFloat(document.getElementById("ode-x0").value);
    const y0 = parseFloat(document.getElementById("ode-y0").value);
    const xEnd = parseFloat(document.getElementById("ode-xend").value);
    const h = parseFloat(document.getElementById("ode-h").value);
    const tol = parseFloat(document.getElementById("ode-tol").value);

    if(xEnd<=x0) throw new Error("x_end must be greater than x0.");

    const astF = parseExpression(fxy);
    const ptsE = euler(astF, x0, y0, xEnd, h);
    const ptsR = rk4(astF, x0, y0, xEnd, h);

    const yE = ptsE[ptsE.length-1][1];
    const yR = ptsR[ptsR.length-1][1];
    const diff = Math.abs(yE - yR);

    let msg = `ODE IVP y' = F(x,y)\nF(x,y) = ${fxy}\n`
            + `y(${x0}) = ${y0}, step h=${h}, x_end=${xEnd}\n\n`
            + `Euler final y(${xEnd}) = ${fmt(yE)}\n`
            + `RK4   final y(${xEnd}) = ${fmt(yR)}\n`
            + `|diff|               = ${fmt(diff)}\n`
            + (diff>tol ? `\nWARNING: methods differ above tolerance ${tol}` : `\nOK: within tolerance ${tol}`);

    // include small table preview
    msg += `\n\nSample points (x, y_Euler, y_RK4):\n`;
    const stepPreview = Math.max(1, Math.floor(ptsE.length/8));
    for(let i=0;i<ptsE.length;i+=stepPreview){
      const [xe, ye] = ptsE[i];
      const yr = ptsR[i][1];
      msg += `${fmt(xe)}\t${fmt(ye)}\t${fmt(yr)}\n`;
    }

    setOutput(msg);

    pushHistory({
      type:"ode",
      expression: fxy,
      params:{x0,y0,xEnd,h},
      result:{euler_final:yE, rk4_final:yR, diff},
      timestamp: nowISO()
    });

    document.getElementById("ode-status").textContent = "";
  } catch(e){
    setOutput("Error: "+e.message);
  }
};

// Verification buttons
document.getElementById("verify-integral").onclick = async ()=>{
  try{
    const fx = document.getElementById("int-fx").value;
    const a = parseFloat(document.getElementById("int-a").value);
    const b = parseFloat(document.getElementById("int-b").value);
    document.getElementById("int-status").textContent = "Verifying...";
    const wa = await wolframVerifyIntegral(fx, a, b);

    const h = getHistory()[0];
    const local = h?.type==="integral" ? h.result.simpson : null;
    const waVal = wa.value;

    let msg = outputEl.textContent + `\n\n--- WolframAlpha Verification ---\n`
      + `Query: integrate ${fx} from ${a} to ${b}\n`
      + `WA value extracted: ${waVal===null?"(could not extract)":fmt(waVal)}\n`;

    if(local!=null && waVal!=null){
      const d = Math.abs(local-waVal);
      msg += `Difference vs Simpson: ${fmt(d)}\n`;
    } else {
      msg += `Raw WA response:\n${wa.raw}\n`;
    }
    setOutput(msg);
    document.getElementById("int-status").textContent = "";
  } catch(e){
    document.getElementById("int-status").textContent = "";
    setOutput("Verification error: "+e.message);
  }
};

document.getElementById("verify-ode").onclick = async ()=>{
  try{
    const fxy = document.getElementById("ode-fxy").value;
    const x0 = parseFloat(document.getElementById("ode-x0").value);
    const y0 = parseFloat(document.getElementById("ode-y0").value);
    const xEnd = parseFloat(document.getElementById("ode-xend").value);
    document.getElementById("ode-status").textContent = "Verifying...";
    const wa = await wolframVerifyODE(fxy, x0, y0, xEnd);

    const h = getHistory()[0];
    const local = h?.type==="ode" ? h.result.rk4_final : null;
    const waVal = wa.value;

    let msg = outputEl.textContent + `\n\n--- WolframAlpha Verification ---\n`
      + `Query: solve dy/dx=${fxy}, y(${x0})=${y0}, y(${xEnd})\n`
      + `WA value extracted: ${waVal===null?"(could not extract)":fmt(waVal)}\n`;

    if(local!=null && waVal!=null){
      const d = Math.abs(local-waVal);
      msg += `Difference vs RK4: ${fmt(d)}\n`;
    } else {
      msg += `Raw WA response:\n${wa.raw}\n`;
    }
    setOutput(msg);
    document.getElementById("ode-status").textContent = "";
  } catch(e){
    document.getElementById("ode-status").textContent = "";
    setOutput("Verification error: "+e.message);
  }
};

// Practice generation buttons
document.getElementById("practice-integral").onclick = async ()=>{
  try{
    const last = getHistory().find(e=>e.type==="integral");
    if(!last) throw new Error("Solve an integral first.");
    document.getElementById("int-status").textContent = "Generating practice...";
    const pr = await openaiGeneratePractice("integral", last);

    // load into UI
    activateTab("integral");
    document.getElementById("int-fx").value = pr.expression;
    document.getElementById("int-a").value = pr.a ?? last.params.a;
    document.getElementById("int-b").value = pr.b ?? last.params.b;
    document.getElementById("int-n").value = pr.n_suggested ?? last.params.n;

    setOutput(`Practice generated:\n∫_${pr.a}^{${pr.b}} ${pr.expression} dx (suggested n=${pr.n_suggested})`);
    document.getElementById("int-status").textContent = "";
  } catch(e){
    document.getElementById("int-status").textContent = "";
    setOutput("Practice error: "+e.message);
  }
};

document.getElementById("practice-ode").onclick = async ()=>{
  try{
    const last = getHistory().find(e=>e.type==="ode");
    if(!last) throw new Error("Solve an ODE first.");
    document.getElementById("ode-status").textContent = "Generating practice...";
    const pr = await openaiGeneratePractice("ode", last);

    activateTab("ode");
    document.getElementById("ode-fxy").value = pr.expression;
    document.getElementById("ode-x0").value = pr.x0 ?? last.params.x0;
    document.getElementById("ode-y0").value = pr.y0 ?? last.params.y0;
    document.getElementById("ode-xend").value = pr.xEnd ?? last.params.xEnd;
    document.getElementById("ode-h").value = pr.h_suggested ?? last.params.h;

    setOutput(`Practice generated:\nSolve y'=${pr.expression}, y(${pr.x0})=${pr.y0}, to x=${pr.xEnd}`);
    document.getElementById("ode-status").textContent = "";
  } catch(e){
    document.getElementById("ode-status").textContent = "";
    setOutput("Practice error: "+e.message);
  }
};

/* ==========================
   11. Settings Dialog
========================== */
const modal = document.getElementById("settings-modal");
document.getElementById("btn-settings").onclick = ()=>{
  modal.style.display="block";
  document.getElementById("openai-key").value = localStorage.getItem(LS_KEYS.OPENAI_KEY) || "";
  document.getElementById("openai-model").value = localStorage.getItem(LS_KEYS.OPENAI_MODEL) || "gpt-4.1-mini";
  document.getElementById("wa-appid").value = localStorage.getItem(LS_KEYS.WA_APPID) || "";
};
document.getElementById("close-settings").onclick = ()=> modal.style.display="none";
document.getElementById("save-settings").onclick = ()=>{
  saveLS(LS_KEYS.OPENAI_KEY, document.getElementById("openai-key").value.trim());
  saveLS(LS_KEYS.OPENAI_MODEL, document.getElementById("openai-model").value.trim());
  saveLS(LS_KEYS.WA_APPID, document.getElementById("wa-appid").value.trim());
  modal.style.display="none";
  setOutput("Settings saved.");
};

document.getElementById("clear-history").onclick = clearHistory;

/* ==========================
   12. Init
========================== */
["int-fx","int-a","int-b"].forEach(id=>{
  document.getElementById(id).addEventListener("input", renderIntegralPreview);
});

// render once on load
renderIntegralPreview();

renderHistory();
setOutput(
`Try an example:\nIntegral tab:\n  f(x)=sin(x)\n  a=0, b=pi\nThen Solve.\n\nODE tab example:\n  F(x,y)=y - x^2 + 1\n  x0=0,y0=0.5,x_end=2,h=0.1`
);