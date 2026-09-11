const test = require('node:test');
const assert = require('node:assert');
const { createTyping } = require('./typing');

function rig(over = {}) {
  const sent = [];
  const timers = [];
  const client = {
    invoke: async (request) => {
      if (over.fail) throw new Error('связь потеряна');
      sent.push(request);
      return true;
    },
  };
  const typing = createTyping({
    client,
    chat: 'чат',
    log: () => {},
    refreshMs: 4000,
    timers: {
      set: (fn, ms) => {
        const timer = { fn, ms, stopped: false };
        timers.push(timer);
        return timer;
      },
      clear: (timer) => {
        if (timer) timer.stopped = true;
      },
    },
  });
  return { typing, sent, timers };
}

const actionOf = (request) => request.action.className;

test('статус «печатает» уходит в чат', async () => {
  const { typing, sent } = rig();
  await typing.show();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(actionOf(sent[0]), 'SendMessageTypingAction');
});

test('для картинки статус другой', async () => {
  const { typing, sent } = rig();
  await typing.show('sticker');
  assert.strictEqual(actionOf(sent[0]), 'SendMessageChooseStickerAction');
});

test('статус держится дольше пяти секунд, которые даёт Telegram', async () => {
  const { typing, sent, timers } = rig();
  await typing.show();
  assert.strictEqual(timers.length, 1);
  assert.ok(timers[0].ms < 5000);
  await timers[0].fn();
  assert.strictEqual(sent.length, 2);
});

test('повторный тот же статус лишних запросов не делает', async () => {
  const { typing, sent } = rig();
  await typing.show();
  await typing.show();
  assert.strictEqual(sent.length, 1);
});

test('смена статуса на картинку обновляет и запрос, и таймер', async () => {
  const { typing, sent, timers } = rig();
  await typing.show();
  await typing.show('sticker');
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(timers[0].stopped, true);
  assert.strictEqual(timers.length, 2);
});

test('отмена снимает статус и гасит таймер', async () => {
  const { typing, sent, timers } = rig();
  await typing.show();
  await typing.hide();
  assert.strictEqual(actionOf(sent[1]), 'SendMessageCancelAction');
  assert.strictEqual(timers[0].stopped, true);
});

test('после отправленного сообщения отменять нечего', async () => {
  const { typing, sent, timers } = rig();
  await typing.show();
  typing.stop();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(timers[0].stopped, true);
});

test('без показанного статуса отмена молчит', async () => {
  const { typing, sent } = rig();
  await typing.hide();
  assert.strictEqual(sent.length, 0);
});

test('сорванный статус ответ не роняет', async () => {
  const { typing } = rig({ fail: true });
  await typing.show();
  await typing.hide();
});
