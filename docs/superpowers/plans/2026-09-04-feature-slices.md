# Вертикальные слайсы поверх тонкой платформы: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** перестроить `tg-reader` из плоского `src/` в вертикальные слайсы фич поверх тонкой платформы, заменив `state.json` на SQLite, — девятью коммитами, ни один из которых не трогает работающий сервис.

**Architecture:** три яруса. `platform/*` — единственный, кто делает I/O и знает про библиотеки. `features/*` — три слайса (`forwarding`, `digest`, `replies`) плюс `health`, каждый со своей чистой логикой, работой и хранилищем. `runtime/*` — хост работ, сторожа и одна точка остановки. `bin/*` — точки входа: разобрать argv, загрузить конфиг, собрать, выполнить. Границы держит тест-надзиратель, а не договорённость.

**Tech Stack:** Node 22 (CommonJS), `node --test`, `node:sqlite` (`DatabaseSync`, WAL), `telegram` (gramjs), `@anthropic-ai/sdk`, `dotenv`. Новых зависимостей не добавляем.

**Spec:** `docs/superpowers/specs/2026-09-03-architecture-design.md` (коммиты `d05647f` + `922e783`)

## Global Constraints

- **Рабочий каталог — только worktree `/root/tg-reader-refactor`, ветка `refactor/feature-slices`.** В `/var/www/www-root/data/www/tg-reader` не пишем ничего: оттуда systemd поднимает живой сервис с `Restart=always`.
- **Сервис не останавливается и не перезапускается.** Перезапуск — действие владельца после приёмки, задача 9.
- **Одна MTProto-сессия за раз.** Ни `npm start`, ни `npm run scan`, ни `npm run login`, ни `npm run digest` (включая `--dry-run`), ни `npm run replies`, ни `npm run voice` не запускаются ни на одном шаге. Все они подключаются к Telegram и молча ослепляют работающий сервис.
- **Платные вызовы модели без отдельного согласия не делаем.** Это `digest --from-file` и `npm run replies`.
- **Комментариев в коде нет.** Ни `//`, ни `/* */`, ни JSDoc. Объяснения — в README и сообщениях коммитов, контракты — в контрактных тестах. Исключение — `keywords.js`: он и сегодня с комментариями, это файл пользователя.
- **Сообщения пользователю — по-русски**, в тоне существующих строк. Тексты тревог, логов и ошибок настройки переносятся дословно, если в задаче не сказано иное.
- **Тревоги только о проблемах.** Никаких «всё в норме» в бота.
- **Поведение автоответов не меняется.** Правила молчания, бюджеты, промпт и потолки переезжают дословно.
- **Файлы пользователя не трогаем:** `keywords.js` и `voice.json` остаются на своих путях и в своём формате.
- **Каждая задача — один коммит**, с хвостом:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
  ```

### Что считать зелёной веткой

В worktree нет `.env` — это намеренно. Базовый замер до работ:

| | результат |
|---|---|
| `npm test` в рабочем каталоге (есть `.env`) | 355 из 355 |
| `npm test` в worktree (нет `.env`) | 346 собрано, 345 прошло, 1 упал |

Единственный падающий — `src/preflight.test.js`: он умирает на импорте `src/config.js`, который зовёт `process.exit(1)` без `TG_API_ID`. Это дефект №1 из спецификации, а не поломка.

- **После задачи 1** допустим ровно тот же результат: 1 падение, `preflight.test.js`. Ни одного нового.
- **После задачи 2 и далее** — полностью зелено в worktree **без** `.env`. Это и есть критерий, ради которого задача 2 идёт второй.

### Проверенные факты платформы

Проверено на этом сервере, Node v22.23.2 — на это опираются задачи 1 и 4:

1. `node --test` без маски обходит подкаталоги (`src/features/a/y.test.js` находится) и пропускает `node_modules`. Нынешняя маска `src/*.test.js` подкаталоги **не** видит.
2. `node:sqlite` даёт `DatabaseSync` с `.exec()`, `.prepare().run/.get/.all()`, `PRAGMA user_version` читается и пишется, транзакции — через `exec('BEGIN')` / `exec('COMMIT')`.
3. `new DatabaseSync(file, { readOnly: true })` читает и отбивает запись: `attempt to write a readonly database`.
4. **Ловушка:** строки из `node:sqlite` — объекты с `null`-прототипом. `assert.deepStrictEqual(row, { k: 'a' })` **падает** на несовпадении прототипов. В тестах всегда сравнивать `{ ...row }`.

## Структура файлов

```
tools/
  boundaries.js            анализатор require и process.exit — вне src/, чтобы не сторожить сам себя
  boundaries.test.js       свои тесты + правила границ, включаемые по одному за задачу
bin/
  serve.js login.js scan.js digest.js replies.js voice.js healthcheck.js alert-setup.js
src/
  platform/
    telegram/  client.js gateway.js text.js contract.js fake.js
    llm/       anthropic.js fake.js
    notify/    telegram-bot.js fake.js
    db/        open.js migrations/index.js migrations/001-initial.js import-state-json.js
    config.js clock.js lock.js systemd.js env-file.js json-file.js
  features/
    forwarding/  matcher.js logic.js job.js store.js
    digest/      prompt.js logic.js render.js job.js store.js
    replies/     rules.js repetition.js logic.js prompt.js voice.js commands.js job.js store.js
    health/      rules.js status.js memory.js alert-text.js
  runtime/     host.js watchdog.js shutdown.js
  shared/      async.js cli-args.js
keywords.js    остаётся в корне
voice.json     остаётся рядом с .env
```

Пустые каталоги в git не живут — каждый появляется вместе с первым своим файлом. Отдельного шага «создать каркас» нет.

---

## Задача 1: надзиратель за границами и `npm test` без маски

Ставит две вещи, без которых остальные восемь задач нельзя честно проверить: анализатор зависимостей, включаемый по правилу за задачу, и поиск тестов, который не потеряет файлы при переезде в подкаталоги.

**Files:**
- Create: `tools/boundaries.js`
- Create: `tools/boundaries.test.js`
- Modify: `package.json` (поле `scripts.test`)

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `jsFilesUnder(dir) -> string[]` — пути `.js` относительно `dir`, с `/` как разделителем, отсортированные; каталог `node_modules` пропускается.
  - `requiresOf(source) -> string[]` — аргументы `require('...')` и `require("...")` строковыми литералами, в порядке появления.
  - `hasProcessExit(source) -> boolean`.
  - `tools/boundaries.test.js` — файл, куда задачи 3, 7, 8 и 9 дописывают правила.

- [ ] **Шаг 1: написать падающий тест анализатора**

Создать `tools/boundaries.test.js`:

```js
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
    "const dyn = require(name);",
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
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: FAIL, `Cannot find module './boundaries'`

- [ ] **Шаг 3: написать анализатор**

Создать `tools/boundaries.js`:

```js
const fs = require('fs');
const path = require('path');

const PROCESS_EXIT = /\bprocess\s*\.\s*exit\s*\(/;

function jsFilesUnder(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...jsFilesUnder(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.js')) found.push(rel);
  }
  return found;
}

function scan(source) {
  const strings = [];
  const masked = String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*?\1/g, (match) => {
      strings.push(match.slice(1, -1));
      return ` ${strings.length - 1} `;
    });
  return { masked, strings };
}

function requiresOf(source) {
  const { masked, strings } = scan(source);
  const found = [];
  for (const match of masked.matchAll(/require\(\s*(\d+)\s*\)/g)) found.push(strings[Number(match[1])]);
  return found;
}

function hasProcessExit(source) {
  return PROCESS_EXIT.test(scan(source).masked);
}

module.exports = { jsFilesUnder, requiresOf, hasProcessExit };
```

- [ ] **Шаг 4: прогнать тест анализатора**

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: PASS, 4 из 4

Порядок в `scan()` важен: сначала гасятся комментарии, потом строки заменяются на номера. Разбирать `require(...)` по сырому тексту нельзя — вызов внутри строкового литерала неотличим от настоящего. Проверено на живых файлах проекта: `index.js` даёт восемь зависимостей и `process.exit`, `keywords.js` — ни одной зависимости, хотя его комментарии полны кавычек, `matcher.js` — ни одной, хотя в нём регулярки со скобками и кавычками.

Известный предел: регулярное выражение с одиночной кавычкой внутри (`/don't/`) будет принято за начало строки. В проекте таких нет; надзиратель в худшем случае даст ложную тревогу, которую разберёт человек, а не пропустит нарушение.

- [ ] **Шаг 5: перевести `npm test` на поиск без маски**

В `package.json` заменить:

```json
"test": "node --test src/*.test.js"
```

на:

```json
"test": "node --test"
```

Маска `src/*.test.js` не видит подкаталоги. Начиная с задачи 3 тесты поедут в `src/platform/**` и `src/features/**`, и набор молча усох бы, не показав ни одной ошибки.

- [ ] **Шаг 6: прогнать весь набор и сверить с базовым замером**

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -8`
Expected: `# fail 1` — тот самый `src/preflight.test.js`. Общее число тестов вырастет на 4 (анализатор): было 346, стало 350.

Убедиться, что падение ровно одно и ровно то:

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | grep "^not ok"`
Expected: одна строка, `src/preflight.test.js`

- [ ] **Шаг 7: коммит**

```bash
cd /root/tg-reader-refactor
git add tools/boundaries.js tools/boundaries.test.js package.json
git commit -m "$(cat <<'EOF'
Надзиратель за границами и поиск тестов без маски

Анализатор require и process.exit лежит в tools/, а не в src/: иначе он
сторожил бы сам себя. Правила он пока не применяет — они включаются по
одному за задачу, чтобы каждый шаг переезда проверял себя сам, а не мою
внимательность.

npm test переведён с node --test src/*.test.js на node --test. Маска по
одному каталогу не видит подкаталоги, и набор усох бы молча ровно в тот
момент, когда файлы поедут в src/features и src/platform.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 2: `loadConfig(env)` вместо пяти мест валидации

Снимает дефект №1. После этой задачи ни один модуль не умирает на импорте, и весь набор зелёный в worktree без `.env`.

Сегодня «настроено ли оно» решается в пяти местах: `config.js` (падает), `preflight.js` (возвращает объект), `news.isConfigured()`, `digest-cli.js:26` и четыре подряд `return` в `index.js:200-219`. Всё это сходится в две чистые функции.

**Files:**
- Create: `src/platform/config.js`
- Create: `src/platform/config.test.js`
- Create: `src/platform/env.test.js`
- Modify: `src/config.js` (становится тонкой прослойкой)
- Modify: `src/preflight.js` (становится прослойкой над `serviceSetup`)
- Move: `src/preflight.test.js` → `src/platform/setup.test.js`, переписывается на `serviceSetup`
- Delete: `src/env.js`, `src/env.test.js`, `src/config.test.js`

**Interfaces:**
- Consumes: `tools/boundaries.js` (косвенно — набор должен остаться зелёным).
- Produces:
  - `loadConfig(env) -> { config, errors, warnings }`.
    `errors: string[]` — без этого не работает ни одна команда: нет `TG_API_ID`, нет `TG_API_HASH`, `TG_API_ID` не число.
    `warnings: string[]` — пока пустой, наполняется в задаче 9.
    `config` — та же форма, что у сегодняшнего глобала: `apiId, apiHash, session, channels, target, disabledGroups, alert{token,chatId}, anthropicKey, news{...}, replies{...}, health{...}`.
  - `serviceSetup({ session, channels, keywordsCount, anthropicKey, newsChannels, repliesChat, repliesEnabled }) -> { error, warning, features }`,
    где `features = { forwarding: { on, why }, digest: { on, why }, replies: { on, why } }`, `why` — строка или `null`.
  - `numFromEnv`, `hourOrOff`, `pauseMsFrom`, `listFromEnv` — переезжают из `src/env.js` без изменений.

- [ ] **Шаг 1: написать падающий тест `loadConfig`**

Создать `src/platform/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('./config');

const full = {
  TG_API_ID: '12345',
  TG_API_HASH: 'hash',
  TG_SESSION: 'сессия',
  CHANNEL: '@one, @two',
  NEWS_CHANNELS: '@news',
  ANTHROPIC_API_KEY: 'key',
};

test('пустое окружение даёт ошибки, а не смерть процесса', () => {
  const { errors } = loadConfig({});
  assert.match(errors.join('\n'), /TG_API_ID/);
  assert.match(errors.join('\n'), /TG_API_HASH/);
});

test('нечисловой TG_API_ID — отдельная ошибка', () => {
  const { errors } = loadConfig({ ...full, TG_API_ID: 'двенадцать' });
  assert.match(errors.join('\n'), /TG_API_ID должен быть числом/);
});

test('полное окружение читается без ошибок', () => {
  const { config, errors } = loadConfig(full);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.apiId, 12345);
  assert.deepStrictEqual(config.channels, ['@one', '@two']);
});

test('значения по умолчанию не зависят от .env на диске', () => {
  const { config } = loadConfig(full);
  assert.strictEqual(config.news.model, 'claude-haiku-4-5');
  assert.strictEqual(config.news.hour, 7);
  assert.strictEqual(config.news.timeZone, 'Europe/Belgrade');
  assert.strictEqual(config.replies.dailyBudget, 4);
  assert.strictEqual(config.replies.spontaneousPauseMs, 90 * 60 * 1000);
  assert.strictEqual(config.health.digestHour, null);
});

test('зона автоответов берётся из NEWS_TZ', () => {
  const { config } = loadConfig({ ...full, NEWS_TZ: 'Europe/Moscow' });
  assert.strictEqual(config.replies.timeZone, 'Europe/Moscow');
});

test('loadConfig не читает process.env', () => {
  process.env.TG_API_ID = '999';
  try {
    const { config } = loadConfig(full);
    assert.strictEqual(config.apiId, 12345);
  } finally {
    delete process.env.TG_API_ID;
  }
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `cd /root/tg-reader-refactor && node --test src/platform/config.test.js`
Expected: FAIL, `Cannot find module './config'`

- [ ] **Шаг 3: написать `src/platform/config.js`**

Помощники переносятся из `src/env.js` дословно, читатель окружения — из `src/config.js`, но параметром вместо глобала и без `process.exit`.

```js
function numFromEnv(raw, fallback) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim();
  if (text === '') return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function hourOrOff(raw) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim().toLowerCase();
  if (text === '' || text === 'off' || text === 'нет') return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 23) return null;
  return value;
}

function pauseMsFrom(rawSeconds, rawMinutes, fallbackMinutes) {
  const seconds = numFromEnv(rawSeconds, null);
  if (seconds !== null) return seconds * 1000;
  return numFromEnv(rawMinutes, fallbackMinutes) * 60 * 1000;
}

function listFromEnv(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(env, name, fallback = '') {
  const value = (env[name] || '').trim();
  return value || fallback;
}

function loadConfig(env = {}) {
  const errors = [];
  const warnings = [];

  for (const name of ['TG_API_ID', 'TG_API_HASH']) {
    if (!text(env, name)) errors.push(`Не задана переменная ${name} в .env — см. .env.example`);
  }

  const apiId = Number(text(env, 'TG_API_ID'));
  if (text(env, 'TG_API_ID') && !Number.isInteger(apiId)) errors.push('TG_API_ID должен быть числом');

  const timeZone = text(env, 'NEWS_TZ', 'Europe/Belgrade');

  const config = {
    apiId,
    apiHash: text(env, 'TG_API_HASH'),
    session: text(env, 'TG_SESSION'),
    channels: listFromEnv(env.CHANNEL),
    target: text(env, 'TARGET', 'me'),
    disabledGroups: listFromEnv(env.DISABLED_GROUPS),
    alert: {
      token: text(env, 'ALERT_BOT_TOKEN'),
      chatId: text(env, 'ALERT_CHAT_ID'),
    },
    anthropicKey: text(env, 'ANTHROPIC_API_KEY'),
    news: {
      channels: listFromEnv(env.NEWS_CHANNELS),
      target: text(env, 'NEWS_TARGET', text(env, 'TARGET', 'me')),
      model: text(env, 'NEWS_MODEL', 'claude-haiku-4-5'),
      hour: numFromEnv(env.NEWS_HOUR, 7),
      timeZone,
      maxMessages: numFromEnv(env.NEWS_MAX_MESSAGES, 400),
      maxItems: numFromEnv(env.NEWS_MAX_ITEMS, 35),
      links: text(env, 'NEWS_LINKS', 'off').toLowerCase() === 'on',
    },
    replies: {
      chat: text(env, 'REPLY_CHAT'),
      enabled: text(env, 'REPLY_ENABLED', 'on').toLowerCase() !== 'off',
      model: text(env, 'REPLY_MODEL', 'claude-opus-4-8'),
      aliases: listFromEnv(env.REPLY_ALIASES),
      dailyBudget: numFromEnv(env.REPLY_DAILY_BUDGET, 4),
      addressedBudget: numFromEnv(env.REPLY_ADDRESSED_BUDGET, 10),
      spontaneousPauseMs: pauseMsFrom(env.REPLY_SPONTANEOUS_PAUSE_SEC, env.REPLY_SPONTANEOUS_PAUSE_MIN, 90),
      addressedPauseMs: pauseMsFrom(env.REPLY_ADDRESSED_PAUSE_SEC, env.REPLY_ADDRESSED_PAUSE_MIN, 5),
      delayMinSec: numFromEnv(env.REPLY_DELAY_MIN_SEC, 120),
      delayMaxSec: numFromEnv(env.REPLY_DELAY_MAX_SEC, 240),
      quietFrom: numFromEnv(env.REPLY_QUIET_FROM, 23),
      quietTo: numFromEnv(env.REPLY_QUIET_TO, 9),
      context: numFromEnv(env.REPLY_CONTEXT, 60),
      minFresh: numFromEnv(env.REPLY_MIN_FRESH, 5),
      ownerSilenceMin: numFromEnv(env.REPLY_OWNER_SILENCE_MIN, 15),
      maxChars: numFromEnv(env.REPLY_MAX_CHARS, 160),
      staleAfterMin: numFromEnv(env.REPLY_STALE_AFTER_MIN, 10),
      ownerCancel: text(env, 'REPLY_OWNER_CANCEL', 'answer').toLowerCase() === 'any' ? 'any' : 'answer',
      timeZone,
    },
    health: {
      serviceName: text(env, 'SERVICE_NAME', 'tg-reader'),
      stallReconnectMin: numFromEnv(env.STALL_RECONNECT_MIN, 30),
      stallGiveUpMin: numFromEnv(env.STALL_GIVEUP_MIN, 45),
      repeatMin: numFromEnv(env.ALERT_REPEAT_MIN, 60),
      digestHour: hourOrOff(env.DIGEST_HOUR),
      flappingRestarts: numFromEnv(env.FLAPPING_RESTARTS, 3),
    },
  };

  return { config, errors, warnings };
}

module.exports = { loadConfig, numFromEnv, hourOrOff, pauseMsFrom, listFromEnv };
```

- [ ] **Шаг 4: прогнать тест `loadConfig`**

Run: `cd /root/tg-reader-refactor && node --test src/platform/config.test.js`
Expected: PASS, 6 из 6

- [ ] **Шаг 5: перенести тесты помощников**

`git mv src/env.test.js src/platform/env.test.js`, в первой строке заменить `require('./env')` на `require('./config')`, оба вхождения (строки 3 и 29).
`git mv src/config.test.js src/platform/env-pause.test.js`, заменить `require('./env')` на `require('./config')`.
Удалить `src/env.js`: `git rm src/env.js`.

Run: `cd /root/tg-reader-refactor && node --test src/platform/`
Expected: PASS, 6 + 8 + 5 = 19 тестов

Если что-то ещё требует `./env` — `grep -rn "require('./env')" src bin` должен молчать.

- [ ] **Шаг 6: написать падающий тест `serviceSetup`**

`git mv src/preflight.test.js src/platform/setup.test.js` и переписать целиком — те же десять случаев, но над чистой функцией и без импорта конфига. Файл едет в `platform/` сразу: `src/preflight.js` умрёт в задаче 9, и тест, оставшийся на старом месте, осиротел бы.

```js
const test = require('node:test');
const assert = require('node:assert');
const { serviceSetup } = require('./config');

const base = {
  session: 'сессия',
  channels: ['@ch'],
  keywordsCount: 5,
  anthropicKey: '',
  newsChannels: [],
  repliesChat: '',
  repliesEnabled: true,
};

test('всё настроено — работает пересылка', () => {
  const setup = serviceSetup(base);
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.warning, null);
  assert.strictEqual(setup.features.forwarding.on, true);
  assert.strictEqual(setup.features.digest.on, false);
  assert.strictEqual(setup.features.replies.on, false);
});

test('без сессии не работает ничего', () => {
  assert.match(serviceSetup({ ...base, session: '' }).error, /TG_SESSION/);
});

test('слов нет, сводки нет — это ошибка настройки', () => {
  assert.match(serviceSetup({ ...base, keywordsCount: 0 }).error, /ключевого слова/i);
});

test('слов нет, но сводка настроена — работаем без пересылки и предупреждаем', () => {
  const setup = serviceSetup({ ...base, keywordsCount: 0, anthropicKey: 'k', newsChannels: ['@n'] });
  assert.strictEqual(setup.error, null, 'рабочую сводку нельзя убивать из-за выключенных слов');
  assert.match(setup.warning, /ключев/i);
  assert.strictEqual(setup.features.forwarding.on, false);
  assert.strictEqual(setup.features.digest.on, true);
});

test('только сводка, CHANNEL пуст — молча и правильно', () => {
  const setup = serviceSetup({ ...base, channels: [], keywordsCount: 0, anthropicKey: 'k', newsChannels: ['@n'] });
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.warning, null, 'пустой CHANNEL — это не «слова выключены»');
  assert.strictEqual(setup.features.forwarding.on, false);
});

test('не настроено ничего — ошибка со всеми тремя именами переменных', () => {
  const { error } = serviceSetup({ ...base, channels: [], keywordsCount: 0 });
  assert.match(error, /CHANNEL/);
  assert.match(error, /NEWS_CHANNELS/);
  assert.match(error, /REPLY_CHAT/);
});

test('автоответы сами по себе — уже повод запуститься', () => {
  const setup = serviceSetup({ ...base, channels: [], keywordsCount: 0, anthropicKey: 'k', repliesChat: '@chat' });
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.features.replies.on, true);
});

test('пустые ключевые слова не мешают автоответам', () => {
  const setup = serviceSetup({ ...base, keywordsCount: 0, anthropicKey: 'k', repliesChat: '@chat' });
  assert.strictEqual(setup.error, null);
  assert.match(setup.warning, /автоответы/i);
});

test('REPLY_ENABLED=off глушит ответы даже при заданном чате', () => {
  const setup = serviceSetup({ ...base, anthropicKey: 'k', repliesChat: '@chat', repliesEnabled: false });
  assert.strictEqual(setup.features.replies.on, false);
  assert.match(setup.features.replies.why, /REPLY_ENABLED/);
});

test('у каждой выключенной фичи есть причина, а у включённой её нет', () => {
  const setup = serviceSetup(base);
  assert.strictEqual(setup.features.forwarding.why, null);
  assert.match(setup.features.digest.why, /ANTHROPIC_API_KEY/);
  assert.match(setup.features.replies.why, /REPLY_CHAT/);
});

test('сводка без ключа модели выключена по причине ключа, а не каналов', () => {
  const setup = serviceSetup({ ...base, newsChannels: ['@n'] });
  assert.match(setup.features.digest.why, /ANTHROPIC_API_KEY/);
});

test('автоответы без ключа модели выключены по причине ключа', () => {
  const setup = serviceSetup({ ...base, repliesChat: '@chat' });
  assert.match(setup.features.replies.why, /ANTHROPIC_API_KEY/);
});
```

- [ ] **Шаг 7: убедиться, что тест падает**

Run: `cd /root/tg-reader-refactor && node --test src/platform/setup.test.js`
Expected: FAIL, `serviceSetup is not a function`

- [ ] **Шаг 8: реализовать `serviceSetup`**

Дописать в `src/platform/config.js` перед `module.exports`:

```js
function serviceSetup({
  session = '',
  channels = [],
  keywordsCount = 0,
  anthropicKey = '',
  newsChannels = [],
  repliesChat = '',
  repliesEnabled = true,
}) {
  const digestWhy = !anthropicKey
    ? 'не задан ANTHROPIC_API_KEY'
    : newsChannels.length === 0
      ? 'не задан NEWS_CHANNELS'
      : null;
  const repliesWhy = !repliesChat
    ? 'не задан REPLY_CHAT'
    : !anthropicKey
      ? 'не задан ANTHROPIC_API_KEY'
      : !repliesEnabled
        ? 'REPLY_ENABLED=off'
        : null;

  const features = {
    forwarding: { on: channels.length > 0, why: channels.length > 0 ? null : 'не задан CHANNEL' },
    digest: { on: digestWhy === null, why: digestWhy },
    replies: { on: repliesWhy === null, why: repliesWhy },
  };
  const answer = { error: null, warning: null, features };

  if (!session) {
    answer.error = 'Нет TG_SESSION. Сначала выполните: npm run login';
    return answer;
  }

  if (features.forwarding.on && keywordsCount === 0) {
    features.forwarding = { on: false, why: 'ни одного включённого ключевого слова' };
    const trouble = 'Ни одного включённого ключевого слова: keywords.js пуст или все группы в DISABLED_GROUPS';
    const alive = [features.digest.on && 'сводка новостей', features.replies.on && 'автоответы'].filter(Boolean);
    if (alive.length) answer.warning = `${trouble}. Пересылку объявлений пропускаю, ${alive.join(' и ')} работают`;
    else answer.error = trouble;
    return answer;
  }

  if (!features.forwarding.on && !features.digest.on && !features.replies.on) {
    answer.error =
      'Нечего делать: не задан ни CHANNEL для объявлений, ни NEWS_CHANNELS для сводки, ни REPLY_CHAT для ответов — см. .env.example';
  }
  return answer;
}
```

И заменить строку экспорта на:

```js
module.exports = { loadConfig, serviceSetup, numFromEnv, hourOrOff, pauseMsFrom, listFromEnv };
```

- [ ] **Шаг 9: прогнать тест `serviceSetup`**

Run: `cd /root/tg-reader-refactor && node --test src/platform/setup.test.js`
Expected: PASS, 12 из 12 — и, в отличие от вчерашнего дня, **без `.env` на диске**

- [ ] **Шаг 10: превратить `src/config.js` и `src/preflight.js` в прослойки**

`src/config.js` целиком:

```js
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadConfig } = require('./platform/config');

const { config, errors } = loadConfig(process.env);

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

module.exports = { config };
```

Экспорт `required` убран: `grep -rn "require.*config').*required" src bin` показывает, что снаружи им никто не пользуется.

`src/preflight.js` целиком:

```js
const { config } = require('./config');
const { serviceSetup } = require('./platform/config');

function readSetup(keywordsCount) {
  return serviceSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount,
    anthropicKey: config.anthropicKey,
    newsChannels: config.news.channels,
    repliesChat: config.replies.chat,
    repliesEnabled: config.replies.enabled,
  });
}

module.exports = { readSetup };
```

Возвращается объект `serviceSetup` как есть: `{ error, warning, features }`. Прослойка временная — в задаче 9 `src/preflight.js` и `src/config.js` удаляются, а `bin/*` зовут `loadConfig` и `serviceSetup` напрямую. Сейчас она нужна, чтобы `index.js` и `scan.js` не переписывались раньше времени.

- [ ] **Шаг 11: поправить два вызова `readSetup`**

`readSetup` теперь принимает один аргумент и отдаёт `features` вместо плоских полей.

В `src/index.js:314` заменить:

```js
  const setup = readSetup(KEYWORDS.length, news.isConfigured(), Boolean(config.replies.chat));
```

на:

```js
  const setup = readSetup(KEYWORDS.length);
```

Там же, в `main()`, заменить два обращения к `setup.forwarding`:

```js
  state.setForwarding(setup.forwarding);
```
```js
  if (setup.forwarding) {
```

на:

```js
  state.setForwarding(setup.features.forwarding.on);
```
```js
  if (setup.features.forwarding.on) {
```

В `src/scan.js:21` заменить:

```js
  const setup = readSetup(KEYWORDS.length, false);
  if (setup.error) {
    console.error(setup.error);
    process.exit(1);
  }
```

на:

```js
  const setup = readSetup(KEYWORDS.length);
  if (setup.error) {
    console.error(setup.error);
    process.exit(1);
  }
  if (!setup.features.forwarding.on) {
    console.error(`Сканировать нечего: ${setup.features.forwarding.why}`);
    process.exit(1);
  }
```

Второй аргумент `false` сегодня врал `serviceSetup`, будто сводка не настроена, — только чтобы получить ошибку «Нечего делать» при пустом `CHANNEL`. Без этой лжи `scan` без каналов молча ничего бы не вывел и вышел с нулём. Явная проверка `forwarding.on` заменяет ложь и заодно называет причину.

Run: `cd /root/tg-reader-refactor && grep -rn "readSetup(\|setup\.forwarding\|setup\.news\|setup\.replies" src bin`
Expected: объявление в `preflight.js`, по одному вызову с одним аргументом в `index.js` и `scan.js`, и ни одного обращения к плоским `setup.forwarding` / `setup.news` / `setup.replies`.

- [ ] **Шаг 12: прогнать весь набор без `.env` — главный критерий задачи**

Run: `cd /root/tg-reader-refactor && ls -la .env 2>&1 | head -1 && npm test 2>&1 | tail -8`
Expected: `.env` отсутствует; `# fail 0`. Тестов около 357.

Если хоть один падает на импорте — искать оставшийся `process.exit` или `require('./config')` в дереве, которое тянет тест.

- [ ] **Шаг 13: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src tools package.json
git commit -m "$(cat <<'EOF'
Конфигурация — функция от окружения, а не глобал с process.exit

loadConfig(env) читает переданное окружение и возвращает ошибки списком.
serviceSetup собирает в одном месте всё, что раньше решалось в пяти:
config.js, preflight.js, news.isConfigured, digest-cli и четыре подряд
return в startReplies. У каждой выключенной фичи теперь есть причина.

Проверяется это одним измерением: набор стал зелёным в worktree, где нет
.env. До сегодняшнего дня preflight.test.js умирал на импорте config.js,
и десять тестов внутри него не было видно вовсе — зелёная сборка была
зелена благодаря файлу окружения, случайно лежавшему рядом.

src/config.js и src/preflight.js остались тонкими прослойками, чтобы
index.js и scan.js не менялись раньше задачи 9.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 3: `platform/telegram` — весь gramjs за одним контрактом

Снимает дефект №5. После задачи `require('telegram')` встречается ровно в двух файлах, доменные объекты `Chat` и `Post` не имеют ничего общего с gramjs, а склейка альбомов уезжает из домена в адаптер.

Сегодня gramjs размазан по девяти модулям: `client.getMessages` зовут `forwarder`, `digest`, `scan`, `news`, `index`, `export-voice`; `event.message` перекладывают в доменный объект трижды — в `forwarder.js:98`, `index.js:186` и `index.js:269`; ссылку строят дважды (`format.js:11`, `digest.js:5`); лимит 4096 объявлен дважды (`format.js:1`, `notify.js:3`).

**Files:**
- Create: `src/platform/clock.js`
- Create: `src/platform/clock.test.js`
- Create: `src/platform/telegram/text.js`
- Create: `src/platform/telegram/text.test.js`
- Create: `src/platform/telegram/client.js`
- Create: `src/platform/telegram/gateway.js`
- Create: `src/platform/telegram/contract.js`
- Create: `src/platform/telegram/fake.js`
- Create: `src/platform/telegram/gateway.test.js`
- Create: `src/platform/telegram/fake.test.js`
- Modify: `tools/boundaries.test.js` (включается правило 6)
- Modify: `src/format.js` → прослойка над `platform/telegram/text.js`
- Delete: `src/client.js`, `src/peer.js` (переезжают внутрь адаптера)

**Interfaces:**
- Consumes: `loadConfig` из задачи 2 (`config.apiId`, `config.apiHash`, `config.session`).
- Produces:
  - `platform/clock.js`: `createClock() -> { now(), after(ms, fn) -> cancel, every(ms, fn) -> cancel, cancelAll() }`; `createManualClock(startAt) -> clock + { advance(ms), pending() }`; и перенесённые из `src/schedule.js` `isDue`, `dueMomentOf`, `localDayOf`.
  - `platform/telegram/text.js`: `TELEGRAM_LIMIT = 4096`, `cut(text, limit)`, `messageLink(chat, messageId)`.
  - `platform/telegram/client.js`: `createTelegramClient({ apiId, apiHash, session }) -> TelegramClient`.
  - `platform/telegram/gateway.js`: `createGateway({ client, clock, log, albumWindowMs })` — контракт ниже.
  - `platform/telegram/fake.js`: `createFakeGateway({ chats, posts, clock })` — та же форма, для тестов фич задач 5-7.
  - `platform/telegram/contract.js`: `gatewayContract(makeGateway) -> Array<{ name, run }>` — один набор проверок, который прогоняют оба.

**Контракт шлюза:**

```
connect()                          -> void
disconnect()                       -> void
connected                          -> boolean
authorized()                       -> boolean
me()                               -> { id, name, username }
resolveChat(ref)                   -> Chat
members(chat)                      -> Map<string, string>
recent(chat, {limit, afterId, fromMe}) -> Post[]     по возрастанию id
forward(targetRef, chat, ids)      -> void
sendText(ref, text, {replyTo})     -> Post
onPost(handler)                    -> отписка        handler получает Post[]

Chat { key, title, username, id }
Post { id, chatKey, at, text, from, author, replyTo, groupId, link }
```

`at` — миллисекунды эпохи. `from` — строковый id отправителя или `null`. `author` — имя из `members`, если оно известно шлюзу, иначе `null`. `replyTo`, `groupId` — `null`, если их нет. Поля `from`, `author`, `replyTo` нужны автоответам: сегодня их выковыривает из `event.message` сам `index.js`.

- [ ] **Шаг 1: написать тест часов**

Создать `src/platform/clock.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createManualClock, isDue, localDayOf } = require('./clock');

test('ручные часы не двигаются сами', () => {
  const clock = createManualClock(1000);
  assert.strictEqual(clock.now(), 1000);
});

test('after срабатывает ровно один раз и в свой момент', () => {
  const clock = createManualClock(0);
  const fired = [];
  clock.after(100, () => fired.push(clock.now()));
  clock.advance(99);
  assert.deepStrictEqual(fired, []);
  clock.advance(1);
  assert.deepStrictEqual(fired, [100]);
  clock.advance(1000);
  assert.deepStrictEqual(fired, [100]);
});

test('отменённый after не срабатывает', () => {
  const clock = createManualClock(0);
  let fired = false;
  const cancel = clock.after(10, () => { fired = true; });
  cancel();
  clock.advance(100);
  assert.strictEqual(fired, false);
});

test('every повторяется, пока его не отменят', () => {
  const clock = createManualClock(0);
  let ticks = 0;
  const cancel = clock.every(10, () => { ticks += 1; });
  clock.advance(35);
  assert.strictEqual(ticks, 3);
  cancel();
  clock.advance(100);
  assert.strictEqual(ticks, 3);
});

test('cancelAll снимает всё разом', () => {
  const clock = createManualClock(0);
  let ticks = 0;
  clock.every(10, () => { ticks += 1; });
  clock.after(15, () => { ticks += 1; });
  clock.cancelAll();
  clock.advance(100);
  assert.strictEqual(ticks, 0);
});

test('помощники времени переехали без изменений', () => {
  assert.strictEqual(localDayOf(Date.UTC(2026, 8, 4, 12), 'Europe/Belgrade'), '2026-9-4');
  assert.strictEqual(isDue(Date.UTC(2026, 8, 4, 12), { hour: 7, timeZone: 'UTC', lastRunAt: null }), true);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `cd /root/tg-reader-refactor && node --test src/platform/clock.test.js`
Expected: FAIL, `Cannot find module './clock'`

- [ ] **Шаг 3: написать `src/platform/clock.js`**

`git mv src/schedule.js src/platform/clock.js`, затем дописать часы поверх перенесённого содержимого и заменить строку экспорта.

Дописать перед `module.exports`:

```js
function createClock() {
  const live = new Set();
  const drop = (handle) => { live.delete(handle); };
  return {
    now: () => Date.now(),
    after(ms, fn) {
      const handle = setTimeout(() => { drop(handle); fn(); }, ms);
      if (handle.unref) handle.unref();
      live.add(handle);
      return () => { clearTimeout(handle); drop(handle); };
    },
    every(ms, fn) {
      const handle = setInterval(fn, ms);
      if (handle.unref) handle.unref();
      live.add(handle);
      return () => { clearInterval(handle); drop(handle); };
    },
    cancelAll() {
      for (const handle of live) { clearTimeout(handle); clearInterval(handle); }
      live.clear();
    },
  };
}

function createManualClock(startAt = 0) {
  let current = startAt;
  let seq = 0;
  const jobs = new Map();
  const clock = {
    now: () => current,
    after(ms, fn) {
      const id = (seq += 1);
      jobs.set(id, { at: current + ms, every: null, fn });
      return () => jobs.delete(id);
    },
    every(ms, fn) {
      const id = (seq += 1);
      jobs.set(id, { at: current + ms, every: ms, fn });
      return () => jobs.delete(id);
    },
    cancelAll() { jobs.clear(); },
    pending: () => jobs.size,
    advance(ms) {
      const until = current + ms;
      for (;;) {
        let next = null;
        for (const [id, job] of jobs) {
          if (job.at <= until && (next === null || job.at < jobs.get(next).at)) next = id;
        }
        if (next === null) break;
        const job = jobs.get(next);
        current = job.at;
        if (job.every === null) jobs.delete(next);
        else job.at = current + job.every;
        job.fn();
      }
      current = until;
    },
  };
  return clock;
}
```

Заменить экспорт на:

```js
module.exports = { createClock, createManualClock, isDue, dueMomentOf, localDayOf };
```

Поправить импорт в `src/news.js:6` и `src/replier.js:3`, `src/bot-commands.js:2`: `require('./schedule')` → `require('./platform/clock')`. Перенести и тест: `git mv src/schedule.test.js src/platform/schedule.test.js`, внутри `require('./schedule')` → `require('./clock')`.

- [ ] **Шаг 4: прогнать тесты часов и расписания**

Run: `cd /root/tg-reader-refactor && node --test src/platform/ && npm test 2>&1 | tail -6`
Expected: часы 6 из 6, весь набор `# fail 0`

- [ ] **Шаг 5: свести тексты Telegram в один модуль**

Создать `src/platform/telegram/text.js` — содержимое `src/format.js` без изменений (`TELEGRAM_LIMIT`, `cut`, `messageLink`).

Создать `src/platform/telegram/text.test.js` — перенести содержимое `src/format.test.js`, заменив путь импорта. Дописать тест, фиксирующий схлопывание дубля:

```js
const test = require('node:test');
const assert = require('node:assert');
const { messageLink, TELEGRAM_LIMIT } = require('./text');

test('ссылка на публичный канал строится по username', () => {
  assert.strictEqual(messageLink({ username: 'chan' }, 42), 'https://t.me/chan/42');
});

test('ссылка на приватный канал строится по id', () => {
  assert.strictEqual(messageLink({ id: 777 }, 42), 'https://t.me/c/777/42');
});

test('без username и id ссылки нет', () => {
  assert.strictEqual(messageLink({}, 42), '');
});

test('лимит Telegram объявлен здесь и больше нигде', () => {
  assert.strictEqual(TELEGRAM_LIMIT, 4096);
});
```

Заменить `src/format.js` целиком на прослойку (умрёт в задаче 5):

```js
module.exports = require('./platform/telegram/text');
```

В `src/notify.js:3` убрать собственное объявление `const TELEGRAM_LIMIT = 4096;` и заменить на `const { TELEGRAM_LIMIT } = require('./platform/telegram/text');`.

В `src/digest.js` удалить функцию `linkTo` (строки 5-9) и заменить её вызов в `toItems` на `messageLink(source, msg.id) || undefined`, добавив вверху `const { messageLink } = require('./platform/telegram/text');`.

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`. Тесты `digest.test.js`, проверяющие ссылки, обязаны пройти без правок — обе реализации совпадали посимвольно.

- [ ] **Шаг 6: написать контракт шлюза**

Создать `src/platform/telegram/contract.js`. Это и есть спецификация адаптера: один набор проверок, который обязаны пройти и настоящий шлюз, и фейк.

```js
const assert = require('node:assert');

function gatewayContract(make) {
  return [
    {
      name: 'resolveChat отдаёт доменный Chat без объектов библиотеки',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        assert.deepStrictEqual(Object.keys(chat).sort(), ['id', 'key', 'title', 'username']);
        assert.strictEqual(typeof chat.key, 'string');
      },
    },
    {
      name: 'recent отдаёт Post по возрастанию id',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const posts = await gateway.recent(chat, { limit: 10 });
        assert.ok(posts.length >= 2);
        const ids = posts.map((post) => post.id);
        assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b));
      },
    },
    {
      name: 'Post несёт ровно оговорённые поля',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const [post] = await gateway.recent(chat, { limit: 1 });
        assert.deepStrictEqual(
          Object.keys(post).sort(),
          ['at', 'author', 'chatKey', 'from', 'groupId', 'id', 'link', 'replyTo', 'text']
        );
        assert.strictEqual(typeof post.at, 'number');
        assert.strictEqual(post.chatKey, chat.key);
      },
    },
    {
      name: 'afterId отсекает уже виденное',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const all = await gateway.recent(chat, { limit: 10 });
        const after = await gateway.recent(chat, { limit: 10, afterId: all[0].id });
        assert.ok(after.every((post) => post.id > all[0].id));
      },
    },
    {
      name: 'альбом приходит в onPost одной пачкой, а одиночка — своей',
      async run() {
        const { gateway, emit, clock } = await make();
        const batches = [];
        gateway.onPost((posts) => batches.push(posts));
        emit({ chatRef: '@one', id: 101, text: 'раз', groupId: 'g1' });
        emit({ chatRef: '@one', id: 102, text: 'два', groupId: 'g1' });
        emit({ chatRef: '@one', id: 103, text: 'сам по себе' });
        clock.advance(1000);
        assert.strictEqual(batches.length, 2);
        const album = batches.find((batch) => batch.length === 2);
        assert.deepStrictEqual(album.map((post) => post.id), [101, 102]);
        assert.strictEqual(batches.find((batch) => batch.length === 1)[0].id, 103);
      },
    },
    {
      name: 'отписка перестаёт доставлять',
      async run() {
        const { gateway, emit, clock } = await make();
        const seen = [];
        const off = gateway.onPost((posts) => seen.push(...posts));
        off();
        emit({ chatRef: '@one', id: 200, text: 'молчок' });
        clock.advance(1000);
        assert.deepStrictEqual(seen, []);
      },
    },
    {
      name: 'sendText возвращает отправленное как Post',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const post = await gateway.sendText(chat, 'привет', { replyTo: 7 });
        assert.strictEqual(post.text, 'привет');
        assert.strictEqual(post.replyTo, 7);
        assert.strictEqual(typeof post.id, 'number');
      },
    },
    {
      name: 'sendText режет текст по лимиту Telegram',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const post = await gateway.sendText(chat, 'я'.repeat(5000));
        assert.ok(post.text.length <= 4096);
      },
    },
    {
      name: 'me отдаёт доменного пользователя',
      async run() {
        const { gateway } = await make();
        const me = await gateway.me();
        assert.deepStrictEqual(Object.keys(me).sort(), ['id', 'name', 'username']);
        assert.strictEqual(typeof me.id, 'string');
      },
    },
    {
      name: 'members отдаёт карту id → имя',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const names = await gateway.members(chat);
        assert.ok(names instanceof Map);
      },
    },
    {
      name: 'недоступные участники не роняют шлюз',
      async run() {
        const { gateway } = await make({ membersFail: true });
        const chat = await gateway.resolveChat('@one');
        const names = await gateway.members(chat);
        assert.strictEqual(names.size, 0);
      },
    },
  ];
}

module.exports = { gatewayContract };
```

- [ ] **Шаг 7: убедиться, что контракт не на чем прогнать**

Создать `src/platform/telegram/gateway.test.js`:

```js
const test = require('node:test');
const { gatewayContract } = require('./contract');
const { createGateway } = require('./gateway');
const { createManualClock } = require('../clock');
const { createFakeClient } = require('./fake-client');

async function make({ membersFail = false } = {}) {
  const clock = createManualClock(0);
  const client = createFakeClient({ membersFail });
  const gateway = createGateway({ client, clock, log: () => {}, albumWindowMs: 800 });
  return { gateway, clock, emit: client.emit };
}

for (const check of gatewayContract(make)) test(`шлюз: ${check.name}`, check.run);
```

Run: `cd /root/tg-reader-refactor && node --test src/platform/telegram/gateway.test.js`
Expected: FAIL, `Cannot find module './gateway'`

- [ ] **Шаг 8: написать поддельного gramjs-клиента для теста адаптера**

`fake-client.js` подделывает **библиотеку**, а не шлюз: он нужен, чтобы проверить сам адаптер. Не путать с `fake.js` из шага 11, который подделывает шлюз для тестов фич.

Создать `src/platform/telegram/fake-client.js`:

```js
function createFakeClient({ membersFail = false } = {}) {
  const handlers = [];
  const entities = new Map([
    ['@one', { id: 111, title: 'Первый', username: 'one' }],
    ['me', { id: 999, title: 'Избранное', username: null }],
  ]);
  const messages = new Map([
    [
      '111',
      [
        { id: 1, date: 1700000000, message: 'первое', senderId: 5, replyTo: null, groupedId: null },
        { id: 2, date: 1700000060, message: 'второе', senderId: 6, replyTo: { replyToMsgId: 1 }, groupedId: null },
      ],
    ],
  ]);
  let nextId = 500;

  return {
    connected: false,
    sent: [],
    forwarded: [],
    async connect() { this.connected = true; },
    async disconnect() { this.connected = false; },
    async isUserAuthorized() { return true; },
    async getMe() { return { id: 999, firstName: 'Хозяин', username: 'owner' }; },
    async getEntity(ref) {
      const found = entities.get(ref);
      if (!found) throw new Error(`нет такого чата: ${ref}`);
      return found;
    },
    async getParticipants() {
      if (membersFail) throw new Error('нет прав читать участников');
      return [{ id: 5, firstName: 'Аня', username: 'anya' }, { id: 6, firstName: null, username: 'boris' }];
    },
    async getMessages(chat, { limit = 10, minId } = {}) {
      const all = messages.get(String(chat.id)) || [];
      const picked = minId === undefined ? all : all.filter((msg) => msg.id > minId);
      return picked.slice(-limit).reverse();
    },
    async sendMessage(chat, { message, replyTo }) {
      nextId += 1;
      const posted = {
        id: nextId,
        date: Math.floor(Date.now() / 1000),
        message,
        senderId: 999,
        replyTo: replyTo ? { replyToMsgId: replyTo } : null,
        groupedId: null,
      };
      this.sent.push({ chat, message, replyTo });
      return posted;
    },
    async forwardMessages(target, { messages: ids, fromPeer }) {
      this.forwarded.push({ target, ids, fromPeer });
    },
    addEventHandler(handler) { handlers.push(handler); },
    removeEventHandler(handler) {
      const at = handlers.indexOf(handler);
      if (at >= 0) handlers.splice(at, 1);
    },
    emit({ chatRef = '@one', id, text = '', groupId = null, from = 5, replyTo = null }) {
      const chat = entities.get(chatRef);
      const message = {
        id,
        date: Math.floor(Date.now() / 1000),
        message: text,
        senderId: from,
        replyTo: replyTo ? { replyToMsgId: replyTo } : null,
        groupedId: groupId,
        peerId: chat,
      };
      for (const handler of [...handlers]) handler({ message, chatId: chat.id });
    },
  };
}

module.exports = { createFakeClient };
```

Обратить внимание: `getMessages` у gramjs отдаёт сообщения **от новых к старым**, поэтому фейк делает `.reverse()`. Именно это разворачивание сегодня руками повторяют `forwarder.js:125` и `index.js:271` — шлюз обязан отдавать по возрастанию, чтобы этого больше нигде не было.

- [ ] **Шаг 9: написать шлюз**

Создать `src/platform/telegram/gateway.js`:

```js
const { utils } = require('telegram');
const { NewMessage } = require('telegram/events');
const { EditedMessage } = require('telegram/events/EditedMessage');
const { cut, messageLink, TELEGRAM_LIMIT } = require('./text');

const ALBUM_WINDOW_MS = 800;

function keyOf(peer) {
  if (peer === null || peer === undefined) return null;
  try {
    return utils.getPeerId(peer).toString();
  } catch (err) {
    return null;
  }
}

function chatOf(entity) {
  return {
    key: keyOf(entity),
    title: entity.title || entity.firstName || null,
    username: entity.username || null,
    id: entity.id === undefined ? null : Number(entity.id),
  };
}

function createGateway({ client, clock, log = () => {}, albumWindowMs = ALBUM_WINDOW_MS }) {
  const byRef = new Map();
  const byKey = new Map();
  const names = new Map();
  const handlers = new Set();
  const albums = new Map();

  function postOf(message, chat) {
    const from = message.senderId === null || message.senderId === undefined ? null : String(message.senderId);
    return {
      id: message.id,
      chatKey: chat.key,
      at: message.date * 1000,
      text: message.message || '',
      from,
      author: (from && names.get(from)) || null,
      replyTo: message.replyTo ? message.replyTo.replyToMsgId : null,
      groupId: message.groupedId === null || message.groupedId === undefined ? null : String(message.groupedId),
      link: messageLink(chat, message.id),
    };
  }

  function deliver(posts) {
    for (const handler of [...handlers]) {
      try {
        handler(posts);
      } catch (err) {
        log(`Обработчик сообщения споткнулся: ${err.message}`);
      }
    }
  }

  function queue(post) {
    const key = `${post.chatKey}:g${post.groupId}`;
    let entry = albums.get(key);
    if (!entry) {
      entry = { posts: [], cancel: null };
      albums.set(key, entry);
    }
    entry.posts.push(post);
    if (entry.cancel) entry.cancel();
    entry.cancel = clock.after(albumWindowMs, () => {
      albums.delete(key);
      deliver(entry.posts.sort((a, b) => a.id - b.id));
    });
  }

  function onEvent(event) {
    const message = event.message;
    if (!message) return;
    const chat = byKey.get(keyOf(event.chatId !== undefined ? event.chatId : message.peerId));
    if (!chat) return;
    const post = postOf(message, chat);
    if (post.groupId) queue(post);
    else deliver([post]);
  }

  async function resolveChat(ref) {
    if (ref && typeof ref === 'object' && ref.key) return ref;
    if (byRef.has(ref)) return byRef.get(ref);
    const chat = chatOf(await client.getEntity(ref));
    byRef.set(ref, chat);
    byKey.set(chat.key, chat);
    return chat;
  }

  return {
    get connected() {
      return Boolean(client.connected);
    },
    async connect() {
      await client.connect();
    },
    async disconnect() {
      await client.disconnect();
    },
    async authorized() {
      return Boolean(await client.isUserAuthorized());
    },
    async me() {
      const raw = await client.getMe();
      return { id: String(raw.id), name: raw.firstName || raw.username || String(raw.id), username: raw.username || null };
    },
    resolveChat,
    async members(chat) {
      const found = new Map();
      try {
        for (const person of await client.getParticipants(await resolveChat(chat))) {
          const id = String(person.id);
          const name = person.firstName || person.username || id;
          found.set(id, name);
          names.set(id, name);
        }
      } catch (err) {
        log(`Имена участников чата не прочитались (${err.message}) — обойдусь без них`);
      }
      return found;
    },
    async recent(chat, { limit = 50, afterId, fromMe = false } = {}) {
      const resolved = await resolveChat(chat);
      const fetched = await client.getMessages(resolved, {
        limit,
        ...(afterId === undefined || afterId === null ? {} : { minId: afterId }),
        ...(fromMe ? { fromUser: 'me' } : {}),
      });
      return [...fetched].map((message) => postOf(message, resolved)).sort((a, b) => a.id - b.id);
    },
    async forward(targetRef, chat, ids) {
      const from = await resolveChat(chat);
      await client.forwardMessages(targetRef, { messages: [...ids].sort((a, b) => a - b), fromPeer: from });
    },
    async sendText(ref, text, { replyTo } = {}) {
      const chat = await resolveChat(ref);
      const posted = await client.sendMessage(chat, {
        message: cut(text, TELEGRAM_LIMIT),
        ...(replyTo ? { replyTo } : {}),
        parseMode: false,
      });
      return postOf(posted, chat);
    },
    onPost(handler) {
      if (handlers.size === 0) {
        client.addEventHandler(onEvent, new NewMessage({}));
        client.addEventHandler(onEvent, new EditedMessage({}));
      }
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

module.exports = { createGateway, keyOf };
```

`forward` берёт `targetRef` строкой, а не `Chat`: сегодня цель пересылки — это `config.target`, произвольная строка вроде `me`, и разрешать её в сущность незачем.

- [ ] **Шаг 10: прогнать контракт по настоящему шлюзу**

Run: `cd /root/tg-reader-refactor && node --test src/platform/telegram/gateway.test.js`
Expected: PASS, 11 из 11

Если падает «альбом приходит одной пачкой» — проверить, что `queue()` отменяет прошлый таймер, а не заводит второй.

- [ ] **Шаг 11: написать фейковый шлюз и прогнать по нему тот же контракт**

Создать `src/platform/telegram/fake.js` — реализация того же контракта поверх карт в памяти, без gramjs. Он нужен задачам 5, 6 и 7 как подстановка вместо Telegram.

```js
const { cut, messageLink, TELEGRAM_LIMIT } = require('./text');

function createFakeGateway({ clock, membersFail = false, albumWindowMs = 800 } = {}) {
  const chats = new Map([
    ['@one', { key: '111', title: 'Первый', username: 'one', id: 111 }],
  ]);
  const posts = new Map([['111', []]]);
  const handlers = new Set();
  const albums = new Map();
  const names = new Map([['5', 'Аня'], ['6', 'boris']]);
  let nextId = 500;
  let connected = false;

  const seed = (chatKey, list) => {
    posts.set(chatKey, list);
  };

  const make = (chat, { id, text = '', from = '5', replyTo = null, groupId = null, at = 1700000000000 }) => ({
    id,
    chatKey: chat.key,
    at,
    text,
    from,
    author: names.get(from) || null,
    replyTo,
    groupId,
    link: messageLink(chat, id),
  });

  seed('111', [
    make(chats.get('@one'), { id: 1, text: 'первое', from: '5' }),
    make(chats.get('@one'), { id: 2, text: 'второе', from: '6', replyTo: 1, at: 1700000060000 }),
  ]);

  function deliver(batch) {
    for (const handler of [...handlers]) handler(batch);
  }

  const gateway = {
    get connected() { return connected; },
    async connect() { connected = true; },
    async disconnect() { connected = false; },
    async authorized() { return true; },
    async me() { return { id: '999', name: 'Хозяин', username: 'owner' }; },
    async resolveChat(ref) {
      if (ref && typeof ref === 'object' && ref.key) return ref;
      const chat = chats.get(ref);
      if (!chat) throw new Error(`нет такого чата: ${ref}`);
      return chat;
    },
    async members() {
      return membersFail ? new Map() : new Map(names);
    },
    async recent(chat, { limit = 50, afterId, fromMe = false } = {}) {
      const resolved = await gateway.resolveChat(chat);
      return (posts.get(resolved.key) || [])
        .filter((post) => (afterId === undefined || afterId === null ? true : post.id > afterId))
        .filter((post) => (fromMe ? post.from === '999' : true))
        .sort((a, b) => a.id - b.id)
        .slice(-limit);
    },
    async forward(targetRef, chat, ids) {
      gateway.forwarded.push({ targetRef, chatKey: (await gateway.resolveChat(chat)).key, ids: [...ids] });
    },
    async sendText(ref, text, { replyTo } = {}) {
      const chat = await gateway.resolveChat(ref);
      nextId += 1;
      const post = make(chat, { id: nextId, text: cut(text, TELEGRAM_LIMIT), from: '999', replyTo: replyTo || null });
      gateway.sent.push(post);
      return post;
    },
    onPost(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    forwarded: [],
    sent: [],
    emit({ chatRef = '@one', id, text = '', groupId = null, from = '5', replyTo = null }) {
      const chat = chats.get(chatRef);
      const post = make(chat, { id, text, from, replyTo, groupId });
      (posts.get(chat.key) || []).push(post);
      if (!groupId) {
        deliver([post]);
        return;
      }
      const key = `${chat.key}:g${groupId}`;
      let entry = albums.get(key);
      if (!entry) {
        entry = { posts: [], cancel: null };
        albums.set(key, entry);
      }
      entry.posts.push(post);
      if (entry.cancel) entry.cancel();
      entry.cancel = clock.after(albumWindowMs, () => {
        albums.delete(key);
        deliver(entry.posts.sort((a, b) => a.id - b.id));
      });
    },
    seed,
  };

  return gateway;
}

module.exports = { createFakeGateway };
```

Создать `src/platform/telegram/fake.test.js`:

```js
const test = require('node:test');
const { gatewayContract } = require('./contract');
const { createFakeGateway } = require('./fake');
const { createManualClock } = require('../clock');

async function make({ membersFail = false } = {}) {
  const clock = createManualClock(0);
  const gateway = createFakeGateway({ clock, membersFail });
  return { gateway, clock, emit: gateway.emit };
}

for (const check of gatewayContract(make)) test(`фейк: ${check.name}`, check.run);
```

- [ ] **Шаг 12: прогнать контракт по фейку**

Run: `cd /root/tg-reader-refactor && node --test src/platform/telegram/fake.test.js`
Expected: PASS, 11 из 11 — те же одиннадцать проверок, что и у настоящего шлюза

В этом весь смысл: фейк, которым задачи 5-7 будут подменять Telegram, не может разойтись с адаптером незамеченным.

- [ ] **Шаг 13: перенести создание клиента и убрать `client.js` и `peer.js`**

Создать `src/platform/telegram/client.js`:

```js
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

function createTelegramClient({ apiId, apiHash, session }) {
  return new TelegramClient(new StringSession(session), apiId, apiHash, { floodSleepThreshold: 300 });
}

module.exports = { createTelegramClient };
```

`src/client.js` заменить на прослойку (умрёт в задаче 9):

```js
const { config } = require('./config');
const { createTelegramClient } = require('./platform/telegram/client');

function createClient(session = config.session) {
  return createTelegramClient({ apiId: config.apiId, apiHash: config.apiHash, session });
}

module.exports = { createClient };
```

`src/peer.js` заменить на прослойку:

```js
const { keyOf } = require('./platform/telegram/gateway');

module.exports = { peerKey: keyOf, eventPeerKey: (event, message) => keyOf(event && event.chatId !== undefined ? event.chatId : message && message.peerId) };
```

Перенести тест: `git mv src/peer.test.js src/platform/telegram/peer.test.js`, внутри `require('./peer')` → `const { keyOf: peerKey } = require('./gateway')`.

- [ ] **Шаг 14: включить правило 6 — `require('telegram')` только в адаптере**

Дописать в `tools/boundaries.test.js`:

`jsFilesUnder`, `requiresOf` и `hasProcessExit` уже импортированы в шапке файла задачей 1 — второй раз их объявлять нельзя.

```js
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
```

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: FAIL со списком нарушителей — `index.js` тянет `telegram/events`.

- [ ] **Шаг 15: убрать последний прямой импорт gramjs из `index.js`**

В `src/index.js` удалить строки 1-2 (`NewMessage`, `EditedMessage`) и завести шлюз в `main()` рядом с клиентом:

```js
const { createGateway } = require('./platform/telegram/gateway');
const { createClock } = require('./platform/clock');
```

Рядом с существующими `let client = null; let forwarder = null;` (`index.js:38-39`) объявить `let clock = null; let gateway = null;`, а после `client = createClient();` в `main()` собрать:

```js
  clock = createClock();
  gateway = createGateway({ client, clock, log });
```

Две подписки `client.addEventHandler(onEvent, new NewMessage({}))` / `EditedMessage` (строки 109-110) заменить на одну:

```js
  gateway.onPost((posts) => {
    onPosts(posts).catch((err) => log(`Ошибка обработки сообщения: ${err.message}`));
  });
```

где `onPosts` — обёртка, вызывающая `forwarder.handle(source, posts)` для известного `posts[0].chatKey`. Подписку автоответов (`index.js:285-290`) заменить на второй `gateway.onPost` с фильтром по `chatKey` чата ответов, а `chatMessageOf` (`index.js:186-197`) удалить целиком: шлюз уже отдаёт `Post` с `from`, `author` и `replyTo`.

Полная развязка `index.js` — задача 9. Здесь достаточно, чтобы прямых импортов gramjs в нём не осталось и правило 6 стало зелёным.

- [ ] **Шаг 16: прогнать всё**

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -8`
Expected: `# fail 0`, включая правило 6

Run: `cd /root/tg-reader-refactor && grep -rn "require('telegram" src --include=*.js | grep -v "^src/platform/telegram/"`
Expected: пусто

- [ ] **Шаг 17: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src tools
git commit -m "$(cat <<'EOF'
Telegram убран за один контракт, склейка альбомов — в адаптер

gramjs жил в девяти модулях: getMessages звали шестеро, event.message
перекладывали в доменный объект трижды, ссылку строили дважды, лимит 4096
объявляли дважды. Теперь require('telegram') встречается только в
platform/telegram, а наружу выходят Chat и Post — обычные объекты.

Контракт шлюза — не комментарий, а файл: одиннадцать проверок в
contract.js прогоняются и по настоящему адаптеру, и по фейку, которым
задачи 5-7 будут подменять Telegram. Разойтись незамеченными они не могут.

Альбомный таймер уехал из forwarder в адаптер: onPost отдаёт готовую
пачку. Разворачивание истории, которое forwarder и index делали руками,
теперь делает recent() — он всегда отдаёт по возрастанию id.

Правило 6 включено и проверяется тестом.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 4: `platform/db`, схема, четыре store и перенос `state.json`

Снимает дефект №4. Четыре владельца перестают делить одну запись, `wasSent` и `wasAnswered` становятся обращением по первичному ключу, отложенная запись с окном в две секунды исчезает.

**Files:**
- Create: `src/platform/db/open.js`
- Create: `src/platform/db/open.test.js`
- Create: `src/platform/db/migrations/index.js`
- Create: `src/platform/db/migrations/001-initial.js`
- Create: `src/platform/db/import-state-json.js`
- Create: `src/platform/db/import-state-json.test.js`
- Create: `src/features/forwarding/store.js` + `store.test.js`
- Create: `src/features/digest/store.js` + `store.test.js`
- Create: `src/features/replies/store.js` + `store.test.js`
- Create: `src/features/health/status.js` + `status.test.js`
- Modify: `src/state.js` (становится прослойкой поверх четырёх store; умрёт в задаче 9)

**Interfaces:**
- Consumes: `platform/clock.js` (`now`) из задачи 3.
- Produces:
  - `openDb(file, { readOnly = false }) -> DatabaseSync` — WAL, схема применена, `PRAGMA user_version` выставлен.
  - `importLegacyState(db, stateFile) -> { imported: boolean, chats: number }`.
  - `createForwardingStore(db)`: `lastId(chatKey)`, `advance(chatKey, id)`, `wasSent(chatKey, id)`, `noteSeen(chatKey, count, at)`, `lastMessageAt()`, `totals()`, `commitForward(chatKey, { ids, newestId, at })`.
  - `createDigestStore(db)`: `upTo(chatKey)`, `setUpTo(chatKey, id)`, `lastRunAt(chatKey)`, `setRunAt(chatKey, at)`.
  - `createRepliesStore(db)`: `enabled()`, `setEnabled(on)`, `counters(day)`, `noteReply(kind, at, day)`, `resetCounters()`, `wasAnswered(id)`, `noteAnswered(id, at)`, `recent(limit)`, `noteSaid(text, at)`, `botOffset()`, `setBotOffset(value)`.
  - `createStatusWriter(db)`: `write(snapshot, at)`; `readStatus(file) -> { ok: true, status } | { ok: false, reason }`.
  - `STATUS_CONTRACT = 1`.

**Схема (`001-initial.js`):**

```sql
CREATE TABLE forward_cursor (
  chat_key TEXT PRIMARY KEY, last_id INTEGER, last_post_at INTEGER,
  checked INTEGER NOT NULL DEFAULT 0, forwarded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE forward_sent (
  chat_key TEXT NOT NULL, message_id INTEGER NOT NULL, sent_at INTEGER NOT NULL,
  PRIMARY KEY (chat_key, message_id));
CREATE TABLE digest_cursor (
  chat_key TEXT PRIMARY KEY, up_to_id INTEGER, last_run_at INTEGER);
CREATE TABLE reply_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 1,
  day TEXT, addressed INTEGER NOT NULL DEFAULT 0, spontaneous INTEGER NOT NULL DEFAULT 0,
  last_addressed_at INTEGER NOT NULL DEFAULT 0, last_spontaneous_at INTEGER NOT NULL DEFAULT 0,
  bot_offset INTEGER NOT NULL DEFAULT 0);
CREATE TABLE reply_answered (message_id INTEGER PRIMARY KEY, answered_at INTEGER NOT NULL);
CREATE TABLE reply_said (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, said_at INTEGER NOT NULL);
CREATE TABLE status (
  id INTEGER PRIMARY KEY CHECK (id = 1), contract INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  started_at INTEGER, forwarding INTEGER, digest_enabled INTEGER, replies_enabled INTEGER,
  last_post_at INTEGER, probe_ok_at INTEGER, checked_total INTEGER, forwarded_total INTEGER);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```

Версия схемы (`PRAGMA user_version`) и отметка о переносе из JSON — **разные** вопросы. Версия говорит, какой формы таблицы; строка `meta('imported_from_json')` говорит, что старый файл уже разобран. Если смешать их, как было записано в спецификации, то первая же будущая миграция схемы сбросит `user_version` в состояние «переноса не было» и перечитает давно протухший `state.json`.

- [ ] **Шаг 1: написать падающий тест открытия базы**

Создать `src/platform/db/open.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, SCHEMA_VERSION } = require('./open');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tgdb-')), 'state.db');
}

test('новая база получает схему и номер версии', () => {
  const db = openDb(tempFile());
  assert.strictEqual({ ...db.prepare('PRAGMA user_version').get() }.user_version, SCHEMA_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  assert.ok(tables.includes('forward_cursor'));
  assert.ok(tables.includes('reply_answered'));
  assert.ok(tables.includes('status'));
  db.close();
});

test('повторное открытие не пересоздаёт таблицы и не теряет данные', () => {
  const file = tempFile();
  const first = openDb(file);
  first.prepare('INSERT INTO forward_cursor(chat_key, last_id) VALUES(?, ?)').run('c1', 7);
  first.close();
  const second = openDb(file);
  assert.strictEqual({ ...second.prepare('SELECT last_id FROM forward_cursor WHERE chat_key=?').get('c1') }.last_id, 7);
  second.close();
});

test('база открывается в режиме WAL', () => {
  const db = openDb(tempFile());
  assert.strictEqual({ ...db.prepare('PRAGMA journal_mode').get() }.journal_mode, 'wal');
  db.close();
});

test('readOnly отбивает запись', () => {
  const file = tempFile();
  openDb(file).close();
  const db = openDb(file, { readOnly: true });
  assert.throws(() => db.prepare('INSERT INTO forward_cursor(chat_key) VALUES(?)').run('c1'), /readonly/i);
  db.close();
});
```

Строки `node:sqlite` — объекты с `null`-прототипом, поэтому везде `{ ...row }`. Без этого `deepStrictEqual` падает на прототипе, а не на данных.

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `cd /root/tg-reader-refactor && node --test src/platform/db/open.test.js`
Expected: FAIL, `Cannot find module './open'`

- [ ] **Шаг 3: написать схему и открытие базы**

Создать `src/platform/db/migrations/001-initial.js` — модуль вида `module.exports = { version: 1, sql: \`...\` }` с SQL из таблицы выше.

Создать `src/platform/db/migrations/index.js`:

```js
const initial = require('./001-initial');

const ALL = [initial];

function apply(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version) || 0;
  const pending = ALL.filter((migration) => migration.version > current);
  if (pending.length === 0) return current;
  db.exec('BEGIN');
  try {
    for (const migration of pending) db.exec(migration.sql);
    db.exec(`PRAGMA user_version = ${pending[pending.length - 1].version}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return pending[pending.length - 1].version;
}

module.exports = { apply, SCHEMA_VERSION: ALL[ALL.length - 1].version };
```

Создать `src/platform/db/open.js`:

```js
const { DatabaseSync } = require('node:sqlite');
const { apply, SCHEMA_VERSION } = require('./migrations');

function openDb(file, { readOnly = false } = {}) {
  const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  if (readOnly) return db;
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  apply(db);
  return db;
}

module.exports = { openDb, SCHEMA_VERSION };
```

`PRAGMA user_version = ?` через параметр не работает — SQLite не принимает связывание в PRAGMA. Отсюда шаблонная строка; значение берётся из кода миграции, не снаружи.

- [ ] **Шаг 4: прогнать тест открытия**

Run: `cd /root/tg-reader-refactor && node --test src/platform/db/open.test.js`
Expected: PASS, 4 из 4

- [ ] **Шаг 5: написать падающий тест store пересылки**

Создать `src/features/forwarding/store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createForwardingStore } = require('./store');

function store() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-')), 'state.db');
  return createForwardingStore(openDb(file));
}

test('незнакомый чат не имеет курсора', () => {
  assert.strictEqual(store().lastId('c1'), null);
});

test('курсор двигается только вперёд', () => {
  const s = store();
  s.advance('c1', 10);
  s.advance('c1', 5);
  assert.strictEqual(s.lastId('c1'), 10);
});

test('отправленное помнится по первичному ключу, а не поиском в массиве', () => {
  const s = store();
  assert.strictEqual(s.wasSent('c1', 42), false);
  s.commitForward('c1', { ids: [42], newestId: 42, at: 1000 });
  assert.strictEqual(s.wasSent('c1', 42), true);
  assert.strictEqual(s.wasSent('c2', 42), false);
});

test('пересылка и продвижение курсора — одна транзакция', () => {
  const s = store();
  s.commitForward('c1', { ids: [7, 8], newestId: 9, at: 1000 });
  assert.strictEqual(s.lastId('c1'), 9);
  assert.strictEqual(s.wasSent('c1', 7), true);
  assert.strictEqual(s.wasSent('c1', 8), true);
  assert.strictEqual(s.totals().forwarded, 2);
});

test('повторная отметка не удваивает счётчик', () => {
  const s = store();
  s.commitForward('c1', { ids: [7], newestId: 7, at: 1000 });
  s.commitForward('c1', { ids: [7], newestId: 7, at: 2000 });
  assert.strictEqual(s.totals().forwarded, 1);
});

test('счётчики и время последнего сообщения складываются по всем чатам', () => {
  const s = store();
  s.noteSeen('c1', 3, 1000);
  s.noteSeen('c2', 4, 2000);
  assert.deepStrictEqual(s.totals(), { checked: 7, forwarded: 0 });
  assert.strictEqual(s.lastMessageAt(), 2000);
});

test('пустая база не врёт про время последнего сообщения', () => {
  assert.strictEqual(store().lastMessageAt(), null);
});

test('память об отправленных чистится по возрасту, а не по счётчику', () => {
  const s = store();
  s.commitForward('c1', { ids: [1], newestId: 1, at: 1000 });
  s.commitForward('c1', { ids: [2], newestId: 2, at: 1000 + 200 * DAY_MS });
  assert.strictEqual(s.wasSent('c1', 1), false, 'старое забыто');
  assert.strictEqual(s.wasSent('c1', 2), true, 'свежее помнится');
});

test('счётчик пересланного не уменьшается вместе с забытыми записями', () => {
  const s = store();
  s.commitForward('c1', { ids: [1], newestId: 1, at: 1000 });
  s.commitForward('c1', { ids: [2], newestId: 2, at: 1000 + 200 * DAY_MS });
  assert.strictEqual(s.totals().forwarded, 2);
});
```

В шапке теста добавить `const DAY_MS = 24 * 60 * 60 * 1000;`.

Сегодня память об отправленных — кольцевой буфер на 300 элементов с ручной подрезкой (`state.js:261`). Триста — число, взятое с потолка: на тихом канале это годы, на шумном — часы. Возраст честнее: запись живёт `FORGET_AFTER_MS`, и от объёма трафика это не зависит. Счётчик `forwarded` при этом накопительный и забытые записи его не трогают — иначе суточная сводка в тревогах начала бы врать.

- [ ] **Шаг 6: убедиться, что тест падает, и написать store**

Run: `cd /root/tg-reader-refactor && node --test src/features/forwarding/store.test.js`
Expected: FAIL, `Cannot find module './store'`

Создать `src/features/forwarding/store.js`:

```js
const FORGET_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

function createForwardingStore(db, { forgetAfterMs = FORGET_AFTER_MS } = {}) {
  const row = db.prepare('SELECT last_id, checked, forwarded FROM forward_cursor WHERE chat_key = ?');
  const ensure = db.prepare('INSERT OR IGNORE INTO forward_cursor(chat_key) VALUES(?)');
  const bump = db.prepare('UPDATE forward_cursor SET last_id = ? WHERE chat_key = ? AND (last_id IS NULL OR last_id < ?)');
  const seen = db.prepare('UPDATE forward_cursor SET checked = checked + ?, last_post_at = MAX(COALESCE(last_post_at, 0), ?) WHERE chat_key = ?');
  const sent = db.prepare('INSERT OR IGNORE INTO forward_sent(chat_key, message_id, sent_at) VALUES(?, ?, ?)');
  const counted = db.prepare('UPDATE forward_cursor SET forwarded = forwarded + ? WHERE chat_key = ?');
  const asked = db.prepare('SELECT 1 AS yes FROM forward_sent WHERE chat_key = ? AND message_id = ?');
  const sums = db.prepare('SELECT COALESCE(SUM(checked), 0) AS checked, COALESCE(SUM(forwarded), 0) AS forwarded FROM forward_cursor');
  const newest = db.prepare('SELECT MAX(last_post_at) AS at FROM forward_cursor');
  const forget = db.prepare('DELETE FROM forward_sent WHERE sent_at < ?');

  return {
    lastId(chatKey) {
      const found = row.get(chatKey);
      return found && found.last_id !== null ? found.last_id : null;
    },
    advance(chatKey, id) {
      if (!Number.isInteger(id)) return;
      ensure.run(chatKey);
      bump.run(id, chatKey, id);
    },
    wasSent(chatKey, messageId) {
      return Boolean(asked.get(chatKey, messageId));
    },
    noteSeen(chatKey, count, at) {
      ensure.run(chatKey);
      seen.run(count, Number.isInteger(at) ? at : 0, chatKey);
    },
    commitForward(chatKey, { ids, newestId, at }) {
      ensure.run(chatKey);
      db.exec('BEGIN');
      try {
        let added = 0;
        for (const id of ids) added += sent.run(chatKey, id, at).changes;
        if (added > 0) counted.run(added, chatKey);
        if (Number.isInteger(newestId)) bump.run(newestId, chatKey, newestId);
        forget.run(at - forgetAfterMs);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    totals() {
      return { ...sums.get() };
    },
    lastMessageAt() {
      const found = newest.get();
      return found && found.at ? found.at : null;
    },
  };
}

module.exports = { createForwardingStore, FORGET_AFTER_MS };
```

Run: `cd /root/tg-reader-refactor && node --test src/features/forwarding/store.test.js`
Expected: PASS, 7 из 7

- [ ] **Шаг 7: store сводки**

Создать `src/features/digest/store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createDigestStore } = require('./store');

function store() {
  return createDigestStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dig-')), 'state.db')));
}

test('незнакомый канал не имеет ни курсора, ни времени прогона', () => {
  const s = store();
  assert.strictEqual(s.upTo('c1'), null);
  assert.strictEqual(s.lastRunAt('c1'), null);
});

test('курсор сводки двигается только вперёд', () => {
  const s = store();
  s.setUpTo('c1', 100);
  s.setUpTo('c1', 50);
  assert.strictEqual(s.upTo('c1'), 100);
});

test('время прогона перезаписывается как есть', () => {
  const s = store();
  s.setRunAt('c1', 1000);
  s.setRunAt('c1', 500);
  assert.strictEqual(s.lastRunAt('c1'), 500);
});
```

Создать `src/features/digest/store.js`:

```js
function createDigestStore(db) {
  const ensure = db.prepare('INSERT OR IGNORE INTO digest_cursor(chat_key) VALUES(?)');
  const row = db.prepare('SELECT up_to_id, last_run_at FROM digest_cursor WHERE chat_key = ?');
  const bump = db.prepare('UPDATE digest_cursor SET up_to_id = ? WHERE chat_key = ? AND (up_to_id IS NULL OR up_to_id < ?)');
  const ran = db.prepare('UPDATE digest_cursor SET last_run_at = ? WHERE chat_key = ?');

  const field = (chatKey, name) => {
    const found = row.get(chatKey);
    return found && found[name] !== null ? found[name] : null;
  };

  return {
    upTo: (chatKey) => field(chatKey, 'up_to_id'),
    lastRunAt: (chatKey) => field(chatKey, 'last_run_at'),
    setUpTo(chatKey, messageId) {
      if (!Number.isInteger(messageId)) return;
      ensure.run(chatKey);
      bump.run(messageId, chatKey, messageId);
    },
    setRunAt(chatKey, at) {
      if (!Number.isInteger(at)) return;
      ensure.run(chatKey);
      ran.run(at, chatKey);
    },
  };
}

module.exports = { createDigestStore };
```

Монотонность `setUpTo` — не украшение, а сегодняшнее поведение (`state.js:136`): без неё повторный прогон сводки за старый период откатил бы курсор назад и следующая сводка пришла бы дважды.

Run: `cd /root/tg-reader-refactor && node --test src/features/digest/store.test.js`
Expected: PASS, 3 из 3

- [ ] **Шаг 8: store автоответов**

Создать `src/features/replies/store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createRepliesStore } = require('./store');

function store() {
  return createRepliesStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')), 'state.db')));
}

test('по умолчанию автоответы включены', () => {
  assert.strictEqual(store().enabled(), true);
});

test('выключение переживает пересоздание store на том же файле', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')), 'state.db');
  const first = createRepliesStore(openDb(file));
  first.setEnabled(false);
  assert.strictEqual(createRepliesStore(openDb(file)).enabled(), false);
});

test('счётчики обнуляются при смене суток', () => {
  const s = store();
  s.noteReply('addressed', 1000, '2026-9-4');
  assert.strictEqual(s.counters('2026-9-4').addressed, 1);
  assert.deepStrictEqual(s.counters('2026-9-5'), { addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 });
});

test('спонтанные и адресные считаются раздельно', () => {
  const s = store();
  s.noteReply('addressed', 1000, 'd');
  s.noteReply('spontaneous', 2000, 'd');
  const counters = s.counters('d');
  assert.strictEqual(counters.addressed, 1);
  assert.strictEqual(counters.spontaneous, 1);
  assert.strictEqual(counters.lastAddressedAt, 1000);
  assert.strictEqual(counters.lastSpontaneousAt, 2000);
});

test('сброс обнуляет счётчики, не трогая флаг', () => {
  const s = store();
  s.noteReply('addressed', 1000, 'd');
  s.resetCounters();
  assert.strictEqual(s.counters('d').addressed, 0);
  assert.strictEqual(s.enabled(), true);
});

test('на сообщение отвечают один раз, и это переживает перезапуск', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')), 'state.db');
  const first = createRepliesStore(openDb(file));
  assert.strictEqual(first.wasAnswered(42), false);
  first.noteAnswered(42, 1000);
  assert.strictEqual(createRepliesStore(openDb(file)).wasAnswered(42), true);
});

test('помнятся восемь последних реплик, новейшие первыми', () => {
  const s = store();
  for (let i = 1; i <= 10; i += 1) s.noteSaid(`реплика ${i}`, i);
  const recent = s.recent(8);
  assert.strictEqual(recent.length, 8);
  assert.strictEqual(recent[0], 'реплика 10');
  assert.ok(!recent.includes('реплика 1'));
});

test('смещение бота хранится и переживает перезапуск', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')), 'state.db');
  const first = createRepliesStore(openDb(file));
  assert.strictEqual(first.botOffset(), 0);
  first.setBotOffset(12345);
  assert.strictEqual(createRepliesStore(openDb(file)).botOffset(), 12345);
});
```

Создать `src/features/replies/store.js`. Единственная строка `reply_state` заводится при создании store через `INSERT OR IGNORE INTO reply_state(id) VALUES(1)`. `counters(day)` сравнивает хранимый `day` с переданным и, если они разошлись, отдаёт нули, не трогая базу, — ровно как `state.js:174`. `noteReply` при смене суток сначала обнуляет счётчики и ставит новый `day`. `recent(limit)` — `SELECT text FROM reply_said ORDER BY id DESC LIMIT ?`. `noteSaid` после вставки чистит хвост: `DELETE FROM reply_said WHERE id NOT IN (SELECT id FROM reply_said ORDER BY id DESC LIMIT 8)`. `noteAnswered` чистит `reply_answered` по возрасту тем же способом, что и `forward_sent`: `DELETE FROM reply_answered WHERE answered_at < ?` с тем же окном в 90 дней вместо кольца на 500 элементов.

Порядок в `recent` — новейшие первыми, тогда как сегодня `state.recentReplies()` отдаёт старейшими первыми. Это меняет вход `repeatsRecent`, который в `replier.js:67` берёт `said.slice(-echoGuard)`. Задача 7 обязана снять `.slice(-echoGuard)` и передавать `store.recent(echoGuard)`; тест на повтор шутки поймает ошибку, если этого не сделать.

Run: `cd /root/tg-reader-refactor && node --test src/features/replies/store.test.js`
Expected: PASS, 8 из 8

- [ ] **Шаг 9: контракт `status`**

Создать `src/features/health/status.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createStatusWriter, readStatus, STATUS_CONTRACT } = require('./status');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 'state.db');
}

const snapshot = {
  startedAt: 1000,
  forwarding: true,
  digestEnabled: true,
  repliesEnabled: false,
  lastPostAt: 5000,
  probeOkAt: 6000,
  checked: 12,
  forwarded: 3,
};

test('записанный статус читается снаружи как есть', () => {
  const file = tempFile();
  const db = openDb(file);
  createStatusWriter(db).write(snapshot, 9000);
  db.close();
  const result = readStatus(file);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status.updatedAt, 9000);
  assert.strictEqual(result.status.forwarding, true);
  assert.strictEqual(result.status.repliesEnabled, false);
  assert.strictEqual(result.status.probeOkAt, 6000);
  assert.strictEqual(result.status.checked, 12);
});

test('статус переписывается, а не накапливается', () => {
  const file = tempFile();
  const db = openDb(file);
  const writer = createStatusWriter(db);
  writer.write(snapshot, 1);
  writer.write(snapshot, 2);
  assert.strictEqual({ ...db.prepare('SELECT COUNT(*) AS n FROM status').get() }.n, 1);
  db.close();
  assert.strictEqual(readStatus(file).status.updatedAt, 2);
});

test('незнакомая версия контракта — отказ, а не молчаливое согласие', () => {
  const file = tempFile();
  const db = openDb(file);
  createStatusWriter(db).write(snapshot, 9000);
  db.prepare('UPDATE status SET contract = ? WHERE id = 1').run(STATUS_CONTRACT + 1);
  db.close();
  const result = readStatus(file);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /контракт/i);
});

test('база без единой записи статуса — тоже отказ', () => {
  const file = tempFile();
  openDb(file).close();
  const result = readStatus(file);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /статус/i);
});

test('нечитаемый файл не роняет проверку', () => {
  const result = readStatus(path.join(os.tmpdir(), 'нет-такого-файла.db'));
  assert.strictEqual(result.ok, false);
});

test('readStatus открывает базу только на чтение', () => {
  const file = tempFile();
  const db = openDb(file);
  createStatusWriter(db).write(snapshot, 1);
  db.close();
  readStatus(file);
  const after = openDb(file, { readOnly: true });
  assert.strictEqual({ ...after.prepare('SELECT updated_at FROM status WHERE id=1').get() }.updated_at, 1);
});
```

Создать `src/features/health/status.js` с `STATUS_CONTRACT = 1`, `createStatusWriter(db)` (`INSERT INTO status(id, ...) VALUES(1, ...) ON CONFLICT(id) DO UPDATE SET ...`) и `readStatus(file)`, который открывает базу через `openDb(file, { readOnly: true })`, ловит любое исключение и возвращает `{ ok: false, reason }` вместо броска.

Три отказа — три разных `reason`: «не удалось открыть хранилище», «в хранилище нет строки статуса», «незнакомая версия контракта статуса: N». Тексты пойдут в тревогу, поэтому пусть будут человеческими.

`updated_at` — то, чего сегодня нет: он отличает «сервис жив, но в канале тишина» от «сервис вообще не пишет статус». Второе — зависший event loop, который сейчас выглядит для мониторинга здоровым, потому что `systemctl` показывает `active`.

Run: `cd /root/tg-reader-refactor && node --test src/features/health/status.test.js`
Expected: PASS, 6 из 6

- [ ] **Шаг 10: написать падающий тест переноса `state.json`**

Создать `src/platform/db/import-state-json.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('./open');
const { importLegacyState } = require('./import-state-json');
const { createForwardingStore } = require('../../features/forwarding/store');
const { createDigestStore } = require('../../features/digest/store');
const { createRepliesStore } = require('../../features/replies/store');

function bench(legacy) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const jsonFile = path.join(dir, 'state.json');
  fs.writeFileSync(jsonFile, JSON.stringify(legacy));
  return { db: openDb(path.join(dir, 'state.db')), jsonFile };
}

const legacy = {
  '-100111': {
    lastId: 900, sent: [898, 899, 900], lastMessageAt: 1700000000000,
    checked: 40, forwarded: 3, digestUpToId: null, digestRunAt: null,
  },
  '-100222': {
    lastId: null, sent: [], lastMessageAt: null,
    checked: 0, forwarded: 0, digestUpToId: 555, digestRunAt: 1700000100000,
  },
  _service: {
    startedAt: 1699999000000,
    lastDigestRunAt: 1699999900000,
    forwarding: true,
    replies: {
      enabled: false, day: '2026-9-4', addressed: 2, spontaneous: 1,
      lastAddressedAt: 1700000200000, lastSpontaneousAt: 1700000300000,
      answered: [11, 12], said: ['раз', 'два'], botOffset: 777,
    },
  },
};

test('курсоры и счётчики пересылки переносятся до последнего числа', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  const store = createForwardingStore(db);
  assert.strictEqual(store.lastId('-100111'), 900);
  assert.strictEqual(store.wasSent('-100111', 899), true);
  assert.strictEqual(store.wasSent('-100111', 1), false);
  assert.deepStrictEqual(store.totals(), { checked: 40, forwarded: 3 });
  assert.strictEqual(store.lastMessageAt(), 1700000000000);
});

test('курсор сводки переносится', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  assert.strictEqual(createDigestStore(db).upTo('-100222'), 555);
});

test('канал без своего digestRunAt берёт общий из _service', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  assert.strictEqual(createDigestStore(db).lastRunAt('-100111'), 1699999900000);
});

test('ВЫКЛЮЧЕННЫЕ АВТООТВЕТЫ ОСТАЮТСЯ ВЫКЛЮЧЕННЫМИ', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  assert.strictEqual(createRepliesStore(db).enabled(), false);
});

test('счётчики, отвеченные, сказанное и смещение бота переносятся', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  const store = createRepliesStore(db);
  const counters = store.counters('2026-9-4');
  assert.strictEqual(counters.addressed, 2);
  assert.strictEqual(counters.spontaneous, 1);
  assert.strictEqual(store.wasAnswered(11), true);
  assert.deepStrictEqual(store.recent(8), ['два', 'раз']);
  assert.strictEqual(store.botOffset(), 777);
});

test('перенос выполняется один раз', () => {
  const { db, jsonFile } = bench(legacy);
  assert.strictEqual(importLegacyState(db, jsonFile).imported, true);
  createForwardingStore(db).advance('-100111', 1200);
  assert.strictEqual(importLegacyState(db, jsonFile).imported, false);
  assert.strictEqual(createForwardingStore(db).lastId('-100111'), 1200, 'повторный перенос откатил бы курсор назад');
});

test('перенос не изменяет файл', () => {
  const { db, jsonFile } = bench(legacy);
  const before = fs.readFileSync(jsonFile, 'utf8');
  const stat = fs.statSync(jsonFile);
  importLegacyState(db, jsonFile);
  assert.strictEqual(fs.readFileSync(jsonFile, 'utf8'), before);
  assert.strictEqual(fs.statSync(jsonFile).mtimeMs, stat.mtimeMs);
});

test('отсутствие файла — не ошибка, а первый запуск', () => {
  const { db } = bench(legacy);
  const result = importLegacyState(db, path.join(os.tmpdir(), 'нет-такого.json'));
  assert.strictEqual(result.imported, false);
  assert.strictEqual(createRepliesStore(db).enabled(), true);
});

test('битый файл не роняет запуск', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const jsonFile = path.join(dir, 'state.json');
  fs.writeFileSync(jsonFile, '{ это не json');
  const db = openDb(path.join(dir, 'state.db'));
  assert.doesNotThrow(() => importLegacyState(db, jsonFile));
});
```

- [ ] **Шаг 11: убедиться, что тест падает, и написать перенос**

Run: `cd /root/tg-reader-refactor && node --test src/platform/db/import-state-json.test.js`
Expected: FAIL, `Cannot find module './import-state-json'`

Создать `src/platform/db/import-state-json.js`. Требования, вытекающие из тестов:

1. Файл читается через `fs.readFileSync` и больше не трогается никогда. Ни записи, ни переименования, ни удаления: `state.json` остаётся откатом на `main`.
2. Всё пишется в одной транзакции `BEGIN` / `COMMIT`, с `ROLLBACK` на любой ошибке.
3. Признак «уже перенесено» — строка `meta` с ключом `imported_from_json`. Проверяется до чтения файла; если она есть, вернуть `{ imported: false, chats: 0 }`.
4. Ключ `_service` — не чат. Все остальные ключи верхнего уровня — чаты.
5. `digest_cursor.last_run_at` для чата без своего `digestRunAt` берётся из `_service.lastDigestRunAt`. Это сегодняшнее поведение `state.js:140-144`; без него первая же сводка после перезапуска решит, что не запускалась никогда, и придёт вне расписания.
6. `enabled` переносится как `value.enabled !== false` — та же трактовка, что в `normalizeReplies` (`state.js:60`): отсутствующий ключ значит «включено», и только явное `false` значит «выключено».
7. `said` в JSON лежит старейшими первыми; в `reply_said` он должен лечь так, чтобы `recent(8)` вернул новейшими первыми — то есть вставлять в порядке массива, полагаясь на возрастающий `AUTOINCREMENT`.
8. Любое исключение при разборе JSON гасится, пишется в лог и даёт `{ imported: false }`. Сервис обязан подняться и с битым файлом — как поднимается сегодня (`state.js:16-19`).

- [ ] **Шаг 12: прогнать перенос**

Run: `cd /root/tg-reader-refactor && node --test src/platform/db/import-state-json.test.js`
Expected: PASS, 9 из 9

- [ ] **Шаг 13: сверка на копии боевого файла**

Это единственная проверка задачи, которую нельзя заменить тестом: боевой `state.json` содержит данные, которых нет ни в одном фикстуре.

```bash
cd /root/tg-reader-refactor
mkdir -p /tmp/state-check
cp /var/www/www-root/data/www/tg-reader/state.json /tmp/state-check/state.json
node --disable-warning=ExperimentalWarning -e "
const fs = require('fs');
const { openDb } = require('./src/platform/db/open');
const { importLegacyState } = require('./src/platform/db/import-state-json');
const { createForwardingStore } = require('./src/features/forwarding/store');
const { createDigestStore } = require('./src/features/digest/store');
const { createRepliesStore } = require('./src/features/replies/store');

const json = JSON.parse(fs.readFileSync('/tmp/state-check/state.json', 'utf8'));
const db = openDb('/tmp/state-check/state.db');
console.log(importLegacyState(db, '/tmp/state-check/state.json'));

const fwd = createForwardingStore(db);
const dig = createDigestStore(db);
const rep = createRepliesStore(db);
let bad = 0;
const check = (what, was, now) => { if (was !== now) { bad += 1; console.log('РАСХОЖДЕНИЕ', what, was, '->', now); } };

let checked = 0; let forwarded = 0;
for (const [key, value] of Object.entries(json)) {
  if (key === '_service') continue;
  check(key + '.lastId', value.lastId, fwd.lastId(key));
  check(key + '.digestUpToId', value.digestUpToId, dig.upTo(key));
  const runAt = Number.isInteger(value.digestRunAt) ? value.digestRunAt
    : (Number.isInteger(json._service.lastDigestRunAt) ? json._service.lastDigestRunAt : null);
  check(key + '.digestRunAt', runAt, dig.lastRunAt(key));
  for (const id of value.sent || []) check(key + '.sent:' + id, true, fwd.wasSent(key, id));
  checked += value.checked || 0; forwarded += value.forwarded || 0;
}
check('totals.checked', checked, fwd.totals().checked);
check('totals.forwarded', forwarded, fwd.totals().forwarded);

const replies = json._service.replies || {};
check('replies.enabled', replies.enabled !== false, rep.enabled());
check('replies.botOffset', replies.botOffset || 0, rep.botOffset());
for (const id of replies.answered || []) check('answered:' + id, true, rep.wasAnswered(id));
check('said.length', Math.min((replies.said || []).length, 8), rep.recent(8).length);

console.log(bad === 0 ? 'СВЕРКА ЧИСТАЯ' : 'РАСХОЖДЕНИЙ: ' + bad);
"
```

Expected: `{ imported: true, chats: N }` и `СВЕРКА ЧИСТАЯ`

Затем убедиться, что боевой файл не тронут:

Run: `diff /tmp/state-check/state.json /var/www/www-root/data/www/tg-reader/state.json && echo "боевой файл не изменён"`
Expected: `боевой файл не изменён`

Прибрать за собой: `rm -rf /tmp/state-check`

- [ ] **Шаг 14: `state.js` — прослойка поверх четырёх store, `state.test.js` удаляется**

Заменить `src/state.js` на реализацию поверх SQLite, сохранив ровно тот же набор из 28 методов: `index.js`, `healthcheck.js`, `replier.js`, `bot-commands.js` и `digest-cli.js` на этом шаге не меняются.

```js
const path = require('path');
const { openDb } = require('./platform/db/open');
const { importLegacyState } = require('./platform/db/import-state-json');
const { createForwardingStore } = require('./features/forwarding/store');
const { createDigestStore } = require('./features/digest/store');
const { createRepliesStore } = require('./features/replies/store');

const DB_PATH = process.env.TG_DB_PATH || path.join(__dirname, '..', 'state.db');
const LEGACY_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');
```

Соответствие методов:

| методы `state` | куда уходят |
|---|---|
| `lastId`, `advance`, `wasSent`, `markSent`, `noteSeen`, `lastMessageAt`, `totals` | `createForwardingStore` |
| `digestUpTo`, `setDigestUpTo`, `lastDigestRunAt`, `setDigestRunAt` | `createDigestStore` |
| `repliesEnabled`, `setRepliesEnabled`, `replyCounters`, `noteReply`, `resetReplyCounters`, `wasAnswered`, `noteAnswered`, `recentReplies`, `noteSaid`, `botOffset`, `setBotOffset` | `createRepliesStore` |
| `forwarding`, `setForwarding`, `startedAt`, `setStartedAt`, `probeOkAt`, `setProbeOkAt` | строка `status` через `createStatusWriter` |
| `flush` | пустая функция |

Два места, где прослойка обязана врать в пользу старых вызывающих — до задачи 7:

- `recentReplies()` возвращает `store.recent(8).reverse()`, старейшими первыми: `replier.js:67` делает `said.slice(-echoGuard)` и на обратном порядке взял бы не тот конец.
- `markSent(key, id)` без времени зовёт `commitForward(key, { ids: [id], newestId: null, at: Date.now() })`.

`flush()` пустеет намеренно: батчинг с окном в две секунды существовал ради файла и терял эти две секунды при `kill -9`. Для автоответов это была прямая дорога ко второму ответу на то же сообщение — публично.

**`src/state.test.js` удаляется** (`git rm src/state.test.js`). Он проверял поведение JSON-файла, которого больше нет: `createState(file)` там принимает путь к `.json`, пишет туда и перечитывает. Все восемнадцать его проверок закрыты тестами четырёх store — по одной, без потерь:

| было в `state.test.js` | стало |
|---|---|
| позиция переживает перезапуск | `forwarding/store.test.js` — «курсор двигается только вперёд» + повторное открытие в `open.test.js` |
| позиция только растёт | `forwarding/store.test.js` — «курсор двигается только вперёд» |
| битый файл не роняет запуск | `import-state-json.test.js` — «битый файл не роняет запуск» |
| нечисловые значения игнорируются | `forwarding/store.js` — `advance` отбивает не-целые; тест «курсор двигается только вперёд» |
| отправленное помнится после перезапуска | `replies/store.test.js` — «на сообщение отвечают один раз» и `forwarding/store.test.js` — «отправленное помнится по первичному ключу» |
| память об отправленных ограничена | `forwarding/store.test.js` — «память об отправленных чистится по возрасту» |
| каналы не мешают друг другу | `forwarding/store.test.js` — «отправленное помнится по первичному ключу» (проверка `wasSent('c2', 42) === false`) |
| счётчики, `totals`, `lastMessageAt` | `forwarding/store.test.js` — «счётчики складываются по всем чатам» |
| курсоры и время прогона сводки | `digest/store.test.js` — три теста |
| флаг, бюджеты, `answered`, `said`, `botOffset` | `replies/store.test.js` — восемь тестов |

Итог по числу: минус 18 тестов файла, плюс 4 (`open`) + 9 (`import`) + 9 (`forwarding/store`) + 3 (`digest/store`) + 8 (`replies/store`) + 6 (`status`) = 39.

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -8`
Expected: `# fail 0`

Если падает что-то в `index` или `healthcheck` — искать вызов метода `state`, которого прослойка не отдала. Полный список сверить командой:

Run: `cd /root/tg-reader-refactor && grep -ohrE "state\.[a-zA-Z]+\(" src bin --include=*.js | sort -u`
Expected: каждое имя из вывода присутствует в новом `src/state.js`

- [ ] **Шаг 15: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src tools
git commit -m "$(cat <<'EOF'
Состояние переехало в SQLite: четыре владельца, четыре store

state.json держал курсоры пересылки, курсор сводки, счётчики и — с
приходом автоответов — флаг, бюджеты, два кольцевых буфера и смещение
бота. Писался он целиком: последний writer затирал чужие курсоры, и
лечилось это строкой в README про «остановите сервис».

Теперь у каждого владельца своя таблица. wasSent и wasAnswered — не
поиск в массиве на 300 и 500 элементов, а первичный ключ. Продвижение
курсора и отметка об отправке — одна транзакция. Отложенная запись с
окном в две секунды исчезла: для автоответов её потеря означала второй
ответ на то же сообщение, публично.

Перенос идёт при первом старте, читает state.json только на чтение и
отмечается строкой в meta, а не версией схемы: иначе будущая миграция
схемы перечитала бы давно протухший файл. Файл остаётся на диске
нетронутым и служит откатом на main.

Отдельным тестом закреплено, что выключенные автоответы остаются
выключенными: включить их случайно — значит написать в чужой чат от
имени пользователя. Сверка на копии боевого файла — чистая.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 5: `features/forwarding` — чистое решение отдельно от отправки

`forwarder.handle()` (`forwarder.js:24-81`) делает шесть вещей: считает свежие, отмечает просмотр, ищет совпадения, двигает курсор, отсеивает уже отправленное и трижды пробует отправить. Решение отделяется от исполнения: `logic.js` становится чистой функцией, которую можно проверять без единого фейка.

**Files:**
- Create: `src/features/forwarding/logic.js` + `logic.test.js`
- Create: `src/features/forwarding/job.js` + `job.test.js`
- Move: `src/matcher.js` → `src/features/forwarding/matcher.js` (+ тест)
- Delete: `src/forwarder.js`, `src/forwarder.test.js` (тесты переезжают в `job.test.js`), `src/format.js`

**Interfaces:**
- Consumes: `platform/telegram/fake.js` и `Post` из задачи 3, `createForwardingStore` из задачи 4, `describeHits`/`findHits` из `matcher.js`.
- Produces:
  - `decide({ posts, keywords, lastId, isSent }) -> { fresh, newestId, what, ids, text }`
    - `fresh` — сколько постов новее `lastId` (для `noteSeen`)
    - `newestId` — куда двигать курсор
    - `what` — `describeHits(...)` или `null`, если совпадений нет
    - `ids` — что слать, по возрастанию; пустой, если совпадений нет или всё уже отправлено
    - `text` — склеенные тексты пачки, для запасной копии
  - `createForwardingJob({ gateway, store, keywords, sources, target, notifier, clock, log })` — `{ name: 'forwarding', start(), stop(), handle(posts), backfill(chat), isBehind(chat) }`

- [ ] **Шаг 1: перенести `matcher` без единой правки логики**

```bash
cd /root/tg-reader-refactor
mkdir -p src/features/forwarding
git mv src/matcher.js src/features/forwarding/matcher.js
git mv src/matcher.test.js src/features/forwarding/matcher.test.js
```

Поправить пути импорта у тех, кто его звал: `src/index.js`, `src/scan.js`, `src/forwarder.js`.

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`, число тестов не изменилось

- [ ] **Шаг 2: написать падающий тест чистого решения**

Создать `src/features/forwarding/logic.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { prepare } = require('./matcher');
const { decide } = require('./logic');

const keywords = prepare(['телевизор', 'велосипед']);
const post = (id, text, at = 1000) => ({ id, chatKey: 'c1', at, text, from: '5', author: null, replyTo: null, groupId: null, link: `l${id}` });
const nothingSent = () => false;

test('без совпадений курсор двигается, слать нечего', () => {
  const answer = decide({ posts: [post(10, 'просто болтовня')], keywords, lastId: 5, isSent: nothingSent });
  assert.strictEqual(answer.what, null);
  assert.deepStrictEqual(answer.ids, []);
  assert.strictEqual(answer.newestId, 10);
});

test('совпадение даёт список на отправку и описание', () => {
  const answer = decide({ posts: [post(10, 'продам телевизор')], keywords, lastId: 5, isSent: nothingSent });
  assert.match(answer.what, /телевизор/);
  assert.deepStrictEqual(answer.ids, [10]);
});

test('альбом идёт одной пачкой, решение принимается по склеенному тексту', () => {
  const posts = [post(10, 'продам'), post(11, 'велосипед детский')];
  const answer = decide({ posts, keywords, lastId: 5, isSent: nothingSent });
  assert.match(answer.what, /велосипед/);
  assert.deepStrictEqual(answer.ids, [10, 11]);
  assert.strictEqual(answer.newestId, 11);
});

test('уже отправленное не отправляется снова — правка поста не даёт дубль', () => {
  const posts = [post(10, 'продам телевизор')];
  const answer = decide({ posts, keywords, lastId: 5, isSent: (id) => id === 10 });
  assert.deepStrictEqual(answer.ids, []);
  assert.match(answer.what, /телевизор/, 'совпадение есть, просто слать нечего');
});

test('свежими считаются только те, что новее курсора', () => {
  const posts = [post(4, 'а'), post(5, 'б'), post(6, 'в')];
  assert.strictEqual(decide({ posts, keywords, lastId: 5, isSent: nothingSent }).fresh, 1);
});

test('на первом запуске свежими считаются все', () => {
  const posts = [post(4, 'а'), post(5, 'б')];
  assert.strictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).fresh, 2);
});

test('ids всегда по возрастанию, как бы ни пришла пачка', () => {
  const posts = [post(11, 'велосипед'), post(10, 'продам')];
  assert.deepStrictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).ids, [10, 11]);
});

test('пустые тексты не мешают склейке', () => {
  const posts = [post(10, ''), post(11, 'телевизор')];
  assert.strictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).text, 'телевизор');
});
```

- [ ] **Шаг 3: убедиться, что тест падает, и написать `logic.js`**

Run: `cd /root/tg-reader-refactor && node --test src/features/forwarding/logic.test.js`
Expected: FAIL, `Cannot find module './logic'`

Создать `src/features/forwarding/logic.js`:

```js
const { findHits, describeHits } = require('./matcher');

function decide({ posts, keywords, lastId, isSent }) {
  const text = posts.map((post) => post.text || '').filter(Boolean).join('\n');
  const newestId = Math.max(...posts.map((post) => post.id));
  const fresh = posts.filter((post) => lastId === null || post.id > lastId).length;
  const hits = findHits(text, keywords);

  if (hits.length === 0) return { fresh, newestId, what: null, ids: [], text };

  const ids = posts.filter((post) => !isSent(post.id)).map((post) => post.id).sort((a, b) => a - b);
  return { fresh, newestId, what: describeHits(hits), ids, text };
}

module.exports = { decide };
```

Ни `Date.now()`, ни таймеров, ни I/O: чистая функция от пачки постов и ключевых слов. Проверяется без единого фейка — это и есть критерий приёмки задачи.

Run: `cd /root/tg-reader-refactor && node --test src/features/forwarding/logic.test.js`
Expected: PASS, 8 из 8

- [ ] **Шаг 4: написать работу поверх шлюза и store**

Создать `src/features/forwarding/job.test.js`, перенеся в него проверки из `src/forwarder.test.js` и переписав их на `createFakeGateway` вместо самодельного клиента. Обязательные к сохранению:

```js
test('неудачная отправка двигает курсор, отмечает потерю и шлёт тревогу', async () => {
  // gateway.forward и gateway.sendText оба бросают
  // ожидаем: store.lastId продвинут, в логе ПОТЕРЯНО, notifier.sent содержит 🟠
});

test('не удалась пересылка — уходит копия текстом', async () => {
  // gateway.forward бросает, sendText работает
  // ожидаем: sendText вызван, курсор продвинут, wasSent === true
});

test('одно и то же сообщение не уходит дважды при гонке', async () => {
  // handle() вызывается дважды подряд без await между ними
  // ожидаем: ровно одна отправка
});
```

Поведение при неудачной отправке переносится дословно (`forwarder.js:71-77`): курсор двигается, сообщение считается потерянным, уходит тревога. Это осознанное решение — переслать позже нельзя, а зависший курсор остановил бы канал целиком.

Создать `src/features/forwarding/job.js`. Внутри:

- `handle(posts)` — `decide(...)`, затем `store.noteSeen`, затем либо `store.advance`, либо попытка отправки в три яруса: `gateway.forward` → `gateway.sendText` копией → тревога. Успех любого яруса завершается одним `store.commitForward(chatKey, { ids, newestId, at: clock.now() })`.
- `inFlight` — тот же `Set` ключей `chatKey:id`, что и сегодня (`forwarder.js:21`): защищает от гонки между событием и догрузкой.
- `backfill(chat)` — `gateway.recent(chat, { limit, afterId: store.lastId(key) })`, группировка по `groupId` и `handle` по группе. Разворачивать порядок больше не нужно: `recent` отдаёт по возрастанию.
- `isBehind(chat)` — `gateway.recent(chat, { limit: 1 })` и сравнение с курсором.
- `start()` — подписка `gateway.onPost` с фильтром по `sources`, затем `backfill` каждого источника.
- `stop()` — отписка.

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`

- [ ] **Шаг 5: снять `forwarder.js` и `format.js`**

`git rm src/forwarder.js src/forwarder.test.js src/format.js`. В `src/index.js` заменить `createForwarder` на `createForwardingJob`, а `require('./format')` — на `require('./platform/telegram/text')` там, где он ещё остался.

Run: `cd /root/tg-reader-refactor && grep -rn "forwarder\|require('./format')" src bin --include=*.js`
Expected: пусто

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`

- [ ] **Шаг 6: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src
git commit -m "$(cat <<'EOF'
Пересылка: решение отделено от отправки

forwarder.handle делал шесть вещей разом. Теперь decide() — чистая
функция от пачки постов и ключевых слов: она отвечает, что переслать,
куда двинуть курсор и сколько постов считать свежими. Ни Date.now, ни
таймеров, ни сети — восемь тестов на неё написаны без единого фейка.

Отправка осталась в job.js: три яруса, inFlight от гонок, догрузка
пропущенного. Поведение при неудаче не тронуто — курсор двигается,
сообщение считается потерянным, уходит тревога: зависший курсор
остановил бы канал целиком.

Разворачивание истории из job.js ушло: gateway.recent отдаёт по
возрастанию id, и делать это руками больше негде.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 6: `features/digest` и `platform/llm`

Разбирает `news.js` — фабрику, которая берёт параметры и тут же лезет к глобалу в шести местах (`news.js:37-70`). И выносит вызов модели в платформу: без этого задача 7 не сможет разорвать связь `replies → digest`.

**Files:**
- Create: `src/platform/llm/anthropic.js` + `anthropic.test.js`
- Create: `src/platform/llm/fake.js`
- Create: `src/features/digest/prompt.js` + `prompt.test.js`
- Create: `src/features/digest/logic.js` + `logic.test.js`
- Create: `src/features/digest/job.js` + `job.test.js`
- Move: `src/digest-render.js` → `src/features/digest/render.js` (+ тест)
- Delete: `src/news.js`, `src/summarizer.js`, `src/summarizer.test.js`, `src/digest.js`, `src/digest.test.js`

**Interfaces:**
- Consumes: шлюз и `Post` из задачи 3, `createDigestStore` из задачи 4.
- Produces:
  - `createLlm({ apiKey, request }) -> { call({ model, system, messages, schema, maxTokens }) -> { json, text, usage }, estimateCost(model, inputTokens, outputTokens) -> number|null }`
  - `createFakeLlm({ answers })` — та же форма, для тестов фич.
  - `features/digest/prompt.js`: `systemPrompt(maxItems)`, `SCHEMA`, `clampSummary(summary, maxItems)`.
  - `features/digest/logic.js`: `due({ sources, store, now, hour, timeZone })`, `toItems(posts, { since, maxMessages, includeLinks })`.
  - `createDigestJob({ gateway, store, llm, clock, config, notify, log })` — `{ name: 'digest', start(), stop(), run({ dryRun }) }`.

- [ ] **Шаг 1: вынести вызов модели в платформу**

Создать `src/platform/llm/anthropic.js`. Внутрь переезжают из `summarizer.js`: `PRICES`, `estimateCost`, `ATTEMPTS = 3`, `RETRY_PAUSE_MS = 5000` и вся логика повторов на 429 и 5xx. Наружу — единственный метод `call`, скрывающий форму запроса Anthropic SDK:

```js
async call({ model, system, messages, schema, maxTokens }) {
  const response = await request({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
  });
  return { json: parseJson(response), text: textOf(response), usage: response.usage || {} };
}
```

`estimateCost(model, inputTokens, outputTokens)` — три аргумента, как сегодня в `summarizer.js`, а не `(model, usage)`.

`src/platform/llm/anthropic.test.js` — перенести из `summarizer.test.js` проверки повторов: 429 приводит к повтору, три неудачи подряд бросают, `estimateCost` для незнакомой модели даёт `null`.

Создать `src/platform/llm/fake.js`: `createFakeLlm({ answers })` отдаёт заготовленные ответы по кругу и копит `calls` — им пользуются тесты и сводки, и автоответов.

- [ ] **Шаг 2: разобрать `summarizer.js` на промпт и логику**

`systemPrompt`, `SCHEMA`, `clampSummary` переезжают в `src/features/digest/prompt.js` **дословно** — тексты промпта не меняются. Оставшаяся часть `createSummarizer` (повторы, разбор) исчезает: её работу делает `llm.call`.

Тесты из `summarizer.test.js`, проверяющие текст промпта и обрезку, переезжают в `prompt.test.js` со сменой пути импорта.

- [ ] **Шаг 3: собрать `logic.js`**

`toItems` переезжает из `digest.js:11-22`, но принимает `Post[]`, а не сообщения gramjs: `msg.date * 1000` больше не нужно (`post.at` уже в миллисекундах), `msg.message` становится `post.text`, `linkTo(source, msg.id)` становится `post.link`.

`due` собирается из `news.js:62-69`: `sources.some((chat) => isDue(now, { hour, timeZone, lastRunAt: store.lastRunAt(chat.key) }))`.

Обе функции чистые. `logic.test.js` проверяет: окно суток на первом прогоне (`since = now - DAY_MS`), отсечение по `afterId` на последующих, `maxMessages` режет с конца, `includeLinks` добавляет и убирает поле `link`, `due` ложно до часа и истинно после, `due` ложно второй раз в те же сутки.

- [ ] **Шаг 4: собрать `job.js`**

`runDigest` переезжает из `digest.js:24-90`, `resolveNewsSources` — из `news.js:23-35`. Все шесть обращений к глобалу (`config.news.model`, `maxItems`, `maxMessages`, `timeZone`, `links`, `hour`) становятся полями объекта, переданного в `createDigestJob`.

Поведение сохраняется дословно, включая два места, которые легко потерять:

- `state.setDigestRunAt(key, now)` вызывается **до** попытки собрать сводку и **не** вызывается при `dryRun` (`digest.js:47`). Иначе упавшая сводка повторялась бы каждые десять минут до полуночи.
- `setDigestUpTo` вызывается **после** успешной отправки, а не после сборки (`digest.js:81`).

- [ ] **Шаг 5: снять старые модули и прогнать всё**

```bash
cd /root/tg-reader-refactor
git mv src/digest-render.js src/features/digest/render.js
git mv src/digest-render.test.js src/features/digest/render.test.js
git rm src/news.js src/summarizer.js src/summarizer.test.js src/digest.js src/digest.test.js
```

Поправить `src/index.js` и `src/digest-cli.js` на новые пути. `src/responder.js` временно берёт `estimateCost` из `platform/llm/anthropic` — до задачи 7, где он переедет целиком.

Run: `cd /root/tg-reader-refactor && grep -rn "require('./news')\|require('./summarizer')\|require('./digest')" src bin --include=*.js`
Expected: пусто

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`

- [ ] **Шаг 6: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src
git commit -m "$(cat <<'EOF'
Сводка разобрана, вызов модели вынесен в платформу

news.js был фабрикой, которая берёт параметры и тут же лезет к глобалу в
шести местах: модель, потолки, зона, ссылки, час. Теперь это поля, а
фабрика честная.

Вызов Anthropic вместе с повторами на 429, таймаутами и estimateCost
уехал в platform/llm. Это нужно не сводке — сводке было и так неплохо, —
а автоответам: сегодня они берут createAnthropicCall у news.js и
estimateCost у summarizer.js, то есть транспорт живёт внутри чужой фичи.
Задача 7 разрывает эту связь, и без платформы рвать было бы нечем.

Два места, которые легко потерять при переносе, закреплены тестами:
время прогона ставится до сборки и не ставится при dry-run, а курсор
двигается только после успешной отправки.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 7: `features/replies` и двусторонний `platform/notify`

Самая осторожная задача плана: эта фича пишет публично от аккаунта пользователя. **Ни одно правило молчания, ни один потолок и ни одна строка промпта не меняются.** Страховка — 110 существующих тестов (`replier` 35, `responder` 27, `reply-rules` 20, `bot-commands` 12, `repetition` 8, `voice` 8), которые обязаны пройти после переезда без правок в утверждениях.

Здесь же включается правило 2, нарушенное сегодня трижды: `responder.js:1` берёт `estimateCost` у `summarizer.js`, `index.js:17` и `replies-cli.js:6` берут `createAnthropicCall` у `news.js`.

**Files:**
- Move: `src/reply-rules.js` → `src/features/replies/rules.js` (+ тест)
- Move: `src/repetition.js` → `src/features/replies/repetition.js` (+ тест)
- Create: `src/features/replies/logic.js` + `logic.test.js` (из `replier.js`)
- Create: `src/features/replies/job.js` + `job.test.js` (из `replier.js`)
- Create: `src/features/replies/prompt.js` + `prompt.test.js` (из `responder.js`)
- Create: `src/features/replies/voice.js` + `voice.test.js`
- Create: `src/features/replies/commands.js` + `commands.test.js` (из `bot-commands.js`)
- Create: `src/platform/json-file.js`
- Create: `src/platform/notify/telegram-bot.js` + `telegram-bot.test.js`
- Create: `src/platform/notify/fake.js`
- Modify: `tools/boundaries.test.js` (включается правило 2)
- Delete: `src/replier.js`, `src/responder.js`, `src/bot-commands.js`, `src/voice.js`, `src/notify.js` и их тесты (переезжают)

**Interfaces:**
- Consumes: шлюз из задачи 3, `createRepliesStore` из задачи 4, `createLlm` из задачи 6, `createClock` из задачи 3.
- Produces:
  - `features/replies/prompt.js`: `systemPrompt({ samples, maxChars, mode, name, avoid })`, `SCHEMA`, `clampText(text, maxChars)`, `buildUserMessage({ window, trigger })`, `parseReply(json, { window, trigger, maxChars }) -> { reply, text, replyToId }`.
  - `features/replies/logic.js`: `isAddressed`, `decideAddressed`, `decideSpontaneous` (реэкспорт из `rules.js`) плюс `nextFromQueue({ queue, now, staleAfterMs, ownerSaidAt, ownerCancel })`.
  - `features/replies/voice.js`: `pickSamples(messages, { limit, minWords, maxChars })` — чистая.
  - `features/replies/commands.js`: `commandOf(text) -> 'stop' | 'start' | 'status' | 'reset' | null`, `applyCommand(command, store, { day }) -> { reply: string }`.
  - `platform/json-file.js`: `readJson(file, fallback)` — единственное место, где фича читает файл.
  - `platform/notify/telegram-bot.js`: `createNotifier({ token, chatId, request, log }) -> { enabled, send(text, { buttons, replyTo }) -> boolean, updates(offset) -> { updates, nextOffset } }`.

- [ ] **Шаг 1: перенести чистые модули без правок**

```bash
cd /root/tg-reader-refactor
mkdir -p src/features/replies
git mv src/reply-rules.js src/features/replies/rules.js
git mv src/reply-rules.test.js src/features/replies/rules.test.js
git mv src/repetition.js src/features/replies/repetition.js
git mv src/repetition.test.js src/features/replies/repetition.test.js
```

В тестах поправить только пути импорта. Ни одно утверждение не трогать.

Run: `cd /root/tg-reader-refactor && node --test src/features/replies/`
Expected: PASS, 28 из 28 (20 правил + 8 повторов)

- [ ] **Шаг 2: свести Bot API в один порт**

Сегодня в проекте три собственных `https`-клиента: `notify.js:1`, `bot-commands.js:1`, `alert-setup.js:1`. Первые два сводятся в `platform/notify/telegram-bot.js`.

Создать `src/platform/notify/telegram-bot.js`, перенеся `httpsPostJson` из `notify.js:1-31` (он и в `bot-commands.js:6-34` тот же), метод `send` — из `notify.js:33-60` вместе с кнопками, и добавив чтение:

```js
async updates(offset) {
  if (!token) return { updates: [], nextOffset: offset };
  const result = await request(api('getUpdates'), { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  const updates = (result && result.result) || [];
  const nextOffset = updates.length ? updates[updates.length - 1].update_id + 1 : offset;
  return { updates, nextOffset };
}
```

`telegram-bot.test.js` — перенести 6 тестов из `notify.test.js` и дописать: `updates` отдаёт следующий `offset` на единицу больше последнего `update_id`; пустой ответ не двигает `offset`; отсутствие токена не роняет и отдаёт пустой список.

Создать `src/platform/notify/fake.js`: `createFakeNotifier()` копит `sent` и отдаёт заготовленные `updates`.

- [ ] **Шаг 3: разобрать `bot-commands.js` на команду и транспорт**

Чистая часть — в `src/features/replies/commands.js`: `commandOf(text)` переезжает из `bot-commands.js:36-43` дословно, вместе со всеми написаниями (`стоп`, `старт`, `статус`, `сброс`, `/stop`, `/start`, `/status`). Рядом — `applyCommand(command, store, { day })`, возвращающая текст ответа; сегодня это тело `poll()` (`bot-commands.js:60-133`), перемешанное с HTTP.

`commands.test.js` — 12 тестов из `bot-commands.test.js`, у которых меняются только пути и способ подставить хранилище (store вместо `state`).

Опрос (`start(intervalMs)`, `bot-commands.js:135-141`) исчезает как отдельная сущность: его место — работа `replies` в задаче 9, где таймер создаётся через `clock` и снимается при остановке. Сегодня дескриптор возвращается и тут же выбрасывается вызывающим (`index.js:300-306`), то есть остановить опрос нельзя в принципе.

- [ ] **Шаг 4: разобрать `responder.js` на промпт и вызов**

`systemPrompt`, `SCHEMA`, `clampText`, `buildUserMessage`, `textOf` переезжают в `src/features/replies/prompt.js` **дословно** — ни одна строка промпта не меняется. Разбор ответа (`responder.js:126-146`) становится чистой `parseReply(json, { window, trigger, maxChars })`, которую можно проверить без сети.

Вызов модели и лог стоимости уходят в работу и идут через `llm.call` из задачи 6. Импорта `estimateCost` из `summarizer.js` больше нет — это первое из трёх нарушений правила 2.

`prompt.test.js` — 27 тестов из `responder.test.js`. Те, что подставляли `createMessage`, теперь подставляют `createFakeLlm`.

- [ ] **Шаг 5: разобрать `replier.js` на решение и работу**

В `src/features/replies/logic.js` — всё, что решает, и ничего, что делает: разбор очереди отложенных, проверка «не написал ли хозяин сам», склейка окна, отсев ботов и своих сообщений.

В `src/features/replies/job.js` — таймеры через `clock`, вызов модели, отправка через `gateway.sendText`, копия в личку через notifier с кнопкой.

**Две ловушки, обе от задачи 4:**

1. `store.recent(limit)` отдаёт **новейшими первыми**, а `state.recentReplies()` отдавал старейшими. В `replier.js:67` стоит `repeatsRecent(composed.text, said.slice(-echoGuard))` — на новом порядке `.slice(-echoGuard)` возьмёт не тот конец и защита от повторов молча перестанет работать. Правильно: `repeatsRecent(text, store.recent(echoGuard))`, без `slice`.
2. `state.flush()` больше ничего не делает. Если где-то в `replier.js` есть расчёт на отложенную запись — его нет, каждая запись в SQLite и так транзакция.

`job.test.js` — 35 тестов из `replier.test.js`. Подстановки: `createFakeGateway` вместо клиента, `createRepliesStore` поверх временной базы вместо `state`, `createManualClock` вместо реального времени, `createFakeLlm` вместо модели. Утверждения — без правок.

Отдельно закрепить тестом то, что сегодня работает по случайности: очередь отложенных ответов живёт в памяти и при `stop()` теряется намеренно. Отложенный ответ, отправленный после перезапуска, пришёл бы в разговор, который давно ушёл вперёд.

```js
test('очередь отложенных ответов при остановке бросается намеренно', async () => {
  const { job, clock, gateway } = bench();
  await job.start();
  gateway.emit({ chatRef: '@one', id: 700, text: 'эй, ты тут?', from: '5' });
  await job.stop();
  clock.advance(10 * 60 * 1000);
  assert.deepStrictEqual(gateway.sent, [], 'после остановки не должно уйти ничего');
});
```

- [ ] **Шаг 6: разобрать `voice.js`**

`pickSamples` (`voice.js:6-21`) переезжает в `src/features/replies/voice.js` без правок — она чистая. Чтение файла (`voice.js:23-33`) уходит в `src/platform/json-file.js`:

```js
const fs = require('fs');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

module.exports = { readJson };
```

Путь `voice.json` не меняется: это файл пользователя.

- [ ] **Шаг 7: включить правило 2 — фича не импортирует фичу**

Дописать в `tools/boundaries.test.js`:

```js
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
```

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: PASS — все три сегодняшних нарушения сняты задачами 6 и 7

- [ ] **Шаг 8: прогнать всё и сверить, что тестов автоответов не убыло**

Run: `cd /root/tg-reader-refactor && node --test src/features/replies/ 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: не меньше 110 тестов, `# fail 0`

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`

Если тестов автоответов стало меньше 110 — какой-то файл потерялся при переезде. Сверить: `git log --stat -1` покажет каждый `git mv`.

- [ ] **Шаг 9: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src tools
git commit -m "$(cat <<'EOF'
Автоответы стали слайсом, порт уведомлений — двусторонним

Фича, которая пишет публично от аккаунта пользователя, переехала без
единой правки в правилах молчания, потолках и промпте. Проверяется это
110 тестами, переехавшими вместе с ней: утверждения в них не тронуты,
менялись только пути и подстановки.

Правило 2 включено: фича больше не ходит к фиче за платформой. Ушли все
три нарушения — estimateCost из summarizer, createAnthropicCall из news
дважды. Bot API свёлся в один порт: два самодельных https-клиента из
notify.js и bot-commands.js стали одним, и он теперь умеет не только
писать, но и читать.

Две ловушки от переезда на SQLite закрыты тестами. Store отдаёт последние
реплики новейшими первыми, а не старейшими, — на старом slice(-echoGuard)
защита от повторов молча перестала бы работать. И очередь отложенных
ответов теперь бросается при остановке явно, а не потому, что процесс
убили: ответ, доехавший после перезапуска, пришёл бы в разговор, который
давно ушёл вперёд.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 8: `features/health` и healthcheck поверх контракта `status`

Сегодня `healthcheck.js:49` открывает `state.json` работающего сервиса и читает его кишки — включая поле `probeOkAt`, которое приехало вместе с автоответами. После задачи он читает одну версионированную строку в режиме read-only и не знает ни одной внутренней таблицы.

**Files:**
- Move: `src/health.js` → `src/features/health/rules.js` (+ тест)
- Move: `src/message.js` → `src/features/health/alert-text.js` (+ тест)
- Create: `src/features/health/memory.js` + `memory.test.js`
- Create: `src/platform/systemd.js`
- Create: `bin/healthcheck.js`
- Modify: `tools/boundaries.test.js` (включается правило 5)
- Delete: `src/healthcheck.js`, `src/notify.js`

**Interfaces:**
- Consumes: `readStatus` и `STATUS_CONTRACT` из задачи 4, `createNotifier` из задачи 7.
- Produces:
  - `features/health/rules.js`: `decide(snapshot, memory, thresholds)` — без изменений.
  - `features/health/memory.js`: `loadMemory(file)`, `saveMemory(file, memory)`, `EMPTY_MEMORY`.
  - `platform/systemd.js`: `unitStatus(name) -> { activeState, restarts }`, `parseUnitStatus(text)`.

- [ ] **Шаг 1: перенести чистые модули**

```bash
cd /root/tg-reader-refactor
mkdir -p src/features/health
git mv src/health.js src/features/health/rules.js
git mv src/health.test.js src/features/health/rules.test.js
git mv src/message.js src/features/health/alert-text.js
git mv src/message.test.js src/features/health/alert-text.test.js
```

Из `rules.js` вынести `parseUnitStatus` в `src/platform/systemd.js` вместе с `unitStatus` (`healthcheck.js:34-45`, `execFileSync`). Тесты `parseUnitStatus` переехать туда же.

- [ ] **Шаг 2: вынести собственную память тревог**

`loadMemory`/`saveMemory`/`EMPTY_MEMORY` (`healthcheck.js:12-32`) переезжают в `src/features/health/memory.js`, принимая путь параметром.

`alert-state.json` **остаётся файлом** и не переезжает в базу. У него единственный писатель — сам healthcheck, гонки нет, контракта ни с кем нет. Тащить его в общее хранилище значило бы заново смешать владельцев — ровно ту ошибку, ради исправления которой всё затевается.

`memory.test.js`: пустой файл даёт `EMPTY_MEMORY`; битый файл даёт `EMPTY_MEMORY`, а не бросает; запись атомарна через `.tmp` + `rename`; незнакомые поля из файла не затирают известные.

- [ ] **Шаг 3: написать `bin/healthcheck.js` поверх контракта**

Собрать из `healthcheck.js:47-100`, заменив `createState()` на `readStatus(dbFile)`:

```js
const result = readStatus(dbFile);
if (!result.ok) {
  const text = `🔴 tg-reader: не читается состояние сервиса — ${result.reason}`;
  console.log(text);
  await notifier.send(text);
  process.exit(0);
}
```

`snapshot` собирается из `result.status`, а `since` — из тех же трёх полей, что сегодня (`healthcheck.js:52-56`), только теперь они называются в контракте: `Math.max(status.lastPostAt || 0, status.startedAt || 0, status.probeOkAt || 0)`.

Дописать проверку, которой сегодня нет вовсе:

```js
const statusAgeMs = now - result.status.updatedAt;
if (statusAgeMs > thresholds.stallMs) {
  // сервис не пишет статус — это зависший event loop, а не тишина в канале
}
```

Сегодня такой случай выглядит для мониторинга здоровым: `systemctl` показывает `active`, а данные молча не обновляются.

`bin/healthcheck.js` замок сессии не берёт: он в Telegram не ходит.

- [ ] **Шаг 4: включить правило 5 — `process.exit` только в `bin/`**

Дописать в `tools/boundaries.test.js`:

```js
test('правило 5: process.exit живёт только в bin', () => {
  const guilty = jsFilesUnder(srcRoot).filter((rel) =>
    hasProcessExit(fs.readFileSync(path.join(srcRoot, rel), 'utf8'))
  );
  assert.deepStrictEqual(guilty, [], `ниже bin положено бросать, а не выходить: ${guilty.join(', ')}`);
});
```

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: FAIL со списком — на этот момент `process.exit` ещё есть в `src/index.js`, `src/scan.js`, `src/login.js`, `src/alert-setup.js`, `src/digest-cli.js`, `src/replies-cli.js`, `src/config.js`.

Правило зелёным станет в задаче 9, когда все эти файлы переедут в `bin/`. Тест дописывается **здесь**, чтобы задача 9 не могла закончиться, не убрав их: это её механический критерий приёмки.

Пометить тест как ожидаемо падающий на один коммит нельзя — ветка обязана быть зелёной. Поэтому: дописать тело теста, но зарегистрировать его через `test.skip` с комментарием-именем `'правило 5 (включается в задаче 9): process.exit живёт только в bin'`, и в задаче 9 первым же шагом снять `skip`.

- [ ] **Шаг 5: прогнать всё**

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -6`
Expected: `# fail 0`, один пропущенный

Run: `cd /root/tg-reader-refactor && grep -rn "createState\|state.json" src/features/health bin/healthcheck.js`
Expected: пусто — healthcheck не знает ни про старый файл, ни про внутренние таблицы

- [ ] **Шаг 6: коммит**

```bash
cd /root/tg-reader-refactor
git add -A src bin tools
git commit -m "$(cat <<'EOF'
Healthcheck читает контракт, а не кишки чужого процесса

Проверка открывала state.json работающего сервиса и читала его напрямую —
а с приходом автоответов стала читать оттуда на одно поле больше.
Незаявленный контракт между процессами рос сам собой, никем не описанный.

Теперь это одна строка status, открытая только на чтение, с полем
contract: незнакомая версия — честный отказ, а не молчаливое согласие
считать её застоем.

Появилась проверка, которой не было вовсе: если updated_at старше порога
застоя, сервис не пишет статус. Это зависший event loop, и сегодня он
выглядит для мониторинга здоровым, потому что systemctl показывает active.

alert-state.json остался файлом. У него единственный писатель и ни с кем
нет контракта; тащить его в общее хранилище значило бы заново смешать
владельцев.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

---

## Задача 9: рантайм, замок сессии и точки входа

Последняя задача и единственная, меняющая точку входа. До неё внезапный перезапуск сервиса поднимал бы рабочий `src/index.js` — здесь он исчезает, поэтому задача завершается действием владельца, а не автоматически.

**Files:**
- Create: `src/runtime/host.js` + `host.test.js`
- Create: `src/runtime/shutdown.js`
- Move: `src/watchdog.js` → `src/runtime/watchdog.js` (+ тест)
- Move: `src/async.js` → `src/shared/async.js`, `src/cli-args.js` → `src/shared/cli-args.js` (+ тесты)
- Move: `src/envfile.js` → `src/platform/env-file.js` (+ тест)
- Create: `src/platform/lock.js` + `lock.test.js`
- Create: `bin/serve.js`, `bin/scan.js`, `bin/digest.js`, `bin/replies.js`, `bin/login.js`, `bin/alert-setup.js`
- Move: `bin/export-voice.js` → `bin/voice.js`
- Modify: `package.json` (все `scripts`), `README.md`, `tg-reader.service`
- Modify: `tools/boundaries.test.js` (снимается `skip` с правила 5, включаются правила 1 и 3)
- Delete: `src/index.js`, `src/config.js`, `src/preflight.js`, `src/client.js`, `src/peer.js`, `src/state.js`, `src/scan.js`, `src/login.js`, `src/alert-setup.js`, `src/digest-cli.js`, `src/replies-cli.js`

**Interfaces:**
- Consumes: всё, что построено задачами 2-8.
- Produces:
  - `createHost({ log, notifier }) -> { add(job), start(), stop() }`; работа — `{ name, start(), stop() }`.
  - `installShutdown({ host, db, gateway, clock, log }) -> void`.
  - `takeLock(file, { pid = process.pid } = {}) -> { ok: true, release() } | { ok: false, holder }`.

- [ ] **Шаг 1: снять `skip` с правила 5 и увидеть красное**

В `tools/boundaries.test.js` заменить `test.skip(` на `test(` у правила 5.

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: FAIL со списком семи файлов. Это список работы задачи.

- [ ] **Шаг 2: написать тест хоста работ**

Создать `src/runtime/host.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createHost } = require('./host');

const job = (name, hooks = {}) => ({
  name,
  started: false,
  stopped: false,
  async start() { this.started = true; if (hooks.onStart) await hooks.onStart(); },
  async stop() { this.stopped = true; if (hooks.onStop) await hooks.onStop(); },
});

test('хост запускает все работы', async () => {
  const host = createHost({ log: () => {} });
  const a = job('a');
  const b = job('b');
  host.add(a); host.add(b);
  await host.start();
  assert.ok(a.started && b.started);
});

test('падение одной работы при старте не роняет остальные', async () => {
  const logged = [];
  const alerts = [];
  const host = createHost({ log: (line) => logged.push(line), notifier: { send: async (t) => alerts.push(t) } });
  const bad = job('плохая', { onStart: async () => { throw new Error('канал не открылся'); } });
  const good = job('хорошая');
  host.add(bad); host.add(good);
  await host.start();
  assert.strictEqual(good.started, true, 'исправная работа обязана подняться');
  assert.match(logged.join('\n'), /плохая/);
  assert.match(alerts.join('\n'), /плохая/);
});

test('stop останавливает всё, даже если одна работа бросила', async () => {
  const host = createHost({ log: () => {} });
  const bad = job('плохая', { onStop: async () => { throw new Error('не смогла'); } });
  const good = job('хорошая');
  host.add(bad); host.add(good);
  await host.start();
  await host.stop();
  assert.strictEqual(good.stopped, true);
});

test('stop без start ничего не ломает', async () => {
  const host = createHost({ log: () => {} });
  host.add(job('a'));
  await assert.doesNotReject(() => host.stop());
});
```

Run: `cd /root/tg-reader-refactor && node --test src/runtime/host.test.js`
Expected: FAIL, `Cannot find module './host'`

Реализовать `src/runtime/host.js`. Это снимает дефект `index.js:82`, где неоткрывшийся канал пересылки убивал заодно и сводку, и автоответы.

Run: тот же — Expected: PASS, 4 из 4

- [ ] **Шаг 3: написать замок сессии**

Создать `src/platform/lock.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { takeLock } = require('./lock');

const tempLock = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')), 'tg.lock');

test('свободный замок берётся', () => {
  const taken = takeLock(tempLock());
  assert.strictEqual(taken.ok, true);
  taken.release();
});

test('занятый живым процессом замок не отдаётся', () => {
  const file = tempLock();
  const first = takeLock(file);
  const second = takeLock(file);
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.holder, process.pid);
  first.release();
});

test('после release замок свободен', () => {
  const file = tempLock();
  takeLock(file).release();
  assert.strictEqual(takeLock(file).ok, true);
});

test('протухший замок мёртвого процесса перехватывается', () => {
  const file = tempLock();
  fs.writeFileSync(file, '999999');
  assert.strictEqual(takeLock(file).ok, true, 'pid, которого нет, не должен держать сессию вечно');
});

test('мусор вместо pid не блокирует запуск навсегда', () => {
  const file = tempLock();
  fs.writeFileSync(file, 'непонятно что');
  assert.strictEqual(takeLock(file).ok, true);
});
```

Реализовать `src/platform/lock.js`: создание через `fs.openSync(file, 'wx')`, внутри pid; при `EEXIST` — прочитать pid и проверить живость через `process.kill(pid, 0)`; мёртвый или нечитаемый pid — забрать замок.

Замок именно файловый, а не строка в таблице: он обязан переживать `kill -9` и не зависеть от того, открылась ли база.

Run: `cd /root/tg-reader-refactor && node --test src/platform/lock.test.js`
Expected: PASS, 5 из 5

- [ ] **Шаг 4: перенести оставшиеся модули**

```bash
cd /root/tg-reader-refactor
mkdir -p src/runtime src/shared
git mv src/watchdog.js src/runtime/watchdog.js
git mv src/watchdog.test.js src/runtime/watchdog.test.js
git mv src/async.js src/shared/async.js
git mv src/async.test.js src/shared/async.test.js
git mv src/cli-args.js src/shared/cli-args.js
git mv src/cli-args.test.js src/shared/cli-args.test.js
git mv src/envfile.js src/platform/env-file.js
git mv src/envfile.test.js src/platform/env-file.test.js
```

`watchdog.js` по логике не меняется — он уже чистый и покрыт тестами. Меняются источник времени (`clock.now` вместо `Date.now`) и способ создания таймеров (`clock.every` вместо `setInterval`), чтобы дескрипторы собирал хост.

- [ ] **Шаг 5: написать `bin/serve.js`**

Точка входа сводится к четырём шагам: разобрать argv, `loadConfig`, собрать, выполнить.

```js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig, serviceSetup } = require('../src/platform/config');
const { prepare, summary, unknownGroups } = require('../src/features/forwarding/matcher');
const keywords = require('../keywords');
// ... остальные сборки

async function main() {
  const { config, errors } = loadConfig(process.env);
  if (errors.length) return fail(errors.join('\n'));

  const prepared = prepare(keywords, config.disabledGroups);
  const setup = serviceSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount: prepared.length,
    anthropicKey: config.anthropicKey,
    newsChannels: config.news.channels,
    repliesChat: config.replies.chat,
    repliesEnabled: config.replies.enabled,
  });
  if (setup.error) return fail(setup.error);
  if (setup.warning) console.error(setup.warning);
  for (const name of unknownGroups(config.disabledGroups, keywords)) {
    console.error(`В DISABLED_GROUPS указана неизвестная группа «${name}» — проверьте написание в keywords.js`);
  }

  const lock = takeLock(path.join(__dirname, '..', 'run', 'tg.lock'));
  if (!lock.ok) return fail(`Сессия занята: сервис работает (pid ${lock.holder}), остановите его`);
  // ...
}
```

Хост собирает четыре работы:

```js
host.add(createForwardingJob({ ... }));
host.add(createDigestJob({ ... }));
host.add(createRepliesJob({ ... }));
host.add(createStatusJob({ ... }));
await host.start();
```

Работа `status` — отдельная, раз в 30 секунд. Отдельная потому, что свежий `updated_at` нужен и когда пересылка выключена, и когда в канале тишина.

Мутабельные `let client` / `let forwarder` и позднее связывание исчезают: `forceReconnect` становится методом работы, владеющей своим состоянием. `installShutdown` вешает SIGINT/SIGTERM, зовёт `host.stop()`, `clock.cancelAll()`, закрывает базу, отключает шлюз и снимает замок. Процесс завершается сам; `setTimeout(() => process.exit(code), 3000)` остаётся страховкой в `bin/serve.js`, а не механизмом выхода.

- [ ] **Шаг 6: перенести остальные точки входа**

```bash
cd /root/tg-reader-refactor
git mv src/scan.js bin/scan.js
git mv src/login.js bin/login.js
git mv src/alert-setup.js bin/alert-setup.js
git mv src/digest-cli.js bin/digest.js
git mv src/replies-cli.js bin/replies.js
git mv bin/export-voice.js bin/voice.js
git rm src/index.js src/config.js src/preflight.js src/client.js src/peer.js src/state.js
```

Каждая точка входа переписывается на четыре шага. Блок «подключись, проверь авторизацию, иначе выход», сегодня продублированный в `scan.js:31-35`, `digest-cli.js:67-71`, `replies-cli.js` и `export-voice.js:28-32`, становится одной функцией сборки — общей для всех `bin/*`, которые ходят в Telegram.

Замок берут все, кто подключается к Telegram: `serve`, `scan`, `digest`, `replies`, `voice`, `login`. Не взял — печатает «Сессия занята: сервис работает (pid N), остановите его» и выходит с ненулевым кодом. Это переносит строку README в исполняемый код: раньше «остановите сервис — одна сессия за раз» было документацией, теперь это отказ. `bin/healthcheck.js` замок не берёт.

Обновить `package.json`:

```json
"scripts": {
  "login": "node bin/login.js",
  "start": "node --disable-warning=ExperimentalWarning bin/serve.js",
  "scan": "node bin/scan.js",
  "health": "node --disable-warning=ExperimentalWarning bin/healthcheck.js",
  "digest": "node --disable-warning=ExperimentalWarning bin/digest.js",
  "alert-setup": "node bin/alert-setup.js",
  "test": "node --test",
  "replies": "node --disable-warning=ExperimentalWarning bin/replies.js",
  "voice": "node bin/voice.js"
}
```

`--disable-warning=ExperimentalWarning` нужен там, где открывается база: `node:sqlite` иначе печатает предупреждение в stderr при каждом запуске, и `journalctl` заполняется им.

- [ ] **Шаг 7: включить правила 1 и 3**

Дописать в `tools/boundaries.test.js`:

```js
const FORBIDDEN_IN_FEATURES = ['telegram', '@anthropic-ai/sdk', 'node:sqlite', 'sqlite', 'fs', 'node:fs', 'https', 'node:https', 'child_process', 'node:child_process', 'dotenv'];

test('правило 1: фича не знает ни библиотек, ни ввода-вывода', () => {
  const guilty = [];
  for (const [file, imports] of importsBySrcFile()) {
    if (!file.startsWith('features/')) continue;
    if (file.endsWith('.test.js')) continue;
    for (const name of imports) {
      if (FORBIDDEN_IN_FEATURES.includes(name) || name.startsWith('telegram/')) guilty.push(`${file} -> ${name}`);
    }
  }
  assert.deepStrictEqual(guilty, [], `фичам положено ходить только в platform и shared: ${guilty.join(', ')}`);
});

test('правило 3: платформа не знает про фичи', () => {
  const guilty = [];
  for (const [file, imports] of importsBySrcFile()) {
    if (!file.startsWith('platform/')) continue;
    if (imports.some((name) => name.includes('features/'))) guilty.push(file);
  }
  assert.deepStrictEqual(guilty, [], `платформа смотрит вверх: ${guilty.join(', ')}`);
});
```

Тесты фич (`*.test.js` под `features/`) из правила 1 исключены намеренно: они открывают временные базы и читают фикстуры, и запрещать им `fs` значило бы запрещать их писать.

Run: `cd /root/tg-reader-refactor && node --test tools/boundaries.test.js`
Expected: PASS — все пять машинных правил (1, 2, 3, 5, 6) зелёные

Правило 4 (чистота `logic.js`, `rules.js`, `render.js`, `prompt.js`, `repetition.js`, `voice.js`) остаётся на ревью: чистоту функции автоматически не докажешь.

- [ ] **Шаг 8: прогнать всё и убедиться, что `src/` опустел от точек входа**

Run: `cd /root/tg-reader-refactor && npm test 2>&1 | tail -8`
Expected: `# fail 0`, ни одного пропущенного

Run: `cd /root/tg-reader-refactor && ls src/*.js 2>&1`
Expected: `ls: cannot access 'src/*.js': No such file or directory` — в корне `src/` не осталось ни одного файла

Run: `cd /root/tg-reader-refactor && grep -rn "process.exit" src --include=*.js`
Expected: пусто

- [ ] **Шаг 9: обновить README и юнит**

В `README.md`:

- Строку «полный путь без отправки (сервис остановить — одна сессия за раз)» заменить описанием замка: команда откажется сама и назовёт pid.
- Описать новую структуру каталогов и пять машинных правил.
- Описать переход на SQLite: `state.db` рядом с `state.json`, перенос при первом старте, `state.json` остаётся откатом.
- Обновить пути всех команд (`bin/*`).

В `tg-reader.service` подготовить, **но не применять**:

```ini
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning bin/serve.js
```

- [ ] **Шаг 10: коммит**

```bash
cd /root/tg-reader-refactor
git add -A
git commit -m "$(cat <<'EOF'
Рантайм, замок сессии и точки входа

Хост держит четыре работы с интерфейсом { name, start, stop }. Падение
одной при старте больше не роняет остальные: раньше опечатка в списке
каналов пересылки убивала заодно и сводку, и автоответы.

Одна точка остановки вместо трёх: SIGINT и SIGTERM ведут в host.stop(),
там снимаются все таймеры, закрывается база, отключается шлюз и
освобождается замок. Мутабельные let client и let forwarder с поздним
связыванием исчезли — forceReconnect стал методом работы, владеющей
своим состоянием. Таймаут на три секунды остался страховкой, а не
механизмом выхода.

Замок сессии перенёс строку README в исполняемый код: «одна сессия за
раз» было дисциплиной, стало отказом с указанием pid. Берут его все, кто
ходит в Telegram; healthcheck не берёт — он туда не ходит.

Точки входа переехали в bin/ и сжались до четырёх шагов: разобрать argv,
загрузить конфиг, собрать, выполнить. Блок «подключись, проверь
авторизацию, иначе выход» был продублирован в четырёх файлах — стал одной
функцией сборки.

Включены правила 1 и 3. Все пять машинных правил зелёные; правило
чистоты остаётся на ревью.

Требует действия владельца: ExecStart в tg-reader.service и перезапуск.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P3MoegjcuXhWzPUJFWFLFN
EOF
)"
```

- [ ] **Шаг 11: передать владельцу**

Задача не заканчивается коммитом. Владельцу нужно:

1. Прочитать `git log --oneline main..refactor/feature-slices` — девять коммитов.
2. Слить ветку.
3. Заменить `ExecStart` в `/etc/systemd/system/tg-reader.service` (или там, где он лежит) на строку из шага 9, затем `systemctl daemon-reload`.
4. `systemctl restart tg-reader` — **это единственный перезапуск во всей работе**, и делает его владелец.
5. Сразу после: `npm run health`, `journalctl -u tg-reader -n 50`, и глазами — что `state.db` появился и растёт, а `state.json` не изменился.

Откат — `git checkout main` и перезапуск: `state.json` всё это время лежал нетронутым.

---

## Порядок и зависимости

```
1 надзиратель ──▶ 2 конфиг ──┬─▶ 3 telegram ──┬─▶ 5 forwarding ──┐
                             └─▶ 4 db ────────┤                  ├─▶ 9 runtime + bin
                                              ├─▶ 6 digest+llm ──┤
                                              │        │         │
                                              │        ▼         │
                                              ├─▶ 7 replies ─────┤
                                              └─▶ 8 health ──────┘
```

Задача 7 после 6 не по вкусу, а по необходимости: автоответам нужен `platform/llm`, который до задачи 6 сидит внутри `news.js` и `summarizer.js`. Пока платформа не выделена, связь `replies → digest` рвать нечем.

Точку входа меняет только задача 9. До неё внезапный перезапуск сервиса поднимет рабочий `src/index.js`.

| правило | включается |
|---|---|
| 6 — `telegram` только в адаптере | задача 3 |
| 2 — фича не импортирует фичу | задача 7 |
| 5 — `process.exit` только в `bin/` | дописано в задаче 8, включено в задаче 9 |
| 1 — фича не знает библиотек и I/O | задача 9 |
| 3 — платформа не знает про фичи | задача 9 |
| 4 — чистота | на ревью, автоматически не проверяется |
