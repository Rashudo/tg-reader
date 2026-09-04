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

test('стоимость вызова попадает в журнал', async () => {
  const lines = [];
  const responder = createResponder({
    createMessage: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ reply: false, text: '' }) }],
      usage: { input_tokens: 2000, output_tokens: 50 },
    }),
    samples: [],
    log: (line) => lines.push(line),
  });
  await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.ok(lines.some((line) => /токенов на входе 2000/.test(line)));
});

test('ответ без учёта токенов не роняет вызов', async () => {
  const responder = createResponder({
    createMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ reply: false, text: '' }) }] }),
    samples: [],
    log: () => {},
  });
  assert.strictEqual((await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' })).reply, false);
});

test('промпт ставит модель на место самого хозяина, а не наблюдателя', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /ты — Стас/i);
  assert.match(prompt, /первого лица/i);
  assert.ok(!/Он там свой/.test(prompt));
});

test('промпт запрещает говорить о себе по имени', () => {
  assert.match(systemPrompt({ samples: [], maxChars: 160, mode: 'spontaneous', name: 'Стас' }), /третьем лице/i);
});

test('свои сообщения в окне подписаны «ты», а не именем', async () => {
  const seen = [];
  const responder = createResponder({
    createMessage: async (req) => {
      seen.push(req);
      return answer({ reply: false, text: '' });
    },
    samples: [],
    name: 'Стас',
  });
  await responder.compose({
    window: [
      { id: 1, author: 'Стас', mine: true, text: 'сейчас гляну' },
      { id: 2, author: 'Тимур', mine: false, text: 'ну как?' },
    ],
    trigger: null,
    mode: 'spontaneous',
  });
  const content = seen[0].messages[0].content;
  assert.match(content, /\[1\] ты: сейчас гляну/);
  assert.match(content, /\[2\] Тимур: ну как\?/);
});

test('промпт требует новой мысли в каждой реплике', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /новая мысль/i);
  assert.match(prompt, /шутк/i);
});

test('в промпт уходит список уже сказанного', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас', avoid: ['только на рот парня'] });
  assert.match(prompt, /только на рот парня/);
  assert.match(prompt, /уже говорил/i);
});

test('без списка сказанного промпт не ломается', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас', avoid: [] });
  assert.ok(!/уже говорил/i.test(prompt));
});

test('список сказанного доезжает до запроса', async () => {
  const seen = [];
  const responder = createResponder({
    createMessage: async (req) => {
      seen.push(req);
      return answer({ reply: false, text: '' });
    },
    samples: [],
  });
  await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous', avoid: ['про пироги'] });
  assert.match(seen[0].system, /про пироги/);
});

test('промпт целиком на «ты», без следов третьего лица', () => {
  const prompt = systemPrompt({ samples: ['прост'], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /так ты пишешь/i);
  assert.ok(!/так он пишет/i.test(prompt));
  assert.ok(!/его пунктуация/i.test(prompt));
});

test('промпт ставит прямой ответ выше поддержания темы', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /ответь по существу/i);
  assert.match(prompt, /той же формулировк|одну и ту же/i);
  assert.ok(!/можно и нужно/i.test(prompt));
});

test('на ответ отводится вдвое больше токенов', async () => {
  const seen = [];
  const responder = createResponder({
    createMessage: async (req) => {
      seen.push(req);
      return answer({ reply: false, text: '' });
    },
    samples: [],
  });
  await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous' });
  assert.strictEqual(seen[0].max_tokens, 800);
});

test('роль описана как постироничная, а не язвительная', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /постироничн/i);
  assert.ok(!/язвительн/i.test(prompt));
});
