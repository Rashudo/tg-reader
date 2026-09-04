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
