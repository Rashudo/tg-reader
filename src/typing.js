const { Api } = require('telegram');

const REFRESH_MS = 4000;

function actionOf(kind) {
  if (kind === 'sticker') return new Api.SendMessageChooseStickerAction();
  return new Api.SendMessageTypingAction();
}

function createTyping({
  client,
  chat,
  log = console.log,
  refreshMs = REFRESH_MS,
  timers = { set: setInterval, clear: clearInterval },
}) {
  let timer = null;
  let shown = null;

  function drop() {
    if (!timer) return;
    timers.clear(timer);
    timer = null;
  }

  async function push(action) {
    await client.invoke(new Api.messages.SetTyping({ peer: chat, action }));
  }

  return {
    async show(kind = 'text') {
      if (shown === kind) return;
      try {
        await push(actionOf(kind));
      } catch (err) {
        log(`Печатает: статус не выставился (${err.message})`);
        return;
      }
      shown = kind;
      drop();
      timer = timers.set(() => {
        push(actionOf(shown)).catch(() => {});
      }, refreshMs);
      if (timer && timer.unref) timer.unref();
    },

    stop() {
      drop();
      shown = null;
    },

    async hide() {
      drop();
      if (!shown) return;
      shown = null;
      try {
        await push(new Api.SendMessageCancelAction());
      } catch (err) {
        log(`Печатает: статус не снялся (${err.message})`);
      }
    },
  };
}

module.exports = { createTyping };
