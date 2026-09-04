const test = require('node:test');
const assert = require('node:assert');
const { createResponder, systemPrompt, clampText } = require('./responder');

function answer(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], usage: {} };
}

const WINDOW = [
  { id: 1, author: 'Тимур', text: 'кто идёт в субботу' },
  { id: 2, author: 'Женя', text: 'я пас' },
];

test('модель вправе промолчать, это не ошибка', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: false, text: '' }), samples: [] });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(out.reply, false);
});

test('в ответе на обращение replyToId — это триггер', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: true, text: 'ага' }), samples: [] });
  const out = await responder.compose({ window: WINDOW, trigger: { id: 7, author: 'Тимур', text: 'ты идёшь?' }, mode: 'addressed' });
  assert.strictEqual(out.replyToId, 7);
  assert.strictEqual(out.text, 'ага');
});

test('спонтанная реплика цепляется к сообщению, которое выбрала модель', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: true, text: 'ну да', replyToId: 2 }), samples: [] });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(out.replyToId, 2);
});

test('выдуманный id сообщения отбрасывается', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: true, text: 'ну да', replyToId: 999 }), samples: [] });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(out.replyToId, null);
});

test('слишком длинный ответ обрезается по границе фразы', () => {
  assert.strictEqual(clampText('первая фраза. вторая уже лишняя', 20), 'первая фраза.');
  assert.strictEqual(clampText('однасплошнаяоченьдлиннаястрока', 10).length, 10);
});

test('пустой текст при reply:true — это молчание', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: true, text: '   ' }), samples: [] });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(out.reply, false);
});

test('невалидный JSON — молчим, а не шлём мусор', async () => {
  const responder = createResponder({
    createMessage: async () => ({ content: [{ type: 'text', text: 'не json' }], usage: {} }),
    samples: [],
  });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(out.reply, false);
});

test('ошибка сети пробрасывается наверх без повторов', async () => {
  let calls = 0;
  const responder = createResponder({
    createMessage: async () => {
      calls += 1;
      throw new Error('502');
    },
    samples: [],
  });
  await assert.rejects(() => responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' }), /502/);
  assert.strictEqual(calls, 1);
});

test('в запрос уходит выбранная модель', async () => {
  const seen = [];
  const responder = createResponder({
    model: 'claude-opus-5',
    createMessage: async (req) => {
      seen.push(req);
      return answer({ reply: false, text: '' });
    },
    samples: [],
  });
  await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(seen[0].model, 'claude-opus-5');
});

test('промпт держит образцы речи и потолок длины', () => {
  const prompt = systemPrompt({ samples: ['прост', 'тор'], maxChars: 160, mode: 'spontaneous' });
  assert.match(prompt, /прост/);
  assert.match(prompt, /160/);
  assert.match(prompt, /промолч/i);
});

test('промпт для обращения и для своей воли разный', () => {
  const addressed = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed' });
  const spontaneous = systemPrompt({ samples: [], maxChars: 160, mode: 'spontaneous' });
  assert.notStrictEqual(addressed, spontaneous);
  assert.match(addressed, /обрат/i);
});

test('без образцов речи промпт не разваливается', () => {
  assert.ok(systemPrompt({ samples: [], maxChars: 160, mode: 'addressed' }).length > 100);
});
