const test = require('node:test');
const assert = require('node:assert');
const { createResponder, systemPrompt, clampText, ensureQuestion, capitalize, SCHEMA } = require('./responder');

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
  assert.strictEqual(out.text, 'Ага');
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

test('промпт ставит ответ по существу выше разговора ради разговора', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /по существу/i);
  assert.match(prompt, /ради разговора/i);
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
  assert.strictEqual(seen[0].max_tokens, 1200);
});

test('роль описана как постироничная, а не язвительная', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /постироничн/i);
  assert.ok(!/язвительн/i.test(prompt));
});

test('промпт требует отвечать на само сообщение, а переписку держать фоном', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /по существу того, что тебе написали/i);
  assert.match(prompt, /фон/i);
  assert.ok(!/поддержать общую тему/i.test(prompt));
});

test('в режиме обращения задача — ответить именно на это сообщение', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', name: 'Стас' });
  assert.match(prompt, /именно на это сообщение/i);
});

test('удачные реплики попадают в промпт с пометкой «зашло»', () => {
  const prompt = systemPrompt({ graded: { liked: ['ну да, конечно'], disliked: [] } });
  assert.match(prompt, /зашло: «ну да, конечно»/);
});

test('неудачные реплики попадают в промпт с пометкой «не зашло»', () => {
  const prompt = systemPrompt({ graded: { liked: [], disliked: ['рот парня'] } });
  assert.match(prompt, /не зашло: «рот парня»/);
});

test('оценённые реплики даны как интонация, а не как текст для повтора', () => {
  const prompt = systemPrompt({ graded: { liked: ['ну да, конечно'], disliked: [] } });
  assert.match(prompt, /дословно.*не повтор/s);
});

test('без оценок блока в промпте нет', () => {
  const prompt = systemPrompt({ graded: { liked: [], disliked: [] } });
  assert.doesNotMatch(prompt, /зашло/);
});

test('compose доносит оценки до модели', async () => {
  let seen = null;
  const responder = createResponder({
    createMessage: async (request) => {
      seen = request.system;
      return answer({ reply: false, text: '' });
    },
    samples: [],
  });
  await responder.compose({
    window: WINDOW,
    trigger: null,
    mode: 'spontaneous',
    graded: { liked: ['зашедшая реплика'], disliked: ['провальная реплика'] },
  });
  assert.match(seen, /зашло: «зашедшая реплика»/);
  assert.match(seen, /не зашло: «провальная реплика»/);
});

test('продолжение ветки требует повода, иначе молчание', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', followUp: 'soft' });
  assert.match(prompt, /продолжение/i);
  assert.match(prompt, /reply: false/);
});

test('исчерпанная ветка требует прямого вопроса', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', followUp: 'strict' });
  assert.match(prompt, /наговорился/i);
  assert.match(prompt, /reply: false/);
});

test('первое обращение о продолжении ветки не поминает', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', followUp: false });
  assert.ok(!/продолжение ветки/i.test(prompt));
});

test('признак продолжения доходит от ответчика до промпта', async () => {
  const seen = [];
  const responder = createResponder({
    createMessage: async (req) => {
      seen.push(req);
      return answer({ reply: false, text: '' });
    },
    samples: [],
  });
  await responder.compose({ window: WINDOW, trigger: null, mode: 'addressed', followUp: 'soft' });
  assert.match(seen[0].system, /продолжение/i);
});

test('вопрос без знака его получает', () => {
  assert.strictEqual(ensureQuestion('а ты идёшь', true), 'а ты идёшь?');
});

test('утверждение знаком вопроса не обрастает', () => {
  assert.strictEqual(ensureQuestion('да я и не собирался', false), 'да я и не собирался');
});

test('второй знак вопроса не приписывается', () => {
  assert.strictEqual(ensureQuestion('а ты идёшь?', true), 'а ты идёшь?');
});

test('точка в конце вопроса меняется на знак вопроса', () => {
  assert.strictEqual(ensureQuestion('и чо теперь.', true), 'и чо теперь?');
});

test('смайлик в хвосте вопроса остаётся на месте', () => {
  assert.strictEqual(ensureQuestion('и чо теперь )', true), 'и чо теперь? )');
});

test('пустой текст остаётся пустым', () => {
  assert.strictEqual(ensureQuestion('', true), '');
});

test('схема спрашивает модель, вопрос ли это', () => {
  assert.ok(SCHEMA.properties.question);
  assert.ok(SCHEMA.required.includes('question'));
});

test('признак вопроса доходит до отправленного текста', async () => {
  const responder = createResponder({
    createMessage: async () => answer({ reply: true, text: 'а во сколько', question: true }),
    samples: [],
  });
  const out = await responder.compose({ window: WINDOW, trigger: { id: 7, author: 'Тимур', text: 'встречаемся' }, mode: 'addressed' });
  assert.strictEqual(out.text, 'А во сколько?');
});

test('правила требуют простой речи и знака вопроса', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed' });
  assert.match(prompt, /прост/i);
  assert.match(prompt, /знаком вопроса/i);
});

const CATALOGUE = [{ id: 'm1', kind: 'gif', emoji: '', note: 'мужик закатывает глаза' }];

test('каталог картинок попадает в промпт', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed', memes: CATALOGUE });
  assert.match(prompt, /m1: гифка — мужик закатывает глаза/);
});

test('без каталога промпт про картинки молчит', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed' });
  assert.ok(!/под рукой/.test(prompt));
});

test('выбранная картинка возвращается вместо текста', async () => {
  const responder = createResponder({
    createMessage: async () => answer({ reply: true, text: '', meme: 'm1', question: false }),
    samples: [],
  });
  const out = await responder.compose({ window: WINDOW, trigger: { id: 7, author: 'Тимур', text: 'ну как' }, mode: 'addressed', memes: CATALOGUE });
  assert.strictEqual(out.meme.id, 'm1');
  assert.strictEqual(out.text, '');
  assert.strictEqual(out.replyToId, 7);
});

test('выдуманный id картинки отбрасывается', async () => {
  const responder = createResponder({
    createMessage: async () => answer({ reply: true, text: 'ну да', meme: 'm9', question: false }),
    samples: [],
  });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous', memes: CATALOGUE });
  assert.strictEqual(out.meme, null);
  assert.strictEqual(out.text, 'Ну да');
});

test('картинка без текста молчанием не считается', async () => {
  const responder = createResponder({
    createMessage: async () => answer({ reply: true, text: '   ', meme: 'm1', question: false }),
    samples: [],
  });
  const out = await responder.compose({ window: WINDOW, trigger: null, mode: 'spontaneous', memes: CATALOGUE });
  assert.strictEqual(out.reply, true);
});

test('реплика начинается с большой буквы', () => {
  assert.strictEqual(capitalize('ну 300 так 300'), 'Ну 300 так 300');
});

test('уже большая буква остаётся как есть', () => {
  assert.strictEqual(capitalize('Ну да'), 'Ну да');
});

test('кавычка и скобка в начале не мешают', () => {
  assert.strictEqual(capitalize('«да ладно»'), '«Да ладно»');
  assert.strictEqual(capitalize(')) ага'), ')) Ага');
});

test('цифра или эмодзи в начале большой буквы не требуют', () => {
  assert.strictEqual(capitalize('300 закину'), '300 закину');
  assert.strictEqual(capitalize('🔥 огонь'), '🔥 Огонь');
});

test('пустой текст остаётся пустым', () => {
  assert.strictEqual(capitalize(''), '');
});

test('отправленный текст приходит с большой буквы', async () => {
  const responder = createResponder({
    createMessage: async () => answer({ reply: true, text: 'ок, значит 300 закину', question: false }),
    samples: [],
  });
  const out = await responder.compose({ window: WINDOW, trigger: { id: 7, author: 'Тимур', text: 'скинь' }, mode: 'addressed' });
  assert.strictEqual(out.text, 'Ок, значит 300 закину');
});

test('правила требуют больших букв в начале и в именах', () => {
  const prompt = systemPrompt({ samples: [], maxChars: 160, mode: 'addressed' });
  assert.match(prompt, /с большой буквы/);
  assert.match(prompt, /имена/i);
});

test('образцы речи показываются с большой буквы, как и требуют правила', () => {
  const prompt = systemPrompt({ samples: ['ну такое'], maxChars: 160, mode: 'addressed' });
  assert.match(prompt, /— Ну такое/);
});
