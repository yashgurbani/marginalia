/* Marginalia site demo margin.
 *
 * Honesty rules this file implements:
 *  - The demo margin never calls a model and never pretends to. The demo line
 *    from the data file is always visible in the panel.
 *  - Every reply shown is a replay of a reply recorded live on 18 September
 *    2026. Reply text comes from window.MARGINALIA_DEMO and is never edited,
 *    extended or paraphrased here. Each reply carries the recorded replay line.
 *  - The reader's own actions are real: selection, marks drawn with the CSS
 *    Custom Highlight API, notes, saved and read-later pages, and the working
 *    RK4 simulation with the recorded slider ranges and the recorded rule.
 *  - Nothing is sent anywhere. Storage is localStorage, inside try/catch, and
 *    the page works with storage blocked.
 *  - The page DOM text is never rewritten.
 *
 * Public: window.MarginDemo = { mount, open, close, showReply, showInstant,
 *                               runWalkthrough, isMounted }
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var KEPT = 'marginalia-demo-kept';
  var MARKED = 'marginalia-demo-highlighted';
  var FOCUS = 'marginalia-demo-focus';

  var api = {};
  var app = null;

  /* ------------------------------------------------------------------ util */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function svg(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    for (var key in attrs) if (attrs[key] != null) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  function button(label, onClick, cls) {
    var node = el('button', cls, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }
  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function narrow() {
    try { return window.matchMedia('(max-width: 999px)').matches; } catch (e) { return false; }
  }
  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }
  function roundWait(seconds) {
    if (!(seconds > 0)) return '';
    if (seconds < 60) return '~' + Math.round(seconds) + ' s';
    return '~' + Math.round(seconds / 60) + ' min';
  }
  function exactWait(seconds) {
    if (!(seconds > 0)) return '';
    var whole = Math.round(seconds);
    var min = Math.floor(whole / 60);
    var sec = whole % 60;
    return min ? min + ' min ' + sec + ' s' : sec + ' s';
  }
  function fmt(value) {
    if (!isFinite(value)) return 'unbounded';
    var abs = Math.abs(value);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 1) return value.toFixed(2);
    return value.toFixed(3);
  }
  function niceStep(range) {
    if (!(range > 0)) return 0.01;
    var raw = range / 100;
    var step = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    return step > 0 ? step : 0.01;
  }
  function dayLabel(iso) {
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
  }

  /* ---------------------------------------------------------- tex to text */
  /* No maths typesetter is loaded. The two recorded tex strings are shown as
     readable plain maths; unknown commands are stripped rather than invented. */
  function texToText(tex) {
    return String(tex || '')
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\qquad|\\quad/g, '    ')
      .replace(/\\gamma/g, 'γ')
      .replace(/\\nu/g, 'ν')
      .replace(/\\cdot/g, '·')
      .replace(/\\,|\\;|\\!/g, ' ')
      .replace(/\\left|\\right/g, '')
      .replace(/([A-Za-z0-9)])\^2/g, '$1²')
      .replace(/([A-Za-z])_0/g, '$1₀')
      .replace(/\{|\}/g, '')
      .replace(/\s*=\s*/g, ' = ')
      .replace(/\s*-\s*/g, ' - ')
      .replace(/\s*\+\s*/g, ' + ')
      .replace(/ {2,}/g, '    ')
      .trim();
  }

  /* -------------------------------------------------- storage (may fail) */

  function makeStore(key) {
    var memory = null;
    var live = true;
    function read() {
      if (!live) return memory;
      try {
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        live = false;
        return memory;
      }
    }
    function write(value) {
      memory = value;
      if (!live) return false;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        live = false;
        return false;
      }
    }
    function clear() {
      memory = null;
      try { window.localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
    }
    return { read: read, write: write, clear: clear, works: function () { return live; } };
  }

  /* ------------------------------------------------ text ranges in a page */

  function indexText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.mgd, .mgd-card, script, style, [data-margin-skip]')) return NodeFilter.FILTER_REJECT;
        if (!node.data || !node.data.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var text = '';
    var map = [];
    var node;
    var lastWasSpace = true;
    while ((node = walker.nextNode())) {
      var data = node.data;
      for (var i = 0; i < data.length; i++) {
        var ch = data.charAt(i);
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue;
          text += ' ';
          map.push({ node: node, offset: i });
          lastWasSpace = true;
        } else {
          text += ch;
          map.push({ node: node, offset: i });
          lastWasSpace = false;
        }
      }
    }
    return { text: text, map: map };
  }

  function rangeForText(root, target) {
    var wanted = norm(target);
    if (!wanted) return null;
    var index = indexText(root);
    var at = index.text.indexOf(wanted);
    if (at < 0) {
      // Curly and straight quotes are interchangeable for locating a passage.
      var loose = wanted.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
      var flat = index.text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
      at = flat.indexOf(loose);
      if (at < 0) return null;
    }
    var start = index.map[at];
    var end = index.map[at + wanted.length - 1];
    if (!start || !end) return null;
    var range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
    } catch (e) {
      return null;
    }
    return range;
  }

  /* --------------------------------------------------- growth-v1 on values */

  function classify(gamma, f, y0) {
    var disc = gamma * gamma - 4 * f;
    if (disc < 0) {
      return {
        verdict: 'This scalar model diverges.',
        why: 'Gamma squared minus 4f is ' + fmt(disc) + ', which is negative, so the curve has no root to settle toward.'
      };
    }
    var root = Math.sqrt(disc);
    var lower = (gamma - root) / 2;
    var upper = (gamma + root) / 2;
    var eps = 1e-9;
    if (Math.abs(y0 - lower) < eps || Math.abs(y0 - upper) < eps) {
      return {
        verdict: 'This start is an equilibrium.',
        why: 'y0 sits on a root. The roots are ' + fmt(lower) + ' and ' + fmt(upper) + '.'
      };
    }
    if (y0 > upper) {
      return {
        verdict: 'This scalar model diverges.',
        why: 'y0 is above the larger root, ' + fmt(upper) + '.'
      };
    }
    return {
      verdict: 'This scalar model settles toward ' + fmt(lower) + '.',
      why: 'y0 is below the larger root, ' + fmt(upper) + ', so the curve moves to the smaller root.'
    };
  }

  function integrate(gamma, f, y0, seconds) {
    var steps = 800;
    var dt = seconds / steps;
    var slope = function (y) { return y * y - gamma * y + f; };
    var y = y0;
    var points = [{ t: 0, y: y }];
    var escaped = false;
    for (var i = 1; i <= steps; i++) {
      var k1 = slope(y);
      var k2 = slope(y + dt * k1 / 2);
      var k3 = slope(y + dt * k2 / 2);
      var k4 = slope(y + dt * k3);
      y = y + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      if (!isFinite(y) || Math.abs(y) > 1e6) { escaped = true; break; }
      if (i % 4 === 0) points.push({ t: i * dt, y: y });
    }
    return { points: points, escaped: escaped, seconds: seconds };
  }

  function plotSvg(result) {
    var W = 320, H = 168, L = 34, R = 10, T = 10, B = 24;
    var top = 0;
    for (var i = 0; i < result.points.length; i++) top = Math.max(top, result.points[i].y);
    var low = 0;
    for (var j = 0; j < result.points.length; j++) low = Math.min(low, result.points[j].y);
    var span = Math.max(top - low, 0.02);
    var pad = span * 0.12;
    var yMax = top + pad;
    var yMin = Math.min(low - pad, 0);
    var plotW = W - L - R, plotH = H - T - B;
    var sx = function (t) { return L + (t / result.seconds) * plotW; };
    var sy = function (y) { return T + plotH - ((y - yMin) / (yMax - yMin)) * plotH; };

    var root = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Curve of the disturbance proxy over ' + result.seconds + ' illustrative seconds.'
    });
    root.appendChild(svg('line', { x1: L, y1: T, x2: L, y2: T + plotH, class: 'mgd-axis' }));
    root.appendChild(svg('line', { x1: L, y1: sy(0), x2: W - R, y2: sy(0), class: 'mgd-axis' }));

    var d = '';
    for (var k = 0; k < result.points.length; k++) {
      d += (k ? ' L' : 'M') + sx(result.points[k].t).toFixed(2) + ' ' + sy(result.points[k].y).toFixed(2);
    }
    if (d) root.appendChild(svg('path', { d: d, class: 'mgd-curve' }));

    var labels = [
      { x: L, y: H - 8, anchor: 'start', text: '0 s' },
      { x: W - R, y: H - 8, anchor: 'end', text: result.seconds + ' s' },
      { x: L - 5, y: T + 8, anchor: 'end', text: fmt(yMax) },
      { x: L - 5, y: sy(0) + 3, anchor: 'end', text: '0' }
    ];
    labels.forEach(function (item) {
      var node = svg('text', { x: item.x, y: item.y, 'text-anchor': item.anchor, class: 'mgd-tick-text' });
      node.textContent = item.text;
      root.appendChild(node);
    });
    return root;
  }

  /* ------------------------------------------------------- small diagram */

  function wrap(text, perLine) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var next = line ? line + ' ' + word : word;
      if (next.length > perLine && line) { lines.push(line); line = word; }
      else line = next;
    });
    if (line) lines.push(line);
    return lines;
  }

  /* Returns the nodes in order when the edges form one simple chain, else null.
     A chain reads down the panel as a list, which is far clearer than elbows. */
  function chainOrder(nodes, edges) {
    if (!nodes.length || edges.length !== nodes.length - 1) return null;
    var out = {}, inn = {}, byId = {};
    nodes.forEach(function (node) { byId[node.id] = node; });
    for (var i = 0; i < edges.length; i++) {
      var edge = edges[i];
      if (!byId[edge.from] || !byId[edge.to]) return null;
      if (out[edge.from] || inn[edge.to]) return null;
      out[edge.from] = edge;
      inn[edge.to] = edge;
    }
    var start = null;
    nodes.forEach(function (node) { if (!inn[node.id]) start = start === null ? node.id : false; });
    if (!start) return null;
    var order = [byId[start]], links = [], at = start;
    while (out[at]) {
      links.push(out[at]);
      at = out[at].to;
      order.push(byId[at]);
      if (order.length > nodes.length) return null;
    }
    if (order.length !== nodes.length) return null;
    return { nodes: order, edges: links };
  }

  function chainSvg(block, chain) {
    var W = 344, PAD = 4, BOX_W = W - PAD * 2, GAP = 40, ARROW_X = 26;
    var y = 6, boxes = [];
    chain.nodes.forEach(function (node) {
      var lines = wrap(node.label, 38);
      var h = 12 + lines.length * 15;
      boxes.push({ y: y, h: h, lines: lines });
      y += h + GAP;
    });
    var H = y - GAP + 6;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': diagramAlt(block) });
    root.appendChild(arrowDefs());

    chain.edges.forEach(function (edge, index) {
      var top = boxes[index], next = boxes[index + 1];
      var group = svg('g', { class: 'edge' });
      group.setAttribute('color', 'var(--c-edge, #7a8090)');
      group.appendChild(svg('path', {
        d: 'M' + ARROW_X + ' ' + (top.y + top.h) + ' V' + (next.y - 3),
        class: 'edge-line', 'marker-end': 'url(#mgd-arrow)'
      }));
      var lines = wrap(edge.label || '', 34);
      var mid = (top.y + top.h + next.y) / 2;
      var startY = mid - ((lines.length - 1) * 11) / 2;
      lines.forEach(function (line, lineIndex) {
        var text = svg('text', { x: ARROW_X + 12, y: startY + lineIndex * 11 + 3, class: 'edge-text' });
        text.textContent = line;
        group.appendChild(text);
      });
      root.appendChild(group);
    });

    chain.nodes.forEach(function (node, index) {
      var box = boxes[index];
      root.appendChild(svg('rect', { x: PAD, y: box.y, width: BOX_W, height: box.h, rx: 5, class: 'node-box' }));
      box.lines.forEach(function (line, lineIndex) {
        var text = svg('text', { x: PAD + 10, y: box.y + 19 + lineIndex * 15, class: 'node-text' });
        text.textContent = line;
        root.appendChild(text);
      });
    });
    return root;
  }

  function arrowDefs() {
    var defs = svg('defs');
    var marker = svg('marker', {
      id: 'mgd-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
    });
    var head = svg('path', { d: 'M0 0 L8 4 L0 8 z' });
    head.setAttribute('fill', 'currentColor');
    marker.appendChild(head);
    defs.appendChild(marker);
    return defs;
  }

  function diagramSvg(block) {
    var W = 344, GX = 136, BOX_W = W - GX - 4;
    var nodes = block.nodes || [];
    var edges = block.edges || [];
    var chain = chainOrder(nodes, edges);
    if (chain) return chainSvg(block, chain);
    var layout = {};
    var y = 8;
    nodes.forEach(function (node) {
      var lines = wrap(node.label, 26);
      var h = 12 + lines.length * 15;
      layout[node.id] = { y: y, h: h, lines: lines, cy: y + h / 2 };
      y += h + 26;
    });
    var H = Math.max(y - 26 + 8, 60);

    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': diagramAlt(block) });
    root.appendChild(arrowDefs());

    edges.forEach(function (edge, index) {
      var from = layout[edge.from], to = layout[edge.to];
      if (!from || !to) return;
      var elbow = 128 - index * 6;
      var group = svg('g', { class: 'edge' });
      group.setAttribute('color', 'var(--c-edge, #7a8090)');
      var d = 'M' + GX + ' ' + from.cy + ' H' + elbow + ' V' + to.cy + ' H' + (GX - 3);
      group.appendChild(svg('path', { d: d, class: 'edge-line', 'marker-end': 'url(#mgd-arrow)' }));
      var lines = wrap(edge.label || '', 19);
      var mid = (from.cy + to.cy) / 2;
      var startY = mid - ((lines.length - 1) * 11) / 2;
      lines.forEach(function (line, lineIndex) {
        var text = svg('text', {
          x: elbow - 8, y: startY + lineIndex * 11 + 3,
          'text-anchor': 'end', class: 'edge-text'
        });
        text.textContent = line;
        group.appendChild(text);
      });
      root.appendChild(group);
    });

    nodes.forEach(function (node) {
      var box = layout[node.id];
      root.appendChild(svg('rect', { x: GX, y: box.y, width: BOX_W, height: box.h, rx: 5, class: 'node-box' }));
      box.lines.forEach(function (line, lineIndex) {
        var text = svg('text', { x: GX + 10, y: box.y + 19 + lineIndex * 15, class: 'node-text' });
        text.textContent = line;
        root.appendChild(text);
      });
    });
    return root;
  }

  function diagramAlt(block) {
    var parts = (block.edges || []).map(function (edge) {
      var from = (block.nodes || []).filter(function (n) { return n.id === edge.from; })[0];
      var to = (block.nodes || []).filter(function (n) { return n.id === edge.to; })[0];
      return (from ? from.label : edge.from) + ' ' + (edge.label || 'to') + ' ' + (to ? to.label : edge.to) + '.';
    });
    return 'Diagram. ' + parts.join(' ');
  }

  /* =================================================================== app */

  function Margin(options) {
    this.options = options || {};
    this.data = this.options.data || window.MARGINALIA_DEMO;
    if (!this.data) throw new Error('MarginDemo needs window.MARGINALIA_DEMO.');
    this.root = this.options.root || document.body;
    this.content = resolve(this.options.content) || document.body;
    this.quoteEl = resolve(this.options.quote) || document.querySelector('[data-margin-quote]');
    this.store = makeStore(this.options.storageKey || 'marginalia-demo-v1');
    this.timers = [];
    this.view = 'margin';
    this.isOpen = false;
    this.walkthroughRan = false;
    this.librarySearch = '';
    this.marks = supportsHighlights();
    this.state = this.load();
    this.build();
    this.bindPage();
    this.render();
    this.paint();
    if (!narrow()) this.setOpen(this.options.startOpen !== false);
    else this.setOpen(false);
    this.mounted = true;
  }

  function resolve(value) {
    if (!value) return null;
    if (typeof value === 'string') return document.querySelector(value);
    return value.nodeType === 1 ? value : null;
  }

  function supportsHighlights() {
    try {
      return typeof CSS !== 'undefined' && CSS.highlights && typeof window.Highlight === 'function';
    } catch (e) { return false; }
  }

  Margin.prototype.later = function (fn, delay) {
    var id = window.setTimeout(fn, delay);
    this.timers.push(id);
    return id;
  };
  Margin.prototype.clearTimers = function () {
    this.timers.forEach(function (id) { window.clearTimeout(id); });
    this.timers = [];
  };

  /* ------------------------------------------------------------- state */

  Margin.prototype.blank = function () {
    return { v: 1, threads: [], pages: [] };
  };
  Margin.prototype.load = function () {
    var saved = this.store.read();
    if (!saved || saved.v !== 1 || !Array.isArray(saved.threads)) return this.blank();
    saved.pages = Array.isArray(saved.pages) ? saved.pages : [];
    return saved;
  };
  Margin.prototype.save = function () {
    var keep = {
      v: 1,
      threads: this.state.threads.filter(function (t) { return !t.scripted; }),
      pages: this.state.pages
    };
    this.store.write(keep);
  };
  Margin.prototype.threadFor = function (quote, create) {
    var wanted = norm(quote);
    var found = null;
    this.state.threads.forEach(function (thread) {
      if (norm(thread.quote) === wanted) found = thread;
    });
    if (found || !create) return found;
    found = { id: uid('t'), quote: norm(quote), kept: false, parked: false, marked: false, notes: [], replies: [], at: new Date().toISOString() };
    this.state.threads.push(found);
    return found;
  };
  Margin.prototype.isExample = function (text) {
    var passage = norm(this.data.passage.text);
    var selection = norm(text);
    if (!selection) return false;
    if (selection === passage) return true;
    if (selection.length >= 24 && passage.indexOf(selection) >= 0) return true;
    return selection.indexOf(passage) >= 0;
  };

  /* -------------------------------------------------------------- shell */

  Margin.prototype.build = function () {
    var self = this;
    var shell = el('aside', 'mgd is-collapsed');
    shell.setAttribute('aria-label', 'Demo margin');
    shell.id = 'marginalia-demo';

    var rail = el('div', 'mgd-rail');
    var railOpen = button('', function () { self.setOpen(true); }, 'mgd-rail-open');
    railOpen.setAttribute('aria-label', 'Open the demo margin');
    railOpen.title = 'Open the demo margin';
    this.railTicks = el('div', 'mgd-rail-ticks');
    this.railCount = el('span', 'mgd-rail-count');
    rail.append(railOpen, this.railTicks, this.railCount);

    var panel = el('div', 'mgd-panel');
    this.handle = el('div', 'mgd-handle');

    var bar = el('div', 'mgd-bar');
    bar.append(el('span', 'mgd-wordmark', 'Marginalia'));
    var views = el('div', 'mgd-views');
    this.marginTab = button('Margin', function () { self.setView('margin'); });
    this.libraryTab = button('Library', function () { self.setView('library'); });
    views.append(this.marginTab, this.libraryTab);
    var collapse = button('›', function () { self.setOpen(false); }, 'mgd-icon');
    collapse.setAttribute('aria-label', 'Collapse the demo margin');
    collapse.title = 'Collapse';
    bar.append(views, collapse);

    var demoNote = el('p', 'mgd-demo-note', this.data.demoNote);

    var head = el('header', 'mgd-head');
    this.headTitle = el('h2', null, this.options.pageTitle || document.title || 'This page');
    this.headMeta = el('p', 'mgd-meta', this.options.pageLabel || 'Marginalia');
    head.append(this.headTitle, this.headMeta);

    this.scroll = el('div', 'mgd-scroll');
    this.scroll.tabIndex = -1;

    var footer = el('footer', 'mgd-footer');
    this.saveButton = button('Save page', function () { self.savePage(false); });
    this.parkButton = button('Read page later', function () { self.savePage(true); });
    this.forgetButton = button('Forget this page', function () { self.forget(); }, 'mgd-forget');
    footer.append(this.saveButton, this.parkButton, this.forgetButton);

    this.status = el('p', 'mgd-meta');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.style.position = 'absolute';
    this.status.style.width = '1px';
    this.status.style.height = '1px';
    this.status.style.overflow = 'hidden';
    this.status.style.clipPath = 'inset(50%)';

    panel.append(this.handle, bar, demoNote, head, this.scroll, footer, this.status);
    shell.append(rail, panel);

    this.scrim = button('', function () { self.setOpen(false); }, 'mgd-scrim');
    this.scrim.setAttribute('aria-label', 'Close the demo margin');
    this.scrim.hidden = true;

    this.fab = button('Open margin', function () { self.setOpen(true); }, 'mgd-open-fab');

    /* The card lives in the page only while it is shown. */
    this.card = this.makeCard();

    this.shell = shell;
    this.root.append(shell, this.scrim, this.fab);

    shell.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { self.setOpen(false); self.fab.focus(); }
    });
  };

  Margin.prototype.makeCard = function () {
    var self = this;
    var card = el('div', 'mgd-card');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Actions for the selected text');
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') self.hideCard();
    });
    /* Keep the selection alive while the reader presses a card button. */
    card.addEventListener('pointerdown', function (event) { event.preventDefault(); });
    return card;
  };

  Margin.prototype.announce = function (text) {
    this.status.textContent = text;
  };

  Margin.prototype.setOpen = function (open) {
    this.isOpen = !!open;
    this.shell.classList.toggle('is-collapsed', !this.isOpen);
    this.shell.classList.toggle('is-open', this.isOpen);
    /* A closed sheet stays rendered off screen on a narrow screen. inert takes
       it out of the tab order as well as the accessibility tree. */
    this.shell.inert = !this.isOpen && narrow();
    this.scrim.hidden = !(this.isOpen && narrow());
    this.fab.hidden = this.isOpen;
    document.documentElement.setAttribute('data-mgd-state', narrow() ? (this.isOpen ? 'sheet' : 'closed') : (this.isOpen ? 'open' : 'rail'));
    document.documentElement.style.setProperty('--mgd-gutter', narrow() ? '0px' : (this.isOpen ? '400px' : '44px'));
    if (this.isOpen && narrow() && this.mounted) this.scroll.focus({ preventScroll: true });
  };

  Margin.prototype.setView = function (view) {
    this.view = view;
    this.render();
  };

  /* -------------------------------------------------- page side bindings */

  Margin.prototype.bindPage = function () {
    var self = this;

    document.querySelectorAll('[data-margin-open]').forEach(function (node) {
      node.addEventListener('click', function () { self.setOpen(true); });
    });
    document.querySelectorAll('[data-margin-term]').forEach(function (node) {
      node.addEventListener('click', function (event) {
        event.preventDefault();
        self.showInstant(node.getAttribute('data-margin-term'));
      });
    });
    document.querySelectorAll('[data-margin-ask]').forEach(function (node) {
      node.addEventListener('click', function (event) {
        event.preventDefault();
        self.showReply(node.getAttribute('data-margin-ask'));
      });
    });
    document.querySelectorAll('[data-margin-action]').forEach(function (node) {
      node.addEventListener('click', function (event) {
        event.preventDefault();
        var action = node.getAttribute('data-margin-action');
        if (action === 'save') self.savePage(false);
        else if (action === 'park') self.savePage(true);
        else if (action === 'forget') self.forget();
        else if (action === 'library') { self.setOpen(true); self.setView('library'); }
        else if (action === 'walkthrough') self.runWalkthrough(true);
      });
    });

    document.addEventListener('mouseup', function (event) { self.maybeCard(event); });
    document.addEventListener('keyup', function (event) {
      if (event.key === 'Shift' || (event.key || '').indexOf('Arrow') === 0) self.maybeCard(event, true);
    });
    document.addEventListener('mousedown', function (event) {
      if (!self.card.contains(event.target)) self.hideCard();
    });
    window.addEventListener('resize', function () {
      self.hideCard();
      self.setOpen(self.isOpen);
    });
  };

  Margin.prototype.maybeCard = function (event, viaKeyboard) {
    if (this.card.contains(event.target) || this.shell.contains(event.target)) return;
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) { this.hideCard(); return; }
    var range = selection.getRangeAt(0);
    if (!this.content.contains(range.commonAncestorContainer)) { this.hideCard(); return; }
    if (this.shell.contains(range.commonAncestorContainer)) { this.hideCard(); return; }
    var text = norm(selection.toString());
    if (text.length < 3) { this.hideCard(); return; }
    this.showCard(text, range.getBoundingClientRect(), viaKeyboard);
  };

  Margin.prototype.showCard = function (text, rect, viaKeyboard) {
    var self = this;
    this.pending = text;
    this.hideCard();
    /* A fresh card each time it is shown; no stale node sits in the page. */
    this.card = this.makeCard();
    this.card.append(el('p', 'mgd-card-quote', '“' + text + '”'));
    var row = el('div', 'mgd-actions');
    row.append(
      button('Keep', function () { self.keep(text, false); }),
      button('Highlight', function () { self.mark(text); }),
      button('Ask', function () { self.ask(text); }),
      button('Note', function () { self.note(text); })
    );
    this.card.append(row);
    this.root.append(this.card);

    var width = this.card.offsetWidth || 268;
    var left = window.scrollX + rect.left + rect.width / 2 - width / 2;
    left = Math.max(window.scrollX + 12, Math.min(left, window.scrollX + document.documentElement.clientWidth - width - 12));
    var top = window.scrollY + rect.bottom + 8;
    if (rect.bottom + 8 + this.card.offsetHeight > window.innerHeight) {
      top = Math.max(window.scrollY + 8, window.scrollY + rect.top - this.card.offsetHeight - 8);
    }
    this.card.style.left = Math.round(left) + 'px';
    this.card.style.top = Math.round(top) + 'px';
    if (viaKeyboard) {
      var first = this.card.querySelector('button');
      if (first) first.focus();
    }
  };

  Margin.prototype.hideCard = function () {
    if (this.card && this.card.parentNode) this.card.remove();
    this.pending = null;
  };

  /* ------------------------------------------------------ reader actions */

  Margin.prototype.keep = function (text, parked) {
    var thread = this.threadFor(text, true);
    thread.kept = true;
    if (parked) thread.parked = true;
    this.after('Kept on this device. Nothing was sent.');
  };

  Margin.prototype.mark = function (text) {
    var thread = this.threadFor(text, true);
    thread.kept = true;
    thread.marked = !thread.marked;
    this.after(thread.marked ? 'Highlighted on this device.' : 'Highlight removed.');
  };

  Margin.prototype.note = function (text) {
    var thread = this.threadFor(text, true);
    thread.kept = true;
    this.editing = thread.id;
    this.after('Write your note in the margin.');
    var self = this;
    this.later(function () {
      var field = self.scroll.querySelector('textarea[data-editor="' + thread.id + '"]');
      if (field) field.focus();
    }, 20);
  };

  Margin.prototype.ask = function (text) {
    var thread = this.threadFor(text, true);
    thread.kept = true;
    if (this.isExample(text)) {
      this.menuFor = thread.id;
      this.askNotice = null;
    } else {
      this.menuFor = null;
      this.askNotice = thread.id;
    }
    this.after('');
  };

  Margin.prototype.after = function (message) {
    this.hideCard();
    this.save();
    this.setOpen(true);
    this.render();
    this.paint();
    if (message) this.announce(message);
  };

  Margin.prototype.savePage = function (parked) {
    var url = this.options.pageUrl || window.location.href;
    var existing = null;
    this.state.pages.forEach(function (page) { if (page.url === url) existing = page; });
    if (!existing) {
      existing = {
        id: uid('p'),
        title: this.options.pageTitle || document.title || 'This page',
        url: url,
        parked: !!parked,
        at: new Date().toISOString()
      };
      this.state.pages.push(existing);
    } else {
      existing.parked = !!parked;
    }
    this.save();
    this.setOpen(true);
    this.setView('library');
    this.announce(parked ? 'Kept to read later in the demo library.' : 'Saved to the demo library.');
  };

  Margin.prototype.forget = function () {
    this.state = this.blank();
    this.store.clear();
    this.editing = null;
    this.menuFor = null;
    this.askNotice = null;
    this.instant = null;
    this.setView('margin');
    this.paint();
    this.announce('This page is forgotten. Marks, notes and the demo library are cleared.');
  };

  /* ------------------------------------------------------- page marking */

  Margin.prototype.paint = function () {
    if (!this.marks) return;
    var keptRanges = [];
    var markedRanges = [];
    var self = this;
    this.state.threads.forEach(function (thread) {
      var range = rangeForText(self.content, thread.quote);
      if (!range) return;
      if (thread.marked) markedRanges.push(range);
      else if (thread.kept) keptRanges.push(range);
    });
    try {
      CSS.highlights.set(KEPT, construct(keptRanges));
      CSS.highlights.set(MARKED, construct(markedRanges));
    } catch (e) {
      this.marks = false;
    }
  };

  function construct(ranges) {
    return new (Function.prototype.bind.apply(window.Highlight, [null].concat(ranges)))();
  }

  Margin.prototype.focusRange = function (text) {
    if (!this.marks) return;
    var range = rangeForText(this.content, text);
    try {
      CSS.highlights.set(FOCUS, construct(range ? [range] : []));
    } catch (e) { /* nothing to focus */ }
    if (range) {
      var rect = range.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        var node = range.startContainer.parentElement;
        if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }
  };

  /* -------------------------------------------------------------- render */

  Margin.prototype.render = function () {
    this.marginTab.setAttribute('aria-pressed', this.view === 'margin' ? 'true' : 'false');
    this.libraryTab.setAttribute('aria-pressed', this.view === 'library' ? 'true' : 'false');
    this.scroll.replaceChildren();
    if (this.view === 'library') this.renderLibrary();
    else this.renderMargin();
    this.renderRail();
  };

  Margin.prototype.renderRail = function () {
    var self = this;
    this.railTicks.replaceChildren();
    this.state.threads.slice(0, 8).forEach(function (thread) {
      var tick = el('span', 'mgd-rail-tick');
      tick.setAttribute('data-parked', thread.parked ? 'true' : 'false');
      self.railTicks.append(tick);
    });
    var count = this.state.threads.length;
    this.railCount.textContent = count ? String(count) : '';
    this.fab.textContent = count ? 'Open margin (' + count + ')' : 'Open margin';
  };

  Margin.prototype.renderMargin = function () {
    var self = this;

    if (!this.marks) {
      this.scroll.append(el('p', 'mgd-notice',
        'This browser cannot draw marks on the page text. Kept passages are listed here instead.'));
    }

    if (this.instant) this.scroll.append(this.instantNode(this.instant));

    if (!this.state.threads.length) {
      this.scroll.append(el('p', 'mgd-empty',
        'Select any text on this page. A small card offers Keep, Highlight, Ask and Note. Your notes stay in this browser.'));
      return;
    }

    this.state.threads.forEach(function (thread) {
      self.scroll.append(self.threadNode(thread));
    });
  };

  Margin.prototype.threadNode = function (thread) {
    var self = this;
    var node = el('section', 'mgd-thread');
    node.setAttribute('data-parked', thread.parked ? 'true' : 'false');
    node.id = 'mgd-' + thread.id;

    var quote = button('“' + thread.quote + '”', function () { self.focusRange(thread.quote); }, 'mgd-quote');
    quote.setAttribute('aria-label', 'Show this passage on the page');
    node.append(quote);

    var state = [];
    if (thread.marked) state.push('Highlighted');
    else if (thread.kept) state.push('Kept');
    if (thread.parked) state.push('kept to read later');
    if (state.length) node.append(el('p', 'mgd-thread-state', state.join(', ') + ' on this device.'));

    var row = el('div', 'mgd-actions');
    row.append(
      button('Add note', function () { self.editing = thread.id; self.render(); self.later(function () {
        var field = self.scroll.querySelector('textarea[data-editor="' + thread.id + '"]');
        if (field) field.focus();
      }, 20); }),
      button(thread.marked ? 'Remove highlight' : 'Highlight', function () {
        thread.marked = !thread.marked; self.save(); self.render(); self.paint();
      }),
      button('Ask', function () { self.ask(thread.quote); }),
      button(thread.parked ? 'Read now' : 'Read later', function () {
        thread.parked = !thread.parked; self.save(); self.render();
      }),
      button('Remove', function () {
        self.state.threads = self.state.threads.filter(function (item) { return item !== thread; });
        self.save(); self.render(); self.paint();
        self.announce('Removed from the demo margin.');
      })
    );
    node.append(row);

    if (this.editing === thread.id) node.append(this.editorNode(thread));

    // Notes sit above replies.
    thread.notes.forEach(function (note) {
      var block = el('div');
      block.append(el('p', 'mgd-note', note.text));
      block.append(el('p', 'mgd-note-meta', thread.scripted
        ? 'Note from the walk-through. Saved in this browser.'
        : 'Your note. Saved in this browser.'));
      var noteRow = el('div', 'mgd-actions');
      noteRow.append(button('Remove note', function () {
        thread.notes = thread.notes.filter(function (item) { return item !== note; });
        self.save(); self.render();
      }));
      block.append(noteRow);
      node.append(block);
    });

    if (this.menuFor === thread.id) node.append(this.askMenuNode(thread));
    if (this.askNotice === thread.id) {
      node.append(el('p', 'mgd-notice',
        'The demo has replies for one passage only. The real margin asks your own Codex about any passage you select.'));
    }

    if (thread.replies.length) {
      var replies = el('div', 'mgd-replies');
      replies.setAttribute('aria-label', 'Replayed replies');
      thread.replies.forEach(function (kind) {
        var reply = self.data.replies[kind];
        if (reply) replies.append(self.replyNode(reply, thread));
      });
      node.append(replies);
    }
    return node;
  };

  Margin.prototype.editorNode = function (thread) {
    var self = this;
    var block = el('div', 'mgd-editor');
    block.append(el('p', 'mgd-meta', 'Note on this passage.'));
    var field = el('textarea');
    field.setAttribute('data-editor', thread.id);
    field.setAttribute('aria-label', 'Your note on the selected passage');
    field.placeholder = 'Write here.';
    block.append(field);
    var row = el('div', 'mgd-actions');
    row.append(
      button('Save note', function () {
        var text = field.value.trim();
        if (!text) { self.announce('Write something first.'); field.focus(); return; }
        thread.notes.push({ id: uid('n'), text: text, at: new Date().toISOString() });
        self.editing = null;
        self.save(); self.render();
        self.announce('Note saved in this browser.');
      }),
      button('Cancel', function () { self.editing = null; self.render(); })
    );
    block.append(row);
    field.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        row.querySelector('button').click();
      }
    });
    return block;
  };

  Margin.prototype.askMenuNode = function (thread) {
    var self = this;
    var block = el('section', 'mgd-ask-menu');
    block.append(el('h3', null, 'Ask this passage'));
    block.append(el('p', 'mgd-meta', 'Pick one of the six replies to replay it.'));
    var list = el('ul');
    this.data.askOrder.forEach(function (kind) {
      var reply = self.data.replies[kind];
      if (!reply) return;
      var item = el('li');
      var control = button('', function () {
        if (thread.replies.indexOf(kind) < 0) thread.replies.push(kind);
        self.menuFor = null;
        self.save();
        self.render();
        self.later(function () {
          var node = self.scroll.querySelector('[data-reply="' + thread.id + ':' + kind + '"]');
          if (node) node.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }, 20);
        self.announce(reply.label + ' replayed.');
      });
      control.append(el('span', null, reply.label), el('span', 'mgd-time', roundWait(reply.waitSeconds)));
      control.setAttribute('aria-label', reply.label + '. Recorded wait ' + exactWait(reply.waitSeconds) + '.');
      item.append(control);
      list.append(item);
    });
    block.append(list);
    var row = el('div', 'mgd-actions');
    row.append(button('Close', function () { self.menuFor = null; self.render(); }));
    block.append(row);
    return block;
  };

  /* --------------------------------------------------------- reply cards */

  Margin.prototype.replyNode = function (reply, thread) {
    var self = this;
    var node = el('article', 'mgd-reply');
    node.setAttribute('data-reply', thread.id + ':' + reply.kind);
    node.setAttribute('aria-label', reply.label + ' reply, replayed');
    this.shownTex = [];

    node.append(el('p', 'mgd-kind', reply.label));
    node.append(el('h3', null, reply.title));
    if (reply.illustrationNote) node.append(el('p', 'mgd-illustration', reply.illustrationNote));
    if (reply.question) node.append(el('p', 'mgd-meta', 'Asked: ' + reply.question));
    if (reply.summary) node.append(el('p', 'mgd-summary', reply.summary));

    (reply.blocks || []).forEach(function (block) {
      var rendered = self.blockNode(block, reply);
      if (rendered) node.append(rendered);
    });

    if (reply.assumptions && reply.assumptions.length) {
      node.append(this.details('What this example assumes (' + reply.assumptions.length + ')', reply.assumptions));
    }
    if (reply.limits && reply.limits.length) {
      node.append(this.details('What this reply leaves open (' + reply.limits.length + ')', reply.limits));
    }

    var replay = this.data.replayNote;
    var wait = exactWait(reply.waitSeconds);
    node.append(el('p', 'mgd-replay', wait ? replay + ' Recorded wait ' + wait + '.' : replay));

    var row = el('div', 'mgd-actions');
    row.append(
      button('Source passage', function () { self.focusRange(thread.quote); }),
      button('Remove', function () {
        thread.replies = thread.replies.filter(function (kind) { return kind !== reply.kind; });
        self.save(); self.render();
      })
    );
    node.append(row);
    return node;
  };

  Margin.prototype.details = function (label, items) {
    var box = el('details');
    box.append(el('summary', null, label));
    var list = el('ul');
    items.forEach(function (item) { list.append(el('li', null, item)); });
    box.append(list);
    return box;
  };

  Margin.prototype.blockNode = function (block, reply) {
    var wrapNode = el('div', 'mgd-block');
    if (block.label) wrapNode.append(el('p', 'mgd-block-label', block.label));

    if (block.type === 'text') {
      wrapNode.append(el('p', null, block.text));
      if (block.link && block.link.href) {
        var link = el('a', 'mgd-link', block.link.label || block.link.href);
        link.href = block.link.href;
        link.rel = 'noopener';
        link.target = '_blank';
        var row = el('div', 'mgd-actions');
        row.append(link);
        wrapNode.append(row);
      }
      return wrapNode;
    }

    if (block.type === 'note') {
      var noteBox = el('div', 'mgd-block-note');
      noteBox.append(el('p', null, block.text));
      wrapNode.append(noteBox);
      return wrapNode;
    }

    if (block.type === 'equation') {
      var shown = texToText(block.tex);
      // The Simulate it block already prints the same equation above its sliders.
      if (this.shownTex.indexOf(shown) >= 0) return null;
      this.shownTex.push(shown);
      wrapNode.append(el('p', 'mgd-equation', shown));
      return wrapNode;
    }

    if (block.type === 'model') {
      // Recorded with empty text. The equation is shown from the plot block.
      return null;
    }

    if (block.type === 'plot') {
      return this.tryItNode(block, reply);
    }

    if (block.type === 'classification') {
      // The live verdict is computed in the Simulate it block above. This is the
      // recorded rule sentence, shown as recorded.
      wrapNode.append(el('p', 'mgd-rule-text', block.text));
      return wrapNode;
    }

    if (block.type === 'diagram') {
      var figure = el('figure', 'mgd-diagram');
      figure.append(diagramSvg(block));
      wrapNode.append(figure);
      return wrapNode;
    }

    if (block.type === 'shelf') {
      var list = el('ul', 'mgd-shelf');
      (block.items || []).forEach(function (item) { list.append(el('li', null, item.label)); });
      wrapNode.append(list);
      return wrapNode;
    }

    return null;
  };

  /* ------------------------------------------------ Simulate it, for real */

  Margin.prototype.tryItNode = function (block, reply) {
    var wrapNode = el('div', 'mgd-block');
    var sliders = (reply.sliders || []).slice();
    var values = {};
    sliders.forEach(function (slider) { values[slider.key] = slider.value; });

    var equation = texToText(block.equationTex);
    this.shownTex.push(equation);
    wrapNode.append(el('p', 'mgd-equation', equation));

    var plotBox = el('figure', 'mgd-plot');
    var classLine = el('p', 'mgd-classification');
    var whyLine = el('p', 'mgd-meta');

    var controls = el('div', 'mgd-sliders');
    sliders.forEach(function (slider) {
      var row = el('div', 'mgd-slider');
      var label = el('label');
      var id = uid('s');
      label.setAttribute('for', id);
      var name = el('span', null, slider.label + (slider.unit ? ' (' + slider.unit + ')' : ''));
      var value = el('span', 'mgd-value', fmt(slider.value));
      label.append(name, value);
      var input = el('input');
      input.type = 'range';
      input.id = id;
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.step = String(niceStep(slider.max - slider.min));
      input.value = String(slider.value);
      input.setAttribute('aria-label', slider.label);
      input.addEventListener('input', function () {
        values[slider.key] = parseFloat(input.value);
        value.textContent = fmt(values[slider.key]);
        draw();
      });
      row.append(label, input);
      controls.append(row);
    });

    var frame = null;
    function draw() {
      if (frame) return;
      frame = window.requestAnimationFrame(function () {
        frame = null;
        var result = integrate(values.gamma, values.f, values.y0, block.seconds || 8);
        plotBox.replaceChildren(plotSvg(result));
        var verdict = classify(values.gamma, values.f, values.y0);
        classLine.replaceChildren(el('b', null, verdict.verdict));
        whyLine.textContent = verdict.why + (result.escaped ? ' The curve leaves the shown range inside the window.' : '');
      });
    }

    wrapNode.append(controls, plotBox, classLine, whyLine);
    wrapNode.append(el('p', 'mgd-meta',
      'The curve and the line above are worked out in your browser from these values, using the recorded rule and a Runge-Kutta step.'));
    draw();
    return wrapNode;
  };

  /* ------------------------------------------------- instant definitions */

  Margin.prototype.instantNode = function (entry) {
    var node = el('section', 'mgd-instant');
    node.setAttribute('aria-live', 'polite');
    node.append(el('h3', null, entry.term));
    if (entry.pending) {
      var skeleton = el('div', 'mgd-skeleton');
      skeleton.append(el('i'), el('i'), el('i'));
      node.append(skeleton);
      node.append(el('p', 'mgd-meta', 'Replaying the recorded definition.'));
      return node;
    }
    if (!reducedMotion()) node.classList.add('is-arriving');
    var body = el('p');
    body.append(el('b', 'mgd-lead', entry.lead + ' '), document.createTextNode(entry.text));
    node.append(body);
    node.append(el('p', 'mgd-meta',
      this.data.replayNote + ' The first text arrived ' + String(entry.waitNote).replace(/^first text /, '') + '.'));
    return node;
  };

  Margin.prototype.showInstant = function (term) {
    var entry = this.data.instant[term];
    if (!entry) return;
    this.setOpen(true);
    this.setView('margin');
    this.focusRange(term);
    if (reducedMotion()) {
      this.instant = { term: entry.term, lead: entry.lead, text: entry.text, waitNote: entry.waitNote };
      this.render();
      this.announce(entry.term + ' definition replayed.');
      return;
    }
    this.instant = { term: entry.term, pending: true };
    this.render();
    var self = this;
    this.later(function () {
      self.instant = { term: entry.term, lead: entry.lead, text: entry.text, waitNote: entry.waitNote };
      self.render();
      self.announce(entry.term + ' definition replayed.');
    }, 650);
  };

  /* ------------------------------------------------------------- library */

  Margin.prototype.renderLibrary = function () {
    var self = this;
    var box = el('div', 'mgd-library');

    var search = el('input', 'mgd-search');
    search.type = 'search';
    search.placeholder = 'Search this demo library';
    search.setAttribute('aria-label', 'Search this demo library');
    search.value = this.librarySearch;
    search.addEventListener('input', function () {
      self.librarySearch = search.value;
      self.render();
      var again = self.scroll.querySelector('.mgd-search');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
    box.append(search);

    var query = norm(this.librarySearch).toLowerCase();
    function matches(text) {
      return !query || String(text).toLowerCase().indexOf(query) >= 0;
    }

    var pages = this.state.pages.filter(function (page) { return matches(page.title + ' ' + page.url); });
    var saved = pages.filter(function (page) { return !page.parked; });
    var parked = pages.filter(function (page) { return page.parked; });

    box.append(el('h3', null, 'Saved'));
    box.append(this.pageList(saved, 'Nothing saved yet. Use Save page below.'));
    box.append(el('h3', null, 'Read later'));
    box.append(this.pageList(parked, 'Nothing here yet. Use Read page later below.'));

    box.append(el('h3', null, 'Activity'));
    if (!pages.length) {
      box.append(el('p', 'mgd-meta', 'A day appears here once you save a page or keep it to read later.'));
    } else {
      var days = {};
      pages.forEach(function (page) {
        var day = dayLabel(page.at);
        days[day] = days[day] || [];
        days[day].push(page);
      });
      Object.keys(days).forEach(function (day) {
        var group = el('div', 'mgd-journey');
        group.append(el('h4', null, day));
        group.append(el('p', 'mgd-meta', 'Daily recap: ' + days[day].length + (days[day].length === 1 ? ' page' : ' pages') + ' kept.'));
        group.append(self.pageList(days[day], ''));
        box.append(group);
      });
    }

    var threads = this.state.threads.filter(function (thread) { return matches(thread.quote); });
    box.append(el('h3', null, 'Passages on this page'));
    if (!threads.length) {
      box.append(el('p', 'mgd-meta', 'Keep or highlight a passage and it appears here.'));
    } else {
      var list = el('ul');
      threads.forEach(function (thread) {
        var item = el('li');
        var open = button('“' + thread.quote.slice(0, 90) + (thread.quote.length > 90 ? '…' : '') + '”', function () {
          self.setView('margin');
          self.later(function () {
            var node = document.getElementById('mgd-' + thread.id);
            if (node) node.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
          }, 20);
        });
        item.append(open);
        item.append(el('span', 'mgd-meta',
          (thread.notes.length ? thread.notes.length + ' note' + (thread.notes.length === 1 ? '' : 's') : 'No notes') +
          (thread.replies.length ? ', ' + thread.replies.length + ' replayed' : '')));
        list.append(item);
      });
      box.append(list);
    }

    this.scroll.append(box);
  };

  Margin.prototype.pageList = function (pages, empty) {
    var self = this;
    if (!pages.length) return el('p', 'mgd-meta', empty || 'Nothing here yet.');
    var list = el('ul');
    pages.forEach(function (page) {
      var item = el('li');
      item.append(el('span', null, page.title));
      item.append(el('span', 'mgd-meta', page.url));
      var row = el('div', 'mgd-actions');
      row.append(button('Remove', function () {
        self.state.pages = self.state.pages.filter(function (other) { return other !== page; });
        self.save();
        self.render();
      }));
      item.append(row);
      list.append(item);
    });
    return list;
  };

  /* --------------------------------------------------------- walkthrough */

  Margin.prototype.showReply = function (kind) {
    var reply = this.data.replies[kind];
    if (!reply) return;
    var thread = this.threadFor(this.data.passage.text, true);
    thread.kept = true;
    if (thread.replies.indexOf(kind) < 0) thread.replies.push(kind);
    this.menuFor = null;
    this.save();
    this.setOpen(true);
    this.setView('margin');
    this.paint();
    var self = this;
    this.later(function () {
      var node = self.scroll.querySelector('[data-reply="' + thread.id + ':' + kind + '"]');
      if (node) node.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }, 30);
    this.announce(reply.label + ' replayed.');
  };

  Margin.prototype.runWalkthrough = function (force) {
    if (this.walkthroughRan && !force) return;
    if (!force && (this.state.threads.length || this.state.pages.length)) return;
    this.walkthroughRan = true;
    /* Quote the recorded passage itself when the page carries it, so the
       walk-through never picks up a caption or a source line beside it. */
    var quote = norm(this.data.passage.text);
    if (!this.content || !rangeForText(this.content, quote)) {
      quote = this.quoteEl ? norm(this.quoteEl.textContent) : quote;
    }
    var self = this;
    var thread = this.threadFor(quote, true);
    thread.scripted = true;

    if (reducedMotion()) {
      thread.kept = true;
      thread.marked = true;
      thread.notes = [{ id: uid('n'), text: 'Check what smoothing means here.', at: new Date().toISOString() }];
      this.setOpen(true);
      this.render();
      this.paint();
      this.instant = this.data.instant.viscosity;
      this.render();
      return;
    }

    this.setOpen(true);
    this.focusRange(quote);
    this.later(function () {
      var range = rangeForText(self.content, quote);
      if (range) self.showCard(quote, range.getBoundingClientRect());
    }, 500);
    this.later(function () {
      self.hideCard();
      thread.kept = true;
      thread.marked = true;
      self.render();
      self.paint();
    }, 1700);
    this.later(function () {
      thread.notes = [{ id: uid('n'), text: 'Check what smoothing means here.', at: new Date().toISOString() }];
      self.render();
    }, 2600);
    this.later(function () {
      self.showInstant('viscosity');
    }, 3600);
  };

  Margin.prototype.destroy = function () {
    this.clearTimers();
    [this.shell, this.scrim, this.fab, this.card].forEach(function (node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    try {
      CSS.highlights.delete(KEPT);
      CSS.highlights.delete(MARKED);
      CSS.highlights.delete(FOCUS);
    } catch (e) { /* nothing painted */ }
  };

  /* ----------------------------------------------------------- public API */

  api.mount = function (options) {
    if (app) app.destroy();
    app = new Margin(options);
    if (options && options.walkthrough) app.runWalkthrough();
    return api;
  };
  api.open = function () { if (app) app.setOpen(true); return api; };
  api.close = function () { if (app) app.setOpen(false); return api; };
  api.showReply = function (kind) { if (app) app.showReply(kind); return api; };
  api.showInstant = function (term) { if (app) app.showInstant(term); return api; };
  api.runWalkthrough = function (force) { if (app) app.runWalkthrough(force); return api; };
  api.isMounted = function () { return !!app; };
  api.instance = function () { return app; };

  window.MarginDemo = api;
})();
