const https = require('https');
const { localDayOf } = require('./schedule');
const { verdictOf } = require('./reactions');
const { cut } = require('./format');

const POLL_TIMEOUT_SEC = 25;

function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: (POLL_TIMEOUT_SEC + 10) * 1000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Bot API вернул не JSON (код ${res.statusCode})`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Bot API не ответил')));
    req.on('error', reject);
    req.end(payload);
  });
}

function commandOf(text) {
  const cleaned = String(text || '').trim().toLowerCase().replace(/^\//, '');
  if (['стоп', 'stop', 'молчи'].includes(cleaned)) return 'off';
  if (['старт', 'start', 'говори'].includes(cleaned)) return 'on';
  if (['статус', 'status'].includes(cleaned)) return 'status';
  if (['сброс', 'reset', 'обнули'].includes(cleaned)) return 'reset';
  if (['оценки', 'scores', 'реакции'].includes(cleaned)) return 'scores';
  return null;
}

function createBotCommands({
  token,
  chatId,
  state,
  request = httpsPostJson,
  onReaction = () => {},
  timeZone = 'Europe/Belgrade',
  log = console.log,
  now = Date.now,
}) {
  const api = (method) => `https://api.telegram.org/bot${token}/${method}`;
  const mine = (chat) => chat && String(chat.id) === String(chatId);

  async function say(text) {
    await request(api('sendMessage'), { chat_id: chatId, text, disable_web_page_preview: true });
  }

  function graded() {
    return (state.postedReplies ? state.postedReplies() : []).map((item) => ({ ...item, verdict: verdictOf(item) }));
  }

  async function statusText() {
    const counters = state.replyCounters(localDayOf(now(), timeZone));
    const head = state.repliesEnabled() ? 'Ответы включены' : 'Ответы выключены';
    const marks = graded();
    const good = marks.filter((item) => item.verdict === 'good').length;
    const bad = marks.filter((item) => item.verdict === 'bad').length;
    const scores = good || bad ? ` Оценки: 👍 ${good}, 👎 ${bad}.` : '';
    return `${head}. За сутки: на обращения ${counters.addressed}, своих реплик ${counters.spontaneous}.${scores}`;
  }

  function scoresText() {
    const marks = graded().slice(-10).reverse();
    if (!marks.length) return 'Оценок пока нет — бот ещё ничего не отправлял.';
    const mark = { good: '👍', bad: '👎' };
    const lines = marks.map((item) => `${mark[item.verdict] || '·'} «${cut(item.text, 70)}»`);
    return ['Оценки последних реплик:', ...lines].join('\n');
  }

  async function apply(command) {
    if (command === 'off') {
      state.setRepliesEnabled(false);
      log('Ответчик: выключен командой из бота');
      await say('Молчу. Включить — «старт».');
      return;
    }
    if (command === 'on') {
      state.setRepliesEnabled(true);
      log('Ответчик: включён командой из бота');
      await say('Снова отвечаю.');
      return;
    }
    if (command === 'scores') {
      await say(scoresText());
      return;
    }
    if (command === 'reset') {
      state.resetReplyCounters();
      log('Ответчик: счётчики за сутки обнулены командой из бота');
      await say(`Счётчики обнулены. ${await statusText()}`);
      return;
    }
    await say(await statusText());
  }

  return {
    async poll() {
      if (!token || !chatId) return;
      let response;
      try {
        response = await request(api('getUpdates'), {
          offset: state.botOffset(),
          timeout: POLL_TIMEOUT_SEC,
          allowed_updates: ['message', 'callback_query', 'message_reaction'],
        });
      } catch (err) {
        log(`Бот: не удалось прочитать команды (${err.message})`);
        return;
      }

      const updates = (response && response.result) || [];
      for (const update of updates) {
        state.setBotOffset(update.update_id + 1);

        if (update.callback_query) {
          const query = update.callback_query;
          if (!mine(query.message && query.message.chat)) continue;
          if (query.data === 'replies:off') {
            state.setRepliesEnabled(false);
            log('Ответчик: выключен кнопкой');
          }
          try {
            await request(api('answerCallbackQuery'), { callback_query_id: query.id, text: 'Молчу' });
          } catch (err) {
            log(`Бот: кнопка не подтверждена (${err.message})`);
          }
          continue;
        }

        if (update.message_reaction) {
          const event = update.message_reaction;
          if (!mine(event.chat)) continue;
          try {
            await onReaction({ noteId: event.message_id, reactions: event.new_reaction || [] });
          } catch (err) {
            log(`Бот: реакция не учтена (${err.message})`);
          }
          continue;
        }

        const message = update.message;
        if (!message || !mine(message.chat)) continue;
        const command = commandOf(message.text);
        if (!command) continue;
        try {
          await apply(command);
        } catch (err) {
          log(`Бот: команда не выполнена (${err.message})`);
        }
      }
    },

    start(intervalMs) {
      const timer = setInterval(() => {
        this.poll().catch((err) => log(`Бот: опрос споткнулся (${err.message})`));
      }, intervalMs);
      if (timer.unref) timer.unref();
      return timer;
    },
  };
}

module.exports = { createBotCommands, commandOf };
