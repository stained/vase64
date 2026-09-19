/**
 * The single-file build has to work with no server, no imports and no DOM
 * beyond what a browser gives it. These tests execute the exact inline script
 * from index.html against a minimal fake DOM, so a broken bundle fails here
 * instead of in someone's browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeVase, encodeToVase, VESSELS } from '../src/vase64.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/* -------------------------------------------------------------------------- */
/* a DOM just big enough for app.js                                           */
/* -------------------------------------------------------------------------- */

class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.classes = new Set();
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.placeholder = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(child) {
    this.children.push(child);
  }

  querySelector(selector) {
    const match = (node) =>
      selector.startsWith('.')
        ? node.classes?.has(selector.slice(1))
        : node.id === selector.slice(1);
    return this.children.find(match) ?? null;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  /** Fire a listener the way the browser would. */
  fire(type, event = {}) {
    const handler = this.listeners.get(type);
    if (handler) handler({ preventDefault() {}, ...event });
  }

  focus() {}

  remove() {}

  /**
   * A 2D context whose `measureText` returns a width per character. Tests set
   * `document.metrics` to make the app believe it has a proportional font.
   */
  getContext(kind) {
    if (kind !== '2d') return null;
    const document = this.ownerDocument;
    return {
      font: '',
      measureText(character) {
        const widths = document?.metrics ?? {};
        return { width: widths[character] ?? 10 };
      },
    };
  }

  /**
   * The app sizes the vase against the stage, and measures a hidden probe to
   * learn the font metrics. Answer both: a <pre> is as wide as its text is
   * long, at roughly 0.6em per monospace column and its line-height per row.
   */
  getBoundingClientRect() {
    const fontSize = /font-size:\s*([\d.]+)px/.exec(this.style.cssText);
    if (fontSize && this.textContent) {
      const size = Number(fontSize[1]);
      const rows = this.textContent.split('\n');
      const columns = Math.max(...rows.map((row) => row.length));
      // 0.6em per monospace column, 1.18 lines tall: the same shape a browser
      // would report for the real element.
      return {
        width: columns * size * 0.6,
        height: rows.length * size * 1.18,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      };
    }
    return { width: this.#width, height: this.#height, top: 0, left: 0, bottom: 0, right: 0 };
  }

  get style() {
    if (!this.#style) this.#style = { cssText: '', setProperty: () => {} };
    return this.#style;
  }

  set style(value) {
    this.#style = value;
  }

  #style = null;
  #width = 900;
  #height = 600;

  /** Let a test shape the stage. */
  sizeTo(width, height) {
    this.#width = width;
    this.#height = height;
  }

  get ownerDocument() {
    return this.document ?? null;
  }

  get classList() {
    const owner = this;
    return {
      add: (name) => owner.classes.add(name),
      remove: (name) => owner.classes.delete(name),
      contains: (name) => owner.classes.has(name),
      toggle: (name, force) => {
        const on = force ?? !owner.classes.has(name);
        if (on) owner.classes.add(name);
        else owner.classes.delete(name);
        return on;
      },
    };
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return [...this.classes].join(' ');
  }
}

function makeDocument() {
  const ids = [
    'input-label', 'input-hint', 'input', 'vessel', 'breathing', 'stamp', 'run',
    'sample', 'clear', 'output-heading', 'artifact', 'magnifier', 'copy',
    'download', 'gutter', 'fit', 'zoom-in', 'zoom-out', 'zoom-readout',
    'toggle-panel', 'toggle-panel-label', 'panel', 'status', 'alphabet-table', 'protocol',
    'stat-chars', 'stat-bytes', 'stat-glyphs', 'stat-lines',
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
  // The real page starts with these checked; the shim must agree.
  // Mirror the `checked` attributes in the markup.
  elements.get('breathing').checked = true;
  elements.get('stamp').checked = true;
  elements.get('fit').checked = true;

  const tabs = ['encode', 'decode'].map((mode) => {
    const tab = new FakeElement('button');
    tab.dataset.mode = mode;
    tab.setAttribute('aria-selected', String(mode === 'encode'));
    return tab;
  });

  const shell = new FakeElement('main');
  shell.className = 'shell';
  const body = new FakeElement('body');
  const head = new FakeElement('head');
  // Wide enough to hold the vase, so the fit logic has something to work with.
  elements.get('artifact').sizeTo(900, 600);

  const documentElement = new FakeElement('html');
  const properties = new Map();
  documentElement.style = {
    setProperty: (name, value) => properties.set(name, value),
    getPropertyValue: (name) => properties.get(name) ?? '',
  };
  // A believable floating panel: 340px wide, well inside the stage height.
  elements.get('panel').sizeTo(340, 380);

  const doc = {
    body,
    head,
    shell,
    metrics: null,
    injectedStyles: [],
    documentElement,
    properties,
    elements,
    tabs,
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: (selector) => (selector === '.mode' ? tabs : []),
    querySelector: (selector) => {
      if (selector === '[data-mode="decode"]') return tabs[1];
      if (selector === '.shell') return shell;
      return null;
    },
    createElement: (tag) => {
      const element = new FakeElement(tag);
      element.document = doc;
      return element;
    },
  };
  // Styles appended to <head> are recorded so tests can see the fallback.
  head.append = (child) => {
    head.children.push(child);
    doc.injectedStyles.push(child.textContent ?? '');
  };
  return doc;
}

/** The contents of the <pre> the vase is drawn in. */
function preOf(innerHTML) {
  const match = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(innerHTML);
  return match ? match[1] : '';
}

/**
 * Strip the spans the highlighter adds, leaving the artefact itself. The empty
 * placeholder lives in the container too (hidden by CSS when there is output),
 * so it is removed as well.
 */
function plainOf(innerHTML) {
  return innerHTML
    .replace(/<p class="artifact__empty"[\s\S]*$/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Run the bundle the way a browser would: one classic script, no imports. */
function runBundle(setup) {
  const match = html.match(/<script>\n([\s\S]*?)\n\s*<\/script>/);
  assert.ok(match, 'index.html should contain one inline script');
  const script = match[1];
  assert.ok(!/^\s*(import|export)\b/m.test(script), 'script must be a classic script');

  const document = makeDocument();
  // Give a test a chance to shape the environment before the app runs.
  setup?.(document);
  const clipboard = { written: [] };
  const windowListeners = new Map();
  const computed = () => ({
    paddingLeft: '0',
    paddingRight: '0',
    paddingTop: '0',
    paddingBottom: '0',
    position: 'absolute',
  });
  const sandbox = {
    document,
    window: { location: { protocol: 'file:' }, getSelection: () => null },
    getComputedStyle: computed,
    requestAnimationFrame: (fn) => fn(),
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    navigator: { clipboard: { writeText: async (text) => clipboard.written.push(text) } },
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    Blob: class {},
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    console,
  };

  // The probe measures itself through getBoundingClientRect, which the fake
  // element answers with a fixed box. Give it a believable monospace metric by
  // overriding that one element after creation.
  const keys = Object.keys(sandbox);
  const run = new Function(...keys, script);
  run(...keys.map((key) => sandbox[key]));

  return {
    document,
    clipboard,
    tabs: document.tabs,
    el: (id) => document.elements.get(id),
    /** Resize the stage and let the app re-fit, as a real window would. */
    resizeStageTo: (width, height) => {
      document.elements.get('artifact').sizeTo(width, height);
      windowListeners.get('resize')?.();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* the bundle itself                                                          */
/* -------------------------------------------------------------------------- */

test('index.html is genuinely self-contained', () => {
  assert.ok(html.includes('<style>'), 'the stylesheet should be inlined');
  assert.ok(!/<script[^>]+src=/.test(html), 'no external script');
  assert.ok(!/<link[^>]+stylesheet/.test(html), 'no external stylesheet');
  assert.ok(!/<script type="module"/.test(html), 'modules are blocked on file://');
});

test('the bundle plants the sample and reports it', () => {
  const { el } = runBundle();
  const source = el('input').value;
  assert.ok(source.length > 0, 'the sample should be loaded');
  assert.ok(el('artifact').innerHTML.includes('bloom'), 'the vase should be highlighted');
  assert.ok(plainOf(el('artifact').innerHTML).includes('VASE64'));
  assert.equal(el('stat-glyphs').textContent, String(Buffer.from(source).toString('base64').length));
  assert.equal(el('status').dataset.tone, 'ok');
  assert.match(el('status').textContent, /base64 characters planted/);
});

test('encoding in the bundle round trips for every vessel', () => {
  for (const vessel of Object.keys(VESSELS)) {
    const { el } = runBundle();
    const message = `hello from the ${vessel}`;
    el('input').value = message;
    el('vessel').value = vessel;
    el('vessel').fire('change');
    assert.equal(decodeVase(plainOf(el('artifact').innerHTML)), message, vessel);
  }
});

test('switching to Decode reads a vase back to text', () => {
  const { el, tabs, clipboard } = runBundle();
  const message = 'the quick brown fox 🌷';
  const vase = encodeToVase(message, { vessel: 'bowl' });

  assert.equal(tabs[1].dataset.mode, 'decode');
  tabs[1].listeners.get('click')();
  el('input').value = vase;
  el('input').fire('input');

  assert.equal(el('input-label').textContent, 'Vase');
  assert.equal(el('run').textContent, 'Decode vase');
  assert.equal(plainOf(el('artifact').innerHTML), message);
  assert.equal(el('status').dataset.tone, 'ok');
  assert.match(el('status').textContent, /Decoded \d+ base64 characters/);

  // And the copy button hands over the decoded text, not the vase.
  el('copy').listeners.get('click')();
  assert.deepEqual(clipboard.written, [message]);
});

test('clearing resets the bench', () => {
  const { el } = runBundle();
  assert.ok(preOf(el('artifact').innerHTML).length > 0);
  el('clear').listeners.get('click')();
  assert.equal(el('input').value, '');
  assert.equal(preOf(el('artifact').innerHTML), '');
  assert.equal(el('stat-glyphs').textContent, '0');
  assert.equal(el('stat-lines').textContent, '0');
});

test('pasting plain base64 decodes without a vase around it', () => {
  const { el, tabs } = runBundle();
  const message = 'no vase required';
  tabs[1].listeners.get('click')();
  el('input').value = Buffer.from(message).toString('base64');
  el('input').fire('input');
  assert.equal(plainOf(el('artifact').innerHTML), message);
  // Padding is stripped before storing, so a padded input re-encodes with `=`
  // and the bench says so rather than claiming a clean round trip.
  assert.equal(el('status').dataset.tone, 'warn');
  assert.match(el('status').textContent, /^Decoded \d+ /);
});

test('the vase is sized to the stage, and can be zoomed by hand', () => {
  const run = runBundle();
  const { el, document } = run;
  const size = () => parseFloat(document.properties.get('--vase-size'));

  assert.ok(size() > 0, 'the vase should be sized on load');
  assert.equal(el('fit').checked, true);

  const { resizeStageTo } = run;
  // A short message, so the vase genuinely can fit a small stage.
  el('input').value = 'small';
  el('input').fire('input');
  const roomy = size();

  resizeStageTo(560, 420);
  const cramped = size();
  assert.ok(cramped < roomy, `a smaller stage should shrink the vase (${cramped} vs ${roomy})`);

  resizeStageTo(1900, 1200);
  assert.ok(size() > roomy, 'a big stage should grow the vase');

  // Hand-picked zoom turns fit off and steps the size up and back down. The
  // stage has to be modest, or the fit already sits at the maximum font size.
  resizeStageTo(620, 460);
  el('zoom-in').listeners.get('click')();
  assert.equal(el('fit').checked, false);
  assert.equal(el('zoom-readout').textContent, '125%');
  const zoomed = size();
  el('zoom-in').listeners.get('click')();
  assert.ok(size() > zoomed, `zoom in should grow the vase (${size()} vs ${zoomed})`);
  el('zoom-out').listeners.get('click')();
  assert.ok(Math.abs(size() - zoomed) < 0.05, 'zoom out should return to the same size');

  // Fit goes back to exactly filling the stage.
  el('fit').checked = true;
  el('fit').fire('change');
  assert.equal(el('zoom-readout').textContent, '100%');
  assert.ok(size() < zoomed, 'fit should undo the zoom');
});

test('line numbers do not change the width of the vase', () => {
  const { el } = runBundle();
  const withoutNumbers = preOf(el('artifact').innerHTML);
  el('gutter').checked = true;
  el('gutter').fire('change');
  const withNumbers = el('artifact').innerHTML;

  // The numbers live beside the <pre>, not inside it, so the drawing is
  // byte-for-byte identical whether they are on or off.
  assert.ok(withNumbers.includes('class="gutter"'));
  assert.equal(preOf(withNumbers), withoutNumbers);
  assert.ok(!preOf(withNumbers).includes('gutter'));
});

test('the controls can be hidden without hiding the vase', () => {
  const { el } = runBundle();
  assert.equal(el('toggle-panel').getAttribute('aria-expanded'), 'true');
  el('toggle-panel').listeners.get('click')();
  assert.equal(el('toggle-panel').getAttribute('aria-expanded'), 'false');
  assert.equal(el('toggle-panel-label').textContent, 'Show controls');
  el('toggle-panel').listeners.get('click')();
  assert.equal(el('toggle-panel').getAttribute('aria-expanded'), 'true');
});

test('the vase is drawn in a monospaced font, and that is verified', () => {
  // A real monospace font: every character the art uses is equally wide.
  const monospaced = runBundle();
  assert.deepEqual(monospaced.document.injectedStyles, []);
  assert.notEqual(monospaced.el('status').dataset.tone, 'warn');

  // A proportional font would let every column drift, so the app must notice
  // and fall back rather than quietly drawing a crooked vase.
  const probe = runBundle((document) => {
    document.metrics = { M: 30, i: 8, W: 34, '.': 9, ' ': 8, '|': 10, o: 18 };
  });
  assert.equal(probe.document.injectedStyles.length, 1);
  assert.match(probe.document.injectedStyles[0], /monospace/);
  assert.equal(probe.el('status').dataset.tone, 'warn');
  assert.match(probe.el('status').textContent, /monospaced/);
});

test('the inlined codec is the same codec the tests import', () => {
  const { el } = runBundle();
  el('input').value = 'VASE64';
  el('input').fire('input');
  const fromBundle = decodeVase(plainOf(el('artifact').innerHTML));
  assert.equal(fromBundle, 'VASE64');
  assert.equal(fromBundle, decodeVase(encodeToVase('VASE64')));
});
