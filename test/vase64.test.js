import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE64_ALPHABET,
  GLYPHS,
  GLYPH_SIGNATURES,
  LEAVES,
  PLANT_ALPHABET,
  VESSELS,
  base64ToVase,
  countGlyphs,
  decodeVase,
  encodeToVase,
  glyphToValue,
  glyphToValueLenient,
  hasFlowers,
  inspectVase,
  isPlantRow,
  splitGlyphs,
  vaseToBase64,
} from '../src/vase64.js';

const VESSEL_NAMES = Object.keys(VESSELS);

/* -------------------------------------------------------------------------- */
/* the glyph table                                                            */
/* -------------------------------------------------------------------------- */

test('there are 64 glyphs and every one is distinct', () => {
  assert.equal(GLYPHS.length, 64);
  assert.equal(new Set(GLYPH_SIGNATURES).size, 64);
});

test('every glyph is two rows of five columns', () => {
  for (const [value, glyph] of GLYPHS.entries()) {
    assert.equal(glyph.length, 2, `glyph ${value}`);
    assert.equal(glyph[0].length, 5, `glyph ${value} top row`);
    assert.equal(glyph[1].length, 5, `glyph ${value} bottom row`);
    assert.ok(
      [...glyph[0].split('').join('')].every((character) => ` ${PLANT_ALPHABET}`.includes(character)),
      `glyph ${value} uses only plant characters: ${JSON.stringify(glyph[0])}`,
    );
  }
});

test('every glyph carries exactly one bloom and two stems', () => {
  for (const [value, glyph] of GLYPHS.entries()) {
    assert.ok(isPlantRow(glyph[0]), `glyph ${value} should read as a plant`);
    assert.equal(glyphToValue(glyph[0], glyph[1]), value);
  }
});

test('blooms, stems and leaves never share a character', () => {
  const blooms = 'oO*@';
  const stems = '|:!;';
  for (const character of stems) assert.ok(!blooms.includes(character));
  for (const character of LEAVES) {
    assert.ok(!blooms.includes(character), `leaf ${character} looks like a bloom`);
    assert.ok(!stems.includes(character), `leaf ${character} looks like a stem`);
  }
});

test('glyphs decode back to their own value, strictly and leniently', () => {
  for (const [value, glyph] of GLYPHS.entries()) {
    assert.equal(glyphToValue(glyph[0], glyph[1]), value, `glyph ${value} exact`);
    // Both readers must agree on every glyph: they are the same codec seen
    // through different amounts of tolerance.
    assert.equal(glyphToValueLenient(glyph[0]), value, `glyph ${value} lenient`);
    // Only the leaves reach column 0, so a row's first character is always a
    // leaf or a space - never a stem or a bloom.
    assert.ok(' /\\'.includes(glyph[0][0]), `glyph ${value} starts on a leaf or a gap`);
  }
});

test('a row with the wrong number of stems or blooms is not a plant', () => {
  assert.equal(glyphToValueLenient('***'), -1); // three blooms
  assert.equal(glyphToValueLenient('|||'), -1); // three stems
  // `isPlantRow` is the structural test - one bloom, two stems - while the
  // stem pair only becomes a value if it is one of the four styles.
  assert.equal(isPlantRow('|*|'), true);
  assert.equal(glyphToValueLenient('|*|'), -1);
  assert.equal(glyphToValueLenient(' |*: '), 32); // a real glyph
  assert.equal(isPlantRow(' |*: '), true);
  assert.equal(isPlantRow('  *  '), false); // bloom but no stem
  assert.equal(isPlantRow('|  |'), false); // stems but no bloom
  assert.equal(isPlantRow('|:  '), false);
  assert.equal(isPlantRow('     '), false);
  assert.equal(isPlantRow(''), false);
});

test('vase rows are never mistaken for plants', () => {
  for (const name of VESSEL_NAMES) {
    for (const row of VESSELS[name].art) {
      assert.equal(isPlantRow(row), false, `${name}: ${JSON.stringify(row)}`);
    }
  }
});

test('a vase row never carries a bloom, which is what marks a plant', () => {
  // Bloom characters are reserved for the flower bed: the vase is drawn only
  // from lines, so no amount of widening or decoration can invent a plant.
  for (const name of VESSEL_NAMES) {
    for (const row of VESSELS[name].art) {
      assert.ok(!/[oO*@]/.test(row), `${name}: ${JSON.stringify(row)}`);
    }
  }
  assert.equal(isPlantRow(' \\_/ '), false);
  assert.equal(isPlantRow('  |  '), false);
  assert.equal(isPlantRow(' |~~~| '), false);
  assert.equal(isPlantRow('|-----------|'), false);
});

/* -------------------------------------------------------------------------- */
/* round trips                                                                */
/* -------------------------------------------------------------------------- */

const SAMPLES = [
  '',
  'A',
  'Hi vase!',
  'VASE64 is base64, but it blooms.',
  'The quick brown fox jumps over the lazy dog. 0123456789',
  'line one\nline two\ttabbed',
  'unicode: café naïve résumé',
  'emoji: 🌷🌻🪴 bloom',
  'CJK: 花瓶に生けました',
  'math: 𝕍𝔸𝕊𝔼64',
  'trailing space ',
  ' leading space',
  'aaaa'.repeat(200),
];

test('text survives the trip through the vase', () => {
  for (const text of SAMPLES) {
    assert.equal(decodeVase(encodeToVase(text)), text, `sample: ${JSON.stringify(text.slice(0, 24))}`);
  }
});

test('every sample survives in every vessel', () => {
  for (const vessel of VESSEL_NAMES) {
    for (const text of SAMPLES) {
      const vase = encodeToVase(text, { vessel });
      assert.equal(decodeVase(vase), text, `${vessel}: ${JSON.stringify(text.slice(0, 24))}`);
    }
  }
});

test('random bytes survive the trip', () => {
  for (let round = 0; round < 40; round += 1) {
    const length = 1 + Math.floor(Math.random() * 96);
    const bytes = Array.from({ length }, () => Math.floor(Math.random() * 256));
    const text = Buffer.from(bytes).toString('latin1');
    const decoded = decodeVase(encodeToVase(text));
    assert.deepEqual([...Buffer.from(decoded, 'latin1')], bytes, `round ${round}`);
  }
});

test('every single base64 character round trips', () => {
  for (const character of BASE64_ALPHABET) {
    const vase = base64ToVase(character);
    assert.equal(vaseToBase64(vase), character, `character ${character}`);
  }
});

test('all 64 glyphs can appear in one vase and come back in order', () => {
  const base64 = BASE64_ALPHABET;
  const vase = base64ToVase(base64);
  assert.equal(vaseToBase64(vase), base64);
  assert.equal(vaseToBase64(vase.replace(/=/g, '')), base64);
});

test('padding is implicit and survives decoding', () => {
  // "Hi" is 2 bytes -> "SGk=" in standard base64, stored as "SGk".
  // Padding is never stored as a plant: `=` is not in the alphabet, so it can
  // only ever appear as decorative banding inside the vase.
  assert.equal(vaseToBase64(encodeToVase('Hi')), 'SGk');
  assert.equal(vaseToBase64(encodeToVase('Hi!')), 'SGkh');
  // A vase for an empty message grows nothing at all.
  assert.ok(!/[oO*@]/.test(encodeToVase('')));
  assert.equal(decodeVase(encodeToVase('Hi')), 'Hi');
  assert.equal(countGlyphs(encodeToVase('Hi')), 3);
});

/* -------------------------------------------------------------------------- */
/* vessel geometry                                                            */
/* -------------------------------------------------------------------------- */

test('every vessel is the same height and has a rim with a mouth', () => {
  const heights = new Set();
  for (const name of VESSEL_NAMES) {
    const { art, pour } = VESSELS[name];
    heights.add(art.length);
    assert.ok(pour > 0 && pour < art.length, `${name} pour`);
    assert.ok(art[pour].includes('|'), `${name} rim should have walls`);
  }
  assert.equal(heights.size, 1);
});

test('vases of every vessel are wider than they are deep', () => {
  for (const name of VESSEL_NAMES) {
    const vase = base64ToVase(BASE64_ALPHABET, { vessel: name });
    const lines = vase.split('\n');
    assert.ok(lines.length > VESSELS[name].art.length, `${name} should have flowers`);
    assert.equal(vaseToBase64(vase), BASE64_ALPHABET, `${name} round trip`);
  }
});

test('flowers stay above the rim, and nothing paints over the walls', () => {
  for (const name of VESSEL_NAMES) {
    const vase = base64ToVase(BASE64_ALPHABET, { vessel: name });
    const lines = vase.split('\n');
    const bodyStart = lines.length - VESSELS[name].art.length - 2; // -1 blank, -1 stamp
    const body = lines.slice(bodyStart);
    assert.ok(body.some((line) => line.includes('~~~')), `${name} water line`);
  }
});

test('a bigger payload grows a bigger vase and wraps the bouquet', () => {
  const small = base64ToVase('SGk');
  const big = base64ToVase('SGk'.repeat(300));
  const width = (vase) => Math.max(...vase.split('\n').map((line) => line.length));
  assert.ok(width(big) >= width(small));
  assert.ok(width(big) <= 121);
});

test('an empty payload still renders a vessel', () => {
  const vase = encodeToVase('');
  assert.equal(vaseToBase64(vase), '');
  assert.equal(decodeVase(vase), '');
  assert.ok(vase.includes('_____')); // the pot is still there
  assert.ok(!/[oO*@]/.test(vase)); // with nothing growing in it
  const report = inspectVase(vase);
  assert.equal(report.glyphs, 0);
  assert.equal(report.ok, false); // an empty vase holds no message
  assert.deepEqual(report.problems, []); // but it is not malformed
});

/* -------------------------------------------------------------------------- */
/* tolerant reading                                                           */
/* -------------------------------------------------------------------------- */

test('the outline, gutters, stamp and stray whitespace are ignored', () => {
  const text = 'Round trip through a messy terminal';
  const vase = encodeToVase(text, { vessel: 'bowl' });
  const numbered = vase
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(3)} | ${line}`)
    .join('\n');
  assert.equal(decodeVase(numbered), text);
  assert.equal(decodeVase(vase.replace(/\n/g, '\r\n')), text);
  assert.equal(decodeVase(vase.split('\n').join('\n\n')), text);
  assert.equal(decodeVase(vase.replace(/ /g, '  ')), text);
});

test('a vase with the frame deleted still decodes', () => {
  const text = 'Just the flowers, please';
  const vase = encodeToVase(text);
  const petals = vase
    .split('\n')
    .filter((line) => hasFlowers(line))
    .join('\n');
  assert.equal(decodeVase(petals), text);
});

test('isPlantRow accepts rows whose leaves were retouched', () => {
  const [top] = GLYPHS[0b100000]; // a bloom with both leaves
  assert.equal(isPlantRow(top), true);
  assert.equal(isPlantRow(`${top.slice(1)} `), true);
});

test('inspectVase reports trouble without throwing', () => {
  assert.deepEqual(inspectVase('').glyphs, 0);
  const damaged = `${GLYPHS[5][0]}\nVASE64\n  |\n***\n`;
  const report = inspectVase(damaged);
  assert.equal(report.ok, false);
  assert.ok(report.problems.length > 0);
  assert.equal(report.glyphs, 1);
});

test('invalid input is rejected loudly', () => {
  assert.throws(() => base64ToVase('not base64!'), /not a base64 character/);
  assert.throws(() => base64ToVase('SGk', { vessel: 'amphora' }), /unknown vessel/);
  assert.throws(() => encodeToVase(null, { vessel: 'nope' }), /unknown vessel/);
});
