#!/usr/bin/env node
/**
 * VASE64 on the command line.
 *
 *   vase64 encode "hello"          text  -> vase
 *   vase64 decode < vase.txt       vase  -> text
 *   cat notes.md | vase64 encode > notes.vase
 *
 * Exit codes: 0 success, 1 bad usage or unreadable input, 2 nothing to decode.
 */
import { readFileSync } from 'node:fs';

import { decodeVase, encodeToVase } from '../src/vase64.js';

const USAGE = `vase64 - base64, but it blooms

Usage
  vase64 encode [text...] [options]
  vase64 decode [vase...] [options]

With no text or file, input is read from stdin.

Options
  -f, --file <path>     read input from a file
  -l, --layout <name>   auto | vase | bed (default: auto)
  -h, --help            show this message

Examples
  vase64 encode "hello world"
  vase64 encode -f README.md --layout bed > readme.vase
  vase64 decode < readme.vase
`;

/** Parse argv into a command plus its options, without pulling in a parser. */
function parseArgs(argv) {
  const options = { layout: 'auto', file: null, words: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-f':
      case '--file':
        options.file = argv[(index += 1)];
        break;
      case '-l':
      case '--layout':
        options.layout = argv[(index += 1)];
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option "${arg}"`);
        options.words.push(arg);
    }
  }
  return options;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function fail(message, code) {
  process.stderr.write(`vase64: ${message}\n`);
  process.exit(code);
}

const [, , command, ...rest] = process.argv;

if (!command || command === '-h' || command === '--help') {
  process.stdout.write(USAGE);
  process.exit(command ? 0 : 1);
}

let options;
try {
  options = parseArgs(rest);
} catch (error) {
  fail(error.message, 1);
}

if (options.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (!['auto', 'vase', 'bed'].includes(options.layout)) {
  fail(`unknown layout "${options.layout}" (try auto, vase or bed)`, 1);
}

let input;
try {
  if (options.file) input = readFileSync(options.file, 'utf8');
  else if (options.words.length > 0) input = options.words.join(' ');
  else input = readStdin();
} catch (error) {
  fail(error.message, 1);
}

if (command === 'encode') {
  process.stdout.write(`${encodeToVase(input, { layout: options.layout })}\n`);
} else if (command === 'decode') {
  const text = decodeVase(input);
  if (text.length === 0 && input.trim().length > 0) {
    fail('found no flowers in that input', 2);
  }
  process.stdout.write(`${text}\n`);
} else {
  fail(`unknown command "${command}" (try encode or decode)`, 1);
}
