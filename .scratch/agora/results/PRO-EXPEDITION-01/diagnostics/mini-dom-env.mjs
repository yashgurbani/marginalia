const observers = new Map();
function notifyMutation(target) {
  for (const observer of observers.get(target) || []) queueMicrotask(() => observer.callback([{ target }]));
}
class Style {
  removeProperty(name) { delete this[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
}
class ClassList {
  constructor(el) { this.el = el; }
  values() { return new Set((this.el.className || '').split(/\s+/).filter(Boolean)); }
  write(set) { this.el.className = [...set].join(' '); }
  add(...names) { const s=this.values(); names.forEach(n=>s.add(n)); this.write(s); }
  remove(...names) { const s=this.values(); names.forEach(n=>s.delete(n)); this.write(s); }
  contains(name) { return this.values().has(name); }
  toggle(name, force) { const s=this.values(); const next=force === undefined ? !s.has(name) : Boolean(force); next?s.add(name):s.delete(name); this.write(s); return next; }
}
class MiniNode {
  constructor(type) { this.nodeType=type; this.parentNode=null; this.childNodes=[]; }
  get parentElement() { return this.parentNode instanceof MiniElement ? this.parentNode : null; }
  get children() { return this.childNodes.filter((node) => node instanceof MiniElement); }
  append(...items) {
    for (let item of items) {
      if (typeof item === 'string') item = new MiniText(item);
      if (item instanceof MiniFragment) { for (const child of [...item.childNodes]) this.append(child); continue; }
      if (!item) continue;
      if (item.parentNode) item.remove();
      item.parentNode=this; this.childNodes.push(item);
    }
    notifyMutation(this);
  }
  replaceChildren(...items) { for (const c of this.childNodes) c.parentNode=null; this.childNodes=[]; this.append(...items); }
  remove() { if (!this.parentNode) return; const p=this.parentNode; p.childNodes=p.childNodes.filter(c=>c!==this); this.parentNode=null; notifyMutation(p); }
  replaceWith(...items) {
    if (!this.parentNode) return;
    const p=this.parentNode; const i=p.childNodes.indexOf(this); const normalized=[];
    for (let item of items) {
      if (typeof item === 'string') item=new MiniText(item);
      if (item instanceof MiniFragment) normalized.push(...item.childNodes); else normalized.push(item);
    }
    for (const n of normalized) n.parentNode=p;
    p.childNodes.splice(i,1,...normalized); this.parentNode=null; notifyMutation(p);
  }
  contains(node) { if (node===this) return true; return this.childNodes.some(c=>c.contains(node)); }
  get textContent() { return this.childNodes.map(c=>c.textContent).join(''); }
  set textContent(value) { this.replaceChildren(new MiniText(String(value ?? ''))); }
}
class MiniText extends MiniNode {
  constructor(value) { super(3); this.nodeValue=String(value); }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue=String(v); }
}
class MiniFragment extends MiniNode { constructor(){super(11);} }
function dataNameToAttr(name) { return 'data-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()); }
function parseAttrSelector(sel) {
  const m=sel.match(/^\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]$/); return m?{name:m[1],value:m[2]}:null;
}
function matchesSimple(el, selector) {
  const not=selector.match(/:not\((.+)\)$/); if(not){ selector=selector.slice(0,not.index); if(matchesSimple(el,not[1])) return false; }
  let tag=''; const tm=selector.match(/^[a-zA-Z][\w-]*/); if(tm){tag=tm[0].toLowerCase(); selector=selector.slice(tm[0].length); if(el.localName!==tag)return false;}
  for (const id of selector.matchAll(/#([\w-]+)/g)) if(el.id!==id[1]) return false;
  for (const cl of selector.matchAll(/\.([\w-]+)/g)) if(!el.classList.contains(cl[1])) return false;
  for (const at of selector.matchAll(/\[[^\]]+\]/g)) { const p=parseAttrSelector(at[0]); if(!p) return false; if(!el.hasAttribute(p.name))return false; if(p.value!==undefined && el.getAttribute(p.name)!==p.value)return false; }
  return true;
}
function descendants(node) { const out=[]; for(const c of node.childNodes){ if(c instanceof MiniElement){out.push(c); out.push(...descendants(c));}} return out; }
function queryAll(root, selector) {
  const parts=selector.trim().split(/\s+/); let current=[root];
  for(const part of parts){ const next=[]; for(const base of current){ for(const el of descendants(base)) if(matchesSimple(el,part)) next.push(el);} current=next; }
  return [...new Set(current)];
}
class MiniElement extends MiniNode {
  constructor(tag){ super(1); this.localName=tag.toLowerCase(); this.tagName=tag.toUpperCase(); this.attributes=new Map(); this.className=''; this.style=new Style(); this.listeners={}; this.classList=new ClassList(this); this._dataset={}; this.dataset=new Proxy(this._dataset, {set:(o,k,v)=>{o[k]=String(v); this.attributes.set(dataNameToAttr(k),String(v)); return true;},get:(o,k)=>o[k]}); }
  setAttribute(name,value){ this.attributes.set(name,String(value)); if(name==='id')this.id=String(value); if(name==='class')this.className=String(value); if(name.startsWith('data-')){ const key=name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); this._dataset[key]=String(value); } }
  getAttribute(name){ if(name==='id')return this.id??null; if(name==='class')return this.className; return this.attributes.has(name)?this.attributes.get(name):null; }
  hasAttribute(name){ return name==='id'?Boolean(this.id):name==='class'?Boolean(this.className):this.attributes.has(name); }
  removeAttribute(name){this.attributes.delete(name);}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  dispatchEvent(event){ event.target=this; for(const fn of this.listeners[event.type]||[]) fn(event); return true; }
  querySelectorAll(sel){return queryAll(this,sel);}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  closest(sel){let n=this; while(n instanceof MiniElement){if(matchesSimple(n,sel))return n;n=n.parentElement;}return null;}
}
class MiniDocument extends MiniNode {
  constructor(){ super(9); this.head=new MiniElement('head'); this.body=new MiniElement('body'); this.append(this.head,this.body); }
  createElement(t){return new MiniElement(t);}
  createTextNode(t){return new MiniText(t);}
  createDocumentFragment(){return new MiniFragment();}
  querySelectorAll(sel){return queryAll(this,sel);}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  createTreeWalker(root, what, filter){ const nodes=[]; const walk=n=>{for(const c of n.childNodes){if(c.nodeType===3 && (!filter||filter.acceptNode(c)===1))nodes.push(c);walk(c);}}; walk(root); let i=-1; return {currentNode:null,nextNode(){i++;this.currentNode=nodes[i]||null;return Boolean(this.currentNode);}}; }
}
class MutationObserver { constructor(callback){this.callback=callback;this.targets=[];} observe(target){(observers.get(target)??observers.set(target,[]).get(target)).push(this);this.targets.push(target);} disconnect(){for(const t of this.targets){observers.set(t,(observers.get(t)||[]).filter(o=>o!==this));}} }
class MiniEvent { constructor(type){this.type=type;} stopPropagation(){} preventDefault(){} }
globalThis.document=new MiniDocument();
globalThis.NodeFilter={SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2};
globalThis.MutationObserver=MutationObserver;
globalThis.getComputedStyle=(el)=>({display: el.classList.contains('margin-gutter') && el.closest('.agent-layer-off') ? 'none' : (el.style.display || 'block')});
globalThis.window={document,getSelection:()=>null,dispatchEvent(){},addEventListener(){}};
globalThis.CustomEvent=class extends MiniEvent{constructor(type,init={}){super(type);this.detail=init.detail;}};
globalThis.Event=MiniEvent;


export {};
