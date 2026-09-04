const { localDayOf } = require('../../platform/clock');

const OFF_DATA = 'replies:off';

function commandOf(text) {
  const cleaned = String(text || '').trim().toLowerCase().replace(/^\//, '');
  if (['стоп', 'stop', 'молчи'].includes(cleaned)) return 'off';
  if (['старт', 'start', 'говори'].includes(cleaned)) return 'on';
  if (['статус', 'status'].includes(cleaned)) return 'status';
  if (['сброс', 'reset', 'обнули'].includes(cleaned)) return 'reset';
  return null;
}

function statusText(store, { now, timeZone }) {
  const counters = store.counters(localDayOf(now, timeZone));
  const head = store.enabled() ? 'Ответы включены' : 'Ответы выключены';
  return `${head}. За сутки: на обращения ${counters.addressed}, своих реплик ${counters.spontaneous}.`;
}

function applyCommand(command, store, { now, timeZone }) {
  if (command === 'off') {
    store.setEnabled(false);
    return { log: 'Ответчик: выключен командой из бота', reply: 'Молчу. Включить — «старт».' };
  }
  if (command === 'on') {
    store.setEnabled(true);
    return { log: 'Ответчик: включён командой из бота', reply: 'Снова отвечаю.' };
  }
  if (command === 'reset') {
    store.resetCounters();
    return {
      log: 'Ответчик: счётчики за сутки обнулены командой из бота',
      reply: `Счётчики обнулены. ${statusText(store, { now, timeZone })}`,
    };
  }
  return { log: null, reply: statusText(store, { now, timeZone }) };
}

async function pollCommands({ notifier, store, now = Date.now, timeZone, log = console.log }) {
  if (!notifier.enabled) return;

  let batch;
  try {
    batch = await notifier.updates(store.botOffset());
  } catch (err) {
    log(`Бот: не удалось прочитать команды (${err.message})`);
    return;
  }

  const mine = (chat) => chat && String(chat.id) === String(notifier.chatId);

  for (const update of batch.updates) {
    store.setBotOffset(update.update_id + 1);

    if (update.callback_query) {
      const query = update.callback_query;
      if (!mine(query.message && query.message.chat)) continue;
      if (query.data === OFF_DATA) {
        store.setEnabled(false);
        log('Ответчик: выключен кнопкой');
      }
      await notifier.confirmButton(query.id, 'Молчу');
      continue;
    }

    const message = update.message;
    if (!message || !mine(message.chat)) continue;
    const command = commandOf(message.text);
    if (!command) continue;
    try {
      const outcome = applyCommand(command, store, { now: now(), timeZone });
      if (outcome.log) log(outcome.log);
      await notifier.send(outcome.reply);
    } catch (err) {
      log(`Бот: команда не выполнена (${err.message})`);
    }
  }
}

module.exports = { commandOf, applyCommand, statusText, pollCommands, OFF_DATA };
