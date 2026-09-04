# Автоответы в чате — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сервис отвечает в чате «Сербские Литл Плееры» от имени аккаунта: всегда на обращения, 3–4 раза в сутки по своей воле, с мгновенным выключателем.

**Architecture:** Два контура внутри уже подключённого MTProto-клиента. Чистые правила молчания отделены от оркестрации; модель и Telegram инжектируются, как в `notify.js` и `summarizer.js`. Бот впервые читает входящие через `getUpdates`.

**Tech Stack:** Node 22, GramJS 2.26, `@anthropic-ai/sdk`, `node --test`, systemd.

**Spec:** `docs/superpowers/specs/2026-09-04-chat-replies-design.md`

## Global Constraints

- Комментариев в коде нет — объяснения идут в README и сообщения коммитов.
- Один MTProto-клиент на всю систему: ответы отправляются тем же `client`, что читает каналы.
- Никаких повторных попыток при ошибке модели: молчим.
- Все тесты — `node --test src/*.test.js`, транспорты подставные, сеть не трогается.
- Замеренные факты чата: id `4191861169`, обычная группа (`Chat`, не супергруппа), 4 участника, 438 сообщений в сутки, аккаунт `6307473828` (@KirikiAwesome).
- Часовой пояс потолков — `Europe/Belgrade`.

---

### Task 1: Настройки и состояние

**Files:**
- Modify: `src/config.js`, `src/state.js`, `.env.example`
- Test: `src/state.test.js`

**Interfaces:**
- Produces: `config.replies = { chat, enabled, model, aliases[], dailyBudget, addressedBudget, spontaneousPauseMin, addressedPauseMin, delayMinSec, delayMaxSec, quietFrom, quietTo, context, minFresh, ownerSilenceMin }`
- Produces на `state`: `repliesEnabled()`, `setRepliesEnabled(on)`, `replyCounters(day)`, `noteReply(kind, at, day)`, `wasAnswered(id)`, `noteAnswered(id)`, `botOffset()`, `setBotOffset(n)`

- [ ] **Step 1: Тесты состояния**

```js
test('выключенные ответы переживают перезапуск', () => {
  const file = tmpFile();
  const first = createState(file);
  first.setRepliesEnabled(false);
  first.flush();
  assert.strictEqual(createState(file).repliesEnabled(), false);
});

test('счётчики ответов обнуляются со сменой суток', () => {
  const s = createState(tmpFile());
  s.noteReply('spontaneous', 1000, '2026-09-04');
  assert.strictEqual(s.replyCounters('2026-09-04').spontaneous, 1);
  assert.strictEqual(s.replyCounters('2026-09-05').spontaneous, 0);
});

test('на одно сообщение отвечаем один раз', () => {
  const file = tmpFile();
  const s = createState(file);
  s.noteAnswered(42);
  s.flush();
  assert.strictEqual(createState(file).wasAnswered(42), true);
});
```

- [ ] **Step 2: Запустить, убедиться, что падают** — `node --test src/state.test.js`, ожидается `repliesEnabled is not a function`.

- [ ] **Step 3: Реализация в `src/state.js`**

Служебная запись `_service` получает поле `replies`:

```js
const BLANK_REPLIES = { enabled: true, day: null, addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0, answered: [], botOffset: 0 };
```

`repliesEnabled()` — `replies.enabled !== false`. `noteReply(kind, at, day)` при смене `day` обнуляет оба счётчика. `noteAnswered(id)` держит последние `ANSWERED_MEMORY = 500` id, как уже сделано для `sent`.

- [ ] **Step 4: Тесты зелёные** — `node --test src/state.test.js`.

- [ ] **Step 5: Настройки в `src/config.js`**

```js
replies: {
  chat: (process.env.REPLY_CHAT || '').trim(),
  enabled: (process.env.REPLY_ENABLED || 'on').trim().toLowerCase() !== 'off',
  model: (process.env.REPLY_MODEL || 'claude-haiku-4-5').trim(),
  aliases: listFromEnv(process.env.REPLY_ALIASES),
  dailyBudget: numFromEnv(process.env.REPLY_DAILY_BUDGET, 4),
  addressedBudget: numFromEnv(process.env.REPLY_ADDRESSED_BUDGET, 10),
  spontaneousPauseMin: numFromEnv(process.env.REPLY_SPONTANEOUS_PAUSE_MIN, 90),
  addressedPauseMin: numFromEnv(process.env.REPLY_ADDRESSED_PAUSE_MIN, 5),
  delayMinSec: numFromEnv(process.env.REPLY_DELAY_MIN_SEC, 120),
  delayMaxSec: numFromEnv(process.env.REPLY_DELAY_MAX_SEC, 240),
  quietFrom: numFromEnv(process.env.REPLY_QUIET_FROM, 23),
  quietTo: numFromEnv(process.env.REPLY_QUIET_TO, 9),
  context: numFromEnv(process.env.REPLY_CONTEXT, 30),
  minFresh: numFromEnv(process.env.REPLY_MIN_FRESH, 5),
  ownerSilenceMin: numFromEnv(process.env.REPLY_OWNER_SILENCE_MIN, 15),
  maxChars: numFromEnv(process.env.REPLY_MAX_CHARS, 160),
}
```

Те же переменные с пояснениями — в `.env.example`.

- [ ] **Step 6: Коммит** — `git add -A && git commit -m "Настройки и состояние автоответов"`

---

### Task 2: Правила молчания

**Files:**
- Create: `src/reply-rules.js`, `src/reply-rules.test.js`

**Interfaces:**
- Consumes: `localDayOf` из `src/schedule.js`
- Produces: `isAddressed(msg, { meId, aliases, messageById })`, `inQuietHours(at, { from, to, timeZone })`, `decideAddressed(input)`, `decideSpontaneous(input)`; обе `decide*` возвращают `{ allow: boolean, why: string }`

- [ ] **Step 1: Тесты**

```js
test('ответ на моё сообщение — обращение', () => {
  const byId = new Map([[10, { id: 10, from: 'me' }]]);
  const msg = { id: 11, from: 'other', replyTo: 10, text: 'ну как?' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: [], messageById: byId }), true);
});

test('упоминание по прозвищу — обращение', () => {
  const msg = { id: 11, from: 'other', replyTo: null, text: 'стас, ты где' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), true);
});

test('чужой разговор — не обращение', () => {
  const msg = { id: 11, from: 'other', replyTo: null, text: 'вчера было душно' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), false);
});

test('своё сообщение обращением не считается', () => {
  const msg = { id: 11, from: 'me', replyTo: null, text: 'стас молодец' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), false);
});

test('тихие часы считаются через полночь', () => {
  const opts = { from: 23, to: 9, timeZone: 'Europe/Belgrade' };
  assert.strictEqual(inQuietHours(at('2026-09-04T23:30', opts.timeZone), opts), true);
  assert.strictEqual(inQuietHours(at('2026-09-04T03:00', opts.timeZone), opts), true);
  assert.strictEqual(inQuietHours(at('2026-09-04T12:00', opts.timeZone), opts), false);
});

test('спонтанная реплика ждёт пяти новых сообщений', () => {
  const d = decideSpontaneous({ ...BASE, freshCount: 3 });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /мало/);
});

test('спонтанная реплика молчит, пока хозяин говорит', () => {
  const d = decideSpontaneous({ ...BASE, ownerSpokeAt: BASE.now - 60 * 1000 });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /сам/);
});

test('исчерпанный суточный бюджет запрещает реплику', () => {
  const d = decideSpontaneous({ ...BASE, used: 4, budget: 4 });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /бюджет/);
});

test('полтора часа после прошлой реплики — молчим', () => {
  const d = decideSpontaneous({ ...BASE, lastAt: BASE.now - 30 * 60 * 1000 });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /пауза/);
});

test('все условия сошлись — говорим', () => {
  assert.strictEqual(decideSpontaneous(BASE).allow, true);
});

test('обращения подчиняются своему бюджету и паузе', () => {
  assert.strictEqual(decideAddressed({ ...ADDR, used: 10, budget: 10 }).allow, false);
  assert.strictEqual(decideAddressed({ ...ADDR, lastAt: ADDR.now - 60 * 1000 }).allow, false);
  assert.strictEqual(decideAddressed(ADDR).allow, true);
});

test('выключённые ответы запрещают оба контура', () => {
  assert.strictEqual(decideAddressed({ ...ADDR, enabled: false }).allow, false);
  assert.strictEqual(decideSpontaneous({ ...BASE, enabled: false }).allow, false);
});
```

- [ ] **Step 2: Запустить, убедиться, что падают** — `node --test src/reply-rules.test.js`.

- [ ] **Step 3: Реализация**

Порядок проверок в `decideSpontaneous`: `enabled` → тихие часы → бюджет → пауза → хозяин говорил → мало новых. Первая сработавшая даёт `why`. `decideAddressed`: `enabled` → тихие часы → бюджет → пауза.

- [ ] **Step 4: Тесты зелёные.**

- [ ] **Step 5: Коммит** — `git commit -m "Правила молчания для автоответов"`

---

### Task 3: Голос

**Files:**
- Create: `src/voice.js`, `src/voice.test.js`, `bin/export-voice.js`
- Modify: `.gitignore` (добавить `voice.json`)

**Interfaces:**
- Produces: `loadVoice(file)` → `{ samples: string[] }`, `pickSamples(messages, { limit, minWords, maxChars })` → `string[]`

- [ ] **Step 1: Тесты**

```js
test('в образцы не берём слишком короткие и слишком длинные', () => {
  const picked = pickSamples(
    [{ text: 'ок' }, { text: 'а если увидишь фотку, где мы держим шмеля' }, { text: 'x'.repeat(500) }],
    { limit: 10, minWords: 3, maxChars: 200 }
  );
  assert.deepStrictEqual(picked, ['а если увидишь фотку, где мы держим шмеля']);
});

test('образцов не больше лимита', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ text: `фраза номер ${i} для теста` }));
  assert.strictEqual(pickSamples(many, { limit: 60, minWords: 3, maxChars: 200 }).length, 60);
});

test('нет файла — пустой голос, а не падение', () => {
  assert.deepStrictEqual(loadVoice('/нет/такого/файла.json'), { samples: [] });
});
```

- [ ] **Step 2: Запустить, убедиться, что падают.**

- [ ] **Step 3: Реализация.** `pickSamples` берёт свежие сообщения, отбрасывает медиа-пустышки, ссылки и односложное, режет до `limit`. `bin/export-voice.js` — разовый скрипт: останавливать сервис, выгрузить `fromUser: 'me'` из чата, положить `voice.json` рядом с `.env`.

- [ ] **Step 4: Тесты зелёные.**

- [ ] **Step 5: Коммит** — `git commit -m "Образцы речи для автоответов"`

---

### Task 4: Разговор с моделью

**Files:**
- Create: `src/responder.js`, `src/responder.test.js`

**Interfaces:**
- Consumes: `config.replies`, `loadVoice`
- Produces: `createResponder({ model, createMessage, samples, maxChars, log })` → `{ compose({ window, trigger, mode }) }` → `{ reply: boolean, text: string, replyToId: number|null }`
- Produces: `systemPrompt({ samples, maxChars, mode })`

- [ ] **Step 1: Тесты**

```js
test('модель вправе промолчать, это не ошибка', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: false }), samples: [] });
  const out = await responder.compose({ window: [], trigger: null, mode: 'spontaneous' });
  assert.strictEqual(out.reply, false);
});

test('слишком длинный ответ обрезается по границе предложения', async () => {
  const long = 'первая фраза. вторая фраза, которая уже лишняя и слишком длинная';
  const responder = createResponder({ createMessage: async () => answer({ reply: true, text: long }), samples: [], maxChars: 20 });
  const out = await responder.compose({ window: [], trigger: { id: 7 }, mode: 'addressed' });
  assert.ok(out.text.length <= 20);
});

test('в ответе на обращение replyToId — это триггер', async () => {
  const responder = createResponder({ createMessage: async () => answer({ reply: true, text: 'ага' }), samples: [] });
  const out = await responder.compose({ window: [], trigger: { id: 7 }, mode: 'addressed' });
  assert.strictEqual(out.replyToId, 7);
});

test('невалидный JSON — молчим, а не шлём мусор', async () => {
  const responder = createResponder({ createMessage: async () => ({ content: [{ type: 'text', text: 'не json' }] }), samples: [] });
  assert.strictEqual((await responder.compose({ window: [], trigger: null, mode: 'spontaneous' })).reply, false);
});

test('промпт держит образцы речи и требует краткости', () => {
  const prompt = systemPrompt({ samples: ['прост', 'тор'], maxChars: 160, mode: 'spontaneous' });
  assert.match(prompt, /прост/);
  assert.match(prompt, /160/);
});
```

- [ ] **Step 2: Запустить, убедиться, что падают.**

- [ ] **Step 3: Реализация.** Схема `{ reply: boolean, text: string, replyToId: ['integer','null'] }`, вызов как в `summarizer.js` (`output_config.format.type = 'json_schema'`), `max_tokens: 400`. Промпт требует: одна-две фразы, строчные буквы, без вступлений и извинений, не объяснять шутку, эмодзи только такие, как в образцах, право промолчать; запрет — прямая похабщина про названных по имени людей. Ошибка сети пробрасывается наверх без повторов.

- [ ] **Step 4: Тесты зелёные.**

- [ ] **Step 5: Коммит** — `git commit -m "Ответчик: разговор с моделью"`

---

### Task 5: Оркестрация

**Files:**
- Create: `src/replier.js`, `src/replier.test.js`

**Interfaces:**
- Consumes: всё из задач 1–4
- Produces: `createReplier({ client, chat, chatKey, state, responder, notifier, meId, aliases, limits, timeZone, log, now, random })` → `{ onMessage(msg), flush(), tick(), pending() }`

- [ ] **Step 1: Тесты**

```js
test('обращение ставится в очередь с задержкой, а не шлётся сразу', async () => {
  const { replier, sent } = rig();
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(replier.pending(), 1);
});

test('если хозяин ответил сам, очередь отменяется', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  await replier.onMessage({ id: 12, from: 'me', replyTo: 11, text: 'нормально' });
  clock.advance(5 * 60 * 1000);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('через задержку ответ уходит реплаем на триггер', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  clock.advance(5 * 60 * 1000);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].replyTo, 11);
  assert.strictEqual(sent[0].parseMode, false);
});

test('на одно сообщение не отвечаем дважды', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  clock.advance(5 * 60 * 1000);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
});

test('копия отправленного уходит в бота с кнопкой выключения', async () => {
  const { replier, alerts, clock } = rig();
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  clock.advance(5 * 60 * 1000);
  await replier.flush();
  assert.match(alerts[0].text, /ответил/i);
  assert.ok(alerts[0].buttons);
});

test('выключённые ответы не отправляются даже из очереди', async () => {
  const { replier, sent, state, clock } = rig();
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  state.setRepliesEnabled(false);
  clock.advance(5 * 60 * 1000);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('ошибка модели гасится: молчим и не роняем сервис', async () => {
  const { replier, sent, clock } = rig({ responder: { compose: async () => { throw new Error('502'); } } });
  await replier.onMessage({ id: 11, from: 'other', replyTo: 10, text: 'ну как?' });
  clock.advance(5 * 60 * 1000);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('спонтанный контур шлёт реплику, когда все правила сошлись', async () => {
  const { replier, sent, clock } = rig();
  for (let i = 0; i < 6; i += 1) await replier.onMessage({ id: 20 + i, from: 'other', replyTo: null, text: `реплика ${i}` });
  clock.advance(20 * 60 * 1000);
  await replier.tick();
  assert.strictEqual(sent.length, 1);
});
```

- [ ] **Step 2: Запустить, убедиться, что падают.**

- [ ] **Step 3: Реализация.** `onMessage` держит окно последних `context` сообщений и очередь отложенных обращений `{ triggerId, dueAt }`; `flush()` вызывается быстрым таймером (30 с) и отправляет созревшее; `tick()` — медленный контур раз в 25 минут. Отправка: `client.sendMessage(chat, { message, replyTo, parseMode: false })`, затем `state.noteAnswered`, `state.noteReply`, копия в бота.

- [ ] **Step 4: Тесты зелёные.**

- [ ] **Step 5: Коммит** — `git commit -m "Оркестрация автоответов"`

---

### Task 6: Выключатель в боте

**Files:**
- Create: `src/bot-commands.js`, `src/bot-commands.test.js`
- Modify: `src/notify.js` (кнопки в `send`)

**Interfaces:**
- Produces: `createBotCommands({ token, chatId, request, state, onChange, log })` → `{ poll(), start(intervalMs) }`
- Produces: `notifier.send(text, { buttons })` — `buttons` превращается в `reply_markup.inline_keyboard`

- [ ] **Step 1: Тесты**

```js
test('«стоп» выключает ответы', async () => {
  const { bot, state } = rig([{ update_id: 1, message: { text: 'стоп', chat: { id: 7 } } }]);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), false);
});

test('/start включает обратно', async () => {
  const { bot, state } = rig([{ update_id: 2, message: { text: '/start', chat: { id: 7 } } }]);
  state.setRepliesEnabled(false);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), true);
});

test('кнопка под ответом выключает', async () => {
  const { bot, state } = rig([{ update_id: 3, callback_query: { data: 'replies:off', message: { chat: { id: 7 } } } }]);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), false);
});

test('чужой чат командовать не может', async () => {
  const { bot, state } = rig([{ update_id: 4, message: { text: 'стоп', chat: { id: 999 } } }]);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), true);
});

test('offset двигается, старые команды не переигрываются', async () => {
  const { bot, state, calls } = rig([{ update_id: 9, message: { text: 'статус', chat: { id: 7 } } }]);
  await bot.poll();
  assert.strictEqual(state.botOffset(), 10);
  assert.match(calls.at(-1).url, /sendMessage/);
});
```

- [ ] **Step 2: Запустить, убедиться, что падают.**

- [ ] **Step 3: Реализация.** `getUpdates` с `offset` и `timeout: 25`; принимаются только апдейты из `chatId`; на `статус` — ответ с состоянием и счётчиками за сутки; `answerCallbackQuery` после кнопки.

- [ ] **Step 4: Тесты зелёные.**

- [ ] **Step 5: Коммит** — `git commit -m "Выключатель автоответов в боте"`

---

### Task 7: Подключение к сервису

**Files:**
- Modify: `src/index.js`, `src/preflight.js`, `README.md`, `.env.example`, `ai-artifacts/ИНСТРУКЦИЯ.md`, `ai-artifacts/runbook.html`
- Test: `src/preflight.test.js`

- [ ] **Step 1: Тест преflight**

```js
test('без REPLY_CHAT сервис живёт дальше, просто без автоответов', () => {
  const setup = checkSetup({ session: 'x', channels: ['a'], keywordsCount: 1, newsConfigured: false, repliesConfigured: false });
  assert.strictEqual(setup.error, undefined);
  assert.strictEqual(setup.replies, false);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает.**

- [ ] **Step 3: Реализация.** В `index.js`: резолв чата, `client.addEventHandler` уже есть — добавить маршрут «сообщение из чата ответов → `replier.onMessage`», два таймера (30 с на `flush`, 25 мин на `tick`), запуск `bot-commands`. Ошибка контура ответов не должна ронять пересылку: каждый вызов в `try/catch` с записью в журнал.

- [ ] **Step 4: Все тесты зелёные** — `npm test`.

- [ ] **Step 5: Документация.** README: раздел «Автоответы», таблица потолков, как выключить, что уходит в Anthropic. Шпаргалка: команды бота и кнопка.

- [ ] **Step 6: Коммит** — `git commit -m "Автоответы подключены к сервису"`

---

### Task 8: Сверка на живых сутках без отправки

**Files:**
- Create: `src/replies-cli.js`
- Modify: `package.json` (скрипт `replies`)

- [ ] **Step 1: Реализация CLI.** `npm run replies -- --from-file chat-day.json` прогоняет оба контура по выгруженным суткам, ничего не отправляет, печатает: на что бы ответил, что бы сказал, где промолчал и почему.

- [ ] **Step 2: Прогон на `chat-day.json`** (438 сообщений, уже выгружены).

- [ ] **Step 3: Показать пользователю** список предполагаемых реплик до включения.

- [ ] **Step 4: Коммит** — `git commit -m "Сверка автоответов на выгрузке"`

---

## Самопроверка плана

- Каждый раздел спеки закрыт задачей: контуры — 5, правила — 2, голос — 3, промпт — 4, выключатель — 6, потолки — 1 и 2, проверка — 8.
- Плейсхолдеров нет: в каждой задаче тесты приведены кодом.
- Имена сквозные: `decideAddressed` / `decideSpontaneous` / `compose` / `poll` совпадают между задачами.
