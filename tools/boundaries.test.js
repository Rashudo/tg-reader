const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { jsFilesUnder, requiresOf, hasProcessExit } = require('./boundaries');

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boundaries-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('находит js во вложенных каталогах и не заглядывает в node_modules', () => {
  const root = fixture({
    'a.js': '',
    'deep/b.js': '',
    'deep/more/c.js': '',
    'deep/notes.md': '',
    'node_modules/pkg/d.js': '',
  });
  assert.deepStrictEqual(jsFilesUnder(root), ['a.js', 'deep/b.js', 'deep/more/c.js']);
});

test('собирает пути из require со строковым литералом', () => {
  const source = [
    "const fs = require('fs');",
    'const { a } = require("./a");',
    'const dyn = require(name);',
  ].join('\n');
  assert.deepStrictEqual(requiresOf(source), ['fs', './a']);
});

test('require внутри строки или комментария в счёт не идёт', () => {
  assert.deepStrictEqual(requiresOf('const s = "require(\'fs\')";'), []);
  assert.deepStrictEqual(requiresOf("// require('fs')"), []);
  assert.deepStrictEqual(requiresOf("/* require('fs') */"), []);
});

test('видит process.exit в любом написании со скобкой', () => {
  assert.strictEqual(hasProcessExit('process.exit(1);'), true);
  assert.strictEqual(hasProcessExit('process.exit (0)'), true);
  assert.strictEqual(hasProcessExit('const exit = process.exitCode;'), false);
  assert.strictEqual(hasProcessExit('const s = "process.exit(1)";'), false);
});

const srcRoot = path.join(__dirname, '..', 'src');

function importsBySrcFile() {
  const map = new Map();
  for (const rel of jsFilesUnder(srcRoot)) {
    map.set(rel, requiresOf(fs.readFileSync(path.join(srcRoot, rel), 'utf8')));
  }
  return map;
}

test('правило 6: telegram импортируется только в platform/telegram', () => {
  const guilty = [];
  for (const [file, imports] of importsBySrcFile()) {
    if (file.startsWith('platform/telegram/')) continue;
    if (imports.some((name) => name === 'telegram' || name.startsWith('telegram/'))) guilty.push(file);
  }
  assert.deepStrictEqual(guilty, [], `gramjs протёк за пределы адаптера: ${guilty.join(', ')}`);
});

test('правило 2: фича не импортирует чужую фичу', () => {
  const guilty = [];
  for (const [file, imports] of importsBySrcFile()) {
    const own = file.match(/^features\/([^/]+)\//);
    if (!own) continue;
    for (const name of imports) {
      const target = name.match(/features\/([^/]+)\//);
      if (target && target[1] !== own[1]) guilty.push(`${file} -> ${name}`);
    }
  }
  assert.deepStrictEqual(guilty, [], `общее место фич — platform или shared: ${guilty.join(', ')}`);
});
