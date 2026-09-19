/**
 * VASE64 web bench.
 *
 * The page is a thin skin over src/vase64.js: it decides which way the data is
 * flowing, keeps the two text areas in step, and paints the result. The codec
 * itself knows nothing about the DOM, which is why the same module backs the
 * CLI and the tests.
 */
import {
  BLOOM_CHARACTERS,
  LEAVES,
  STEM_CHARACTERS,
  VESSELS,
  base64ToVase,
  decodeBase64,
  glyphTable,
  glyphToValueLenient,
  hasFlowers,
  splitGlyphs,
  vaseToBase64,
} from './src/vase64.js';

/** Character classes for the highlighter, longest match first. */
const CLASSES = [
  { name: 'bloom', characters: BLOOM_CHARACTERS },
  { name: 'stem', characters: STEM_CHARACTERS },
  { name: 'leaf', characters: LEAVES },
  { name: 'wall', characters: '|\\/_' },
];

/** Every column of every plant is exactly this wide; the art depends on it. */
const MONOSPACE_STACK = [
  'ui-monospace',
  'SFMono-Regular',
  'SF Mono',
  'Menlo',
  'Monaco',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Courier New',
  'monospace',
];

const SAMPLE = `VASE64: base64, but it blooms.

Type anything you like in here and press "Encode to vase". Every base64
character becomes one plant, so the same text always grows the same bouquet.`;

const $ = (id) => document.getElementById(id);

const dom = {
  tabs: [...document.querySelectorAll('.mode')],
  inputLabel: $('input-label'),
  inputHint: $('input-hint'),
  input: $('input'),
  vessel: $('vessel'),
  breathing: $('breathing'),
  stamp: $('stamp'),
  run: $('run'),
  sample: $('sample'),
  clear: $('clear'),
  artifact: $('artifact'),
  artText: document.querySelector('.artifact__text'),
  shell: document.querySelector('.shell'),
  panel: $('panel'),
  magnifier: $('magnifier'),
  copy: $('copy'),
  download: $('download'),
  gutter: $('gutter'),
  fit: $('fit'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  zoomReadout: $('zoom-readout'),
  togglePanel: $('toggle-panel'),
  togglePanelLabel: $('toggle-panel-label'),
  status: $('status'),
  alphabet: $('alphabet-table'),
  stats: {
    chars: $('stat-chars'),
    bytes: $('stat-bytes'),
    glyphs: $('stat-glyphs'),
    lines: $('stat-lines'),
  },
};

const state = {
  mode: 'encode',
  vase: '',
  base64: '',
  message: '',
  /** Multiplier on the fitted size: 1 = exactly fit, 1.5 = half again. */
  zoom: 1,
  /** Set during setup: whether the rendering font really is monospaced. */
  monospaced: true,
  fit: true,
  panelOpen: true,
};

/** Font sizes the +/- control steps through. */
const ZOOM_DEFAULT = 12;
/** Hard limits on the rendered font size, whatever the stage says. */
const ZOOM_MIN = 5;
const ZOOM_MAX = 48;
/** How far the hand-picked zoom may travel from an exact fit. */
const ZOOM_MIN_RATIO = 0.5;
const ZOOM_MAX_RATIO = 3;
/** Room left around the vase, in px, so it never touches the furniture. */
const STAGE_BREATHING = 28;
/** The bars that sit under the vase, so the bouquet does not hide behind them. */
const FURNITURE_HEIGHT = 104;

/* -------------------------------------------------------------------------- */
/* setup                                                                      */
/* -------------------------------------------------------------------------- */

function fillVessels() {
  // The dev page loads this file as a module, so reaching this function means
  // the module loaded and the page works, whatever the protocol. Clear the
  // fallback warning dev.html raised in case it did not.
  const protocolWarning = $('protocol');
  if (protocolWarning) protocolWarning.hidden = true;

  for (const [key, vessel] of Object.entries(VESSELS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${vessel.name} — ${vessel.blurb}`;
    dom.vessel.append(option);
  }
  dom.vessel.value = 'bud';
}

function fillAlphabet() {
  const table = glyphTable();
  dom.alphabet.textContent = `${table}

Legend
  bloom  ${[...BLOOM_CHARACTERS].join('  ')}   the top two bits
  stem   ${[...STEM_CHARACTERS].join('  ')}   the middle two bits, two per plant
  leaf   ${[...LEAVES].join('  ')}   the bottom two bits
  Each plant is two rows deep. Only the bloom row carries data; the vine
  underneath it is decoration, which is why the vase can be redrawn freely.`;
}

/* -------------------------------------------------------------------------- */
/* rendering                                                                  */
/* -------------------------------------------------------------------------- */

function classOf(character) {
  for (const entry of CLASSES) {
    if (entry.characters.includes(character)) return entry.name;
  }
  return '';
}

/**
 * Colour a vase without letting HTML escape the art. Characters are matched
 * char-by-char, and runs are wrapped in spans so the flower reads at a glance.
 *
 * The gutter is emitted as its own block element at the start of each line: as
 * a block it takes no width in the <pre>, so switching line numbers on cannot
 * nudge the vase sideways.
 */
function highlight(text) {
  const lines = text.split('\n');
  const parts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let run = '';
    let runClass = null;
    for (const character of line) {
      const name = classOf(character);
      if (name !== runClass) {
        if (run) parts.push(wrap(run, runClass));
        run = character;
        runClass = name;
      } else {
        run += character;
      }
    }
    if (run) parts.push(wrap(run, runClass));
    if (index < lines.length - 1) parts.push('\n');
  }
  return parts.join('');
}

/** The signature is a marker, not a plant, so it gets one clean span. */
function markSignature(html) {
  return html.replace(/>VASE64</g, '><span class="stamp">VASE64</span><');
}

function wrap(text, className) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return className ? `<span class="${className}">${escaped}</span>` : escaped;
}

function render() {
  // Decoding paints the recovered text; encoding paints the vase. Either way
  // the panel shows the thing you asked for, not an intermediate.
  const text = state.mode === 'encode' ? state.vase : state.message;
  // `VASE64` never contains a bloom, so its O would otherwise be tinted.
  const lines = text ? text.split('\n') : [];
  const gutters = dom.gutter.checked
    ? lines.map((_, index) => `<i class="gutter">${String(index + 1).padStart(3, ' ')}</i>`).join('')
    : '';
  dom.artifact.innerHTML =
    `<pre class="artifact__text" tabindex="0" aria-live="polite">${markSignature(highlight(text, false))}</pre>` +
    gutters +
    '<p class="artifact__empty" id="artifact-empty">Your vase will appear here.</p>';
  // The panel may have been swapped out from under the older references.
  dom.artText = dom.artifact.querySelector('.artifact__text');
  dom.artifactEmpty = $('artifact-empty');
  fitToStage();
}

/* -------------------------------------------------------------------------- */
/* fitting the vase to the stage                                              */
/* -------------------------------------------------------------------------- */

/**
 * How wide one monospace column is, and how tall one line is, per pixel of
 * font size.
 *
 * The probe is deliberately many lines tall - a one-line element measures a
 * single line, which says nothing about the line height - and it is fixed
 * positioned with `width: max-content`, so its size is its text's size and not
 * a function of the page layout it happens to be measured in. Reaching into a
 * collapsing flex layout for metrics is how the vase ends up sized wrong.
 */
const PROBE_SIZE = 100;
const PROBE_LINES = 40;
const PROBE_TEXT = new Array(PROBE_LINES).fill('0'.repeat(40)).join('\n');

function measure() {
  const probe = document.createElement('pre');
  probe.className = 'artifact__text';
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:-9999px',
    'width:max-content',
    'height:auto',
    'visibility:hidden',
    'pointer-events:none',
    `font-size:${PROBE_SIZE}px`,
    'margin:0',
    'padding:0',
    'border:0',
  ].join(';');
  probe.textContent = PROBE_TEXT;
  document.body.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  // Divide by the probe's own font size, so this holds whatever size it is
  // measured at.
  return {
    column: rect.width / 40 / PROBE_SIZE,
    line: rect.height / PROBE_LINES / PROBE_SIZE,
  };
}

/**
 * The box the vase may actually occupy. The controls float *over* the stage, so
 * on a wide screen their strip is subtracted off the left; below the stacking
 * breakpoint they sit underneath instead and the width is the whole stage.
 */
function stageBox() {
  const rect = dom.artifact.getBoundingClientRect();
  const style = getComputedStyle(dom.artifact);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  let width = rect.width - padding;
  let height = rect.height;

  const panelRect = dom.panel.getBoundingClientRect();
  // On a narrow screen the stylesheet stacks the panel across the bottom, in
  // which case it costs height rather than width. Beside the vase it costs
  // width, but never more than two thirds of the stage: past that the panel
  // would leave the bouquet nothing, so the vase keeps its room and slides
  // under the controls instead.
  const panelAtBottom = rect.bottom - panelRect.bottom < 24 && panelRect.width > rect.width * 0.8;
  if (state.panelOpen && panelRect.width > 0) {
    if (panelAtBottom) {
      height -= panelRect.height;
    } else {
      width -= Math.min(panelRect.width + STAGE_BREATHING, rect.width * (2 / 3));
    }
  }

  return {
    width: Math.max(0, width - STAGE_BREATHING),
    height: Math.max(0, height - FURNITURE_HEIGHT - STAGE_BREATHING),
  };
}

/** The largest font size at which the whole vase fits, within the zoom range. */
function fitSize() {
  const text = state.mode === 'encode' ? state.vase : state.message;
  if (!text) return ZOOM_DEFAULT;
  const { width, height } = stageBox();
  if (width <= 0 || height <= 0) return ZOOM_DEFAULT;
  const { column, line } = measure();
  const columns = Math.max(...text.split('\n').map((row) => row.length));
  const rows = text.split('\n').length;
  const byWidth = width / (columns * column);
  const byHeight = height / (rows * line);
  return clamp(Math.min(byWidth, byHeight), ZOOM_MIN, ZOOM_MAX);
}

/**
 * Push the current size into CSS and report it. `fit` is what the stage can
 * hold; the hand-picked zoom is a multiplier on top of that, so a resize keeps
 * a zoomed-in vase zoomed in rather than snapping it back to a fixed pixel size.
 */
function applySize(fit) {
  const size = Math.round(clamp(fit * state.zoom, ZOOM_MIN, ZOOM_MAX) * 10) / 10;
  document.documentElement.style.setProperty('--vase-size', `${size}px`);
  dom.zoomReadout.textContent = `${Math.round(state.zoom * 100)}%`;
  dom.zoomIn.disabled = state.zoom >= ZOOM_MAX_RATIO;
  dom.zoomOut.disabled = state.zoom <= ZOOM_MIN_RATIO;
}

function fitToStage() {
  const fit = fitSize();
  lastFit = state.fit ? Math.round(fit * 10) / 10 : null;
  applySize(fit);
}

/** Step the zoom by hand, which also switches fit off. */
function zoomStep(direction) {
  // One step is a fixed fraction, so the control feels the same at any size.
  const next = state.zoom * (direction > 0 ? 1.25 : 1 / 1.25);
  state.zoom = clamp(next, ZOOM_MIN_RATIO, ZOOM_MAX_RATIO);
  state.fit = false;
  dom.fit.checked = false;
  fitToStage();
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function setPanel(open) {
  state.panelOpen = open;
  dom.shell.classList.toggle('panel-hidden', !open);
  dom.togglePanel.setAttribute('aria-expanded', String(open));
  dom.togglePanelLabel.textContent = open ? 'Hide controls' : 'Show controls';
  if (state.fit) fitToStage();
}

/* -------------------------------------------------------------------------- */
/* the font has to be monospaced for any of this to line up                   */
/* -------------------------------------------------------------------------- */

/** The characters the art is built from, plus a reference letter and a gap. */
const FONT_PROBE = ['M', 'i', 'W', '.', ' ', '|', 'o'];

/**
 * Is the font actually monospaced? A proportional fallback would let every
 * column drift, so this is checked rather than assumed.
 *
 * Widths come from a 2D canvas, because it reports a character's advance
 * width directly instead of the ink extents a <pre> would give.
 */
function fontIsMonospaced() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d');
  if (!context) return true; // no canvas: assume the stylesheet is right
  const family = MONOSPACE_STACK.map((name) => (name.includes(' ') ? `"${name}"` : name)).join(', ');
  context.font = `50px ${family}`;
  const widths = FONT_PROBE.map((character) => context.measureText(character).width);
  return widths.every((width) => Math.abs(width - widths[0]) < 0.5);
}

/**
 * Make sure the vase is drawn in a monospaced font. The stylesheet already asks
 * for one; this checks, and if the answer is no it forces a fallback and checks
 * again, so the app never quietly draws a crooked vase.
 *
 * @returns {boolean} whether the vase is being drawn monospaced.
 */
function ensureMonospaced() {
  if (fontIsMonospaced()) return true;

  const forced = document.createElement('style');
  forced.textContent =
    '.artifact__text { font-family: "Courier New", Courier, ui-monospace, monospace !important; }';
  document.head.append(forced);
  return fontIsMonospaced();
}

function setStatus(message, tone = '') {
  dom.status.textContent = message;
  if (tone) dom.status.dataset.tone = tone;
  else delete dom.status.dataset.tone;
}

function updateStats() {
  const source = dom.input.value;
  const showing = state.mode === 'encode' ? state.vase : state.message;
  const encoding = state.mode === 'encode';
  dom.stats.chars.textContent = String(source.length);
  dom.stats.bytes.textContent = String(new TextEncoder().encode(encoding ? source : showing).length);
  dom.stats.glyphs.textContent = String(
    encoding ? state.base64.length : splitGlyphs(state.vase).length,
  );
  dom.stats.lines.textContent = String(showing ? showing.split('\n').length : 0);
}

/* -------------------------------------------------------------------------- */
/* the two directions                                                         */
/* -------------------------------------------------------------------------- */

function encode() {
  const text = dom.input.value;
  if (!text) {
    state.base64 = '';
    state.vase = '';
    render();
    updateStats();
    setStatus('Nothing to plant yet.', 'warn');
    return;
  }
  state.message = text;
  state.base64 = bytesToBase64(text);
  state.vase = base64ToVase(state.base64, {
    vessel: dom.vessel.value,
    breathingRoom: dom.breathing.checked,
    stamp: dom.stamp.checked,
  });
  render();
  updateStats();
  reportVase(state.vase, state.base64.length);
}

function decode() {
  const source = dom.input.value;
  if (!source.trim()) {
    state.base64 = '';
    state.vase = '';
    render();
    updateStats();
    setStatus('Paste a vase to decode.', 'warn');
    return;
  }

  const looksLikeVase = source.split('\n').some(hasFlowers);
  if (looksLikeVase) {
    state.base64 = vaseToBase64(source);
    state.vase = source;
  } else {
    // Accept plain base64 too: it is the middle step, so people paste it.
    state.base64 = source.replace(/\s+/g, '').replace(/=+$/, '');
    state.vase = base64ToVase(state.base64, {
      vessel: dom.vessel.value,
      breathingRoom: dom.breathing.checked,
      stamp: dom.stamp.checked,
    });
  }

  if (!state.base64) {
    setStatus('No flowers or base64 found in that input.', 'bad');
    return;
  }

  try {
    state.message = decodeBase64(state.base64);
  } catch {
    setStatus('That vase could not be decoded — the base64 inside is not valid.', 'bad');
    return;
  }

  render();
  updateStats();
  const roundTrip = bytesToBase64(state.message) === state.base64;
  setStatus(
    roundTrip
      ? `Decoded ${state.base64.length} base64 characters back to text.`
      : `Decoded ${state.base64.length} characters (the payload was not a whole number of bytes).`,
    roundTrip ? 'ok' : 'warn',
  );
}

function reportVase(vase, glyphs) {
  const lines = vase.split('\n');
  const examined = Math.min(lines.length, 400);
  let bad = 0;
  for (let index = 0; index < examined; index += 1) {
    if (!hasFlowers(lines[index])) continue;
    for (const glyph of splitGlyphs(lines[index])) {
      // Ask the codec, not a string comparison: a final plant in a row can be
      // trimmed by a trailing space and still be perfectly readable.
      if (glyphToValueLenient(glyph) === -1) bad += 1;
    }
  }
  const planted = `${glyphs} base64 characters planted`;
  if (!state.monospaced) {
    setStatus(
      `${planted}, but this browser has no monospaced font, so the columns will not line up.`,
      'warn',
    );
  } else if (bad > 0) {
    setStatus(`${planted}, but ${bad} plant${bad === 1 ? '' : 's'} look damaged.`, 'warn');
  } else {
    setStatus(`${planted} — ${text(dom.input.value)}.`, 'ok');
  }
}

/** "12 bytes of text over 3 lines", for the status line. */
function text(input) {
  const bytes = new TextEncoder().encode(input).length;
  const lines = input.split('\n').length;
  return `${bytes} byte${bytes === 1 ? '' : 's'} of text over ${lines} line${lines === 1 ? '' : 's'}`;
}

/* -------------------------------------------------------------------------- */
/* base64 helpers (browser side)                                              */
/* -------------------------------------------------------------------------- */

function bytesToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/* -------------------------------------------------------------------------- */
/* chrome                                                                     */
/* -------------------------------------------------------------------------- */

function setMode(mode) {
  state.mode = mode;
  for (const tab of dom.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  }
  const decoding = mode === 'decode';
  dom.inputLabel.textContent = decoding ? 'Vase' : 'Plain text';
  dom.input.placeholder = decoding ? 'Paste a vase (or some base64)…' : 'Type something to plant…';
  dom.run.textContent = decoding ? 'Decode vase' : 'Encode to vase';
  dom.inputHint.textContent = decoding
    ? 'A vase in, text out. Outlines, line numbers and blank lines are ignored, and plain base64 works too.'
    : 'Plain text in, vase out. One base64 character per plant.';
  run();
}

function run() {
  if (state.mode === 'encode') encode();
  else decode();
}

/* -------------------------------------------------------------------------- */
/* events                                                                     */
/* -------------------------------------------------------------------------- */

for (const tab of dom.tabs) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}

dom.run.addEventListener('click', run);
dom.gutter.addEventListener('change', render);

dom.fit.addEventListener('change', () => {
  state.fit = dom.fit.checked;
  if (state.fit) state.zoom = 1; // back to exactly filling the stage
  fitToStage();
});

dom.zoomIn.addEventListener('click', () => zoomStep(1));
dom.zoomOut.addEventListener('click', () => zoomStep(-1));

dom.togglePanel.addEventListener('click', () => setPanel(!state.panelOpen));

// The stage is the sizing input, so it has to be re-measured whenever it
// changes - a window resize, a font arriving late, or the panel opening.
let lastFit = null;
const refit = () => {
  if (!state.fit) return;
  // Resizing the text can resize the element being observed, so only act when
  // the answer actually changes; that keeps the observer from looping.
  const next = Math.round(fitSize() * 10) / 10;
  if (next === lastFit) return;
  lastFit = next;
  applySize(next);
};
addEventListener('resize', refit);
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(refit).observe(dom.artifact);
}

for (const control of [dom.vessel, dom.breathing, dom.stamp]) {
  control.addEventListener('change', () => {
    if (state.mode === 'encode') run();
    else if (state.base64) run();
  });
}

dom.sample.addEventListener('click', () => {
  dom.input.value = SAMPLE;
  setMode('encode');
});

dom.clear.addEventListener('click', () => {
  dom.input.value = '';
  state.vase = '';
  state.base64 = '';
  state.message = '';
  render();
  updateStats();
  setStatus('');
  dom.input.focus();
});

dom.copy.addEventListener('click', async () => {
  const text = state.mode === 'encode' ? state.vase : state.message;
  if (!text) {
    setStatus('Nothing to copy yet.', 'warn');
    return;
  }
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    setStatus(state.mode === 'encode' ? 'Vase copied.' : 'Text copied.', 'ok');
  } catch {
    // Clipboard access can be refused; selecting the text is the fallback.
    const range = document.createRange();
    range.selectNodeContents(dom.artifact);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setStatus('Clipboard blocked — the output is selected, press ⌘/Ctrl+C.', 'warn');
  }
});

dom.download.addEventListener('click', () => {
  const text = state.mode === 'encode' ? state.vase : state.message;
  if (!text) {
    setStatus('Nothing to download yet.', 'warn');
    return;
  }
  const name = state.mode === 'encode' ? 'vase64.txt' : 'vase64-decoded.txt';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`Saved ${name}.`, 'ok');
});

dom.input.addEventListener('input', () => {
  // Live, but only once the input is small enough to stay smooth.
  if (dom.input.value.length < 20000) run();
});

// Pasting a vase is the common way in, so treat it like typing.
dom.input.addEventListener('paste', () => {
  setTimeout(() => run(), 0);
});

dom.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    run();
  }
  if (event.key === 'Escape') {
    dom.input.value = '';
    run();
  }
});

// Zoom from anywhere, and hide the panel with a bare `h`.
addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLTextAreaElement) return;
  if (event.key === '+' || event.key === '=') zoomStep(1);
  else if (event.key === '-' || event.key === '_') zoomStep(-1);
  else if (event.key === 'h') setPanel(!state.panelOpen);
  else if (event.key === 'f') {
    state.fit = !state.fit;
    dom.fit.checked = state.fit;
    fitToStage();
  }
});

/* -------------------------------------------------------------------------- */
/* go                                                                         */
/* -------------------------------------------------------------------------- */

fillVessels();
fillAlphabet();
setPanel(true);
state.monospaced = ensureMonospaced();
dom.input.value = SAMPLE;
setMode('encode');
// Before the first paint the stage can still measure as collapsed, so the
// initial fit waits for a frame; ResizeObserver then refines it if anything
// about the layout settles late.
requestAnimationFrame(() => fitToStage());
