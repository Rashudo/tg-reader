const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickSamples, samplesOf } = require('./voice');
const { readJson } = require('../../platform/json-file');

const loadVoice = (file) => ({ samples: samplesOf(readJson(file, null)) });

function tmpFile(content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-')), 'voice.json');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

test('слишком короткие и слишком длинные в образцы не идут', () => {
  const picked = pickSamples(
    [
      { text: 'ок' },
      { text: 'а если увидишь фотку, где мы держим шмеля' },
      { text: 'x'.repeat(500) },
    ],
    { limit: 10, minWords: 3, maxChars: 200 }
  );
  assert.deepStrictEqual(picked, ['а если увидишь фотку, где мы держим шмеля']);
});

test('ссылки и пересланное в образцы не идут', () => {
  const picked = pickSamples(
    [{ text: 'смотри https://t.me/x какой пост' }, { text: 'ну ты и жук конечно' }],
    { limit: 10, minWords: 3, maxChars: 200 }
  );
  assert.deepStrictEqual(picked, ['ну ты и жук конечно']);
});

test('образцов не больше лимита, берём свежие', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ text: `фраза номер ${i} для теста` }));
  const picked = pickSamples(many, { limit: 60, minWords: 3, maxChars: 200 });
  assert.strictEqual(picked.length, 60);
  assert.strictEqual(picked[0], 'фраза номер 0 для теста');
});

test('повторы схлопываются', () => {
  const picked = pickSamples(
    [{ text: 'ну ты и жук' }, { text: 'ну ты и жук' }, { text: 'а вот и нет' }],
    { limit: 10, minWords: 3, maxChars: 200 }
  );
  assert.deepStrictEqual(picked, ['ну ты и жук', 'а вот и нет']);
});

test('нет файла — пустой голос, а не падение', () => {
  assert.deepStrictEqual(loadVoice('/нет/такого/файла.json'), { samples: [] });
});

test('битый файл — пустой голос, а не падение', () => {
  assert.deepStrictEqual(loadVoice(tmpFile('{не json')), { samples: [] });
});

test('файл с образцами читается', () => {
  const file = tmpFile(JSON.stringify({ samples: ['прост', 'тор'] }));
  assert.deepStrictEqual(loadVoice(file), { samples: ['прост', 'тор'] });
});

test('многострочный образец склеивается в одну строку', () => {
  const picked = pickSamples([{ text: 'я тут подумал, что денег в крипте много.\nПоэтому заказал кошелёк' }], {
    limit: 10,
    minWords: 3,
    maxChars: 200,
  });
  assert.deepStrictEqual(picked, ['я тут подумал, что денег в крипте много. Поэтому заказал кошелёк']);
});
