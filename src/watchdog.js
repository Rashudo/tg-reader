function createWatchdog({ isConnected, onGiveUp, log, limitMs, intervalMs, now = Date.now }) {
  let offlineSince = null;

  function tick() {
    if (isConnected()) {
      if (offlineSince !== null) log('Связь с Telegram восстановлена');
      offlineSince = null;
      return false;
    }
    if (offlineSince === null) {
      offlineSince = now();
      log('Связь с Telegram потеряна, жду восстановления');
      return false;
    }
    if (now() - offlineSince < limitMs) return false;
    onGiveUp();
    return true;
  }

  return {
    tick,
    start() {
      const timer = setInterval(tick, intervalMs);
      return timer;
    },
  };
}

function createStallWatchdog({
  lastMessageAt,
  probe,
  onReconnect,
  onGiveUp,
  log,
  reconnectAfterMs,
  giveUpAfterMs,
  now = Date.now,
}) {
  let confirmedAt = 0;
  let reconnectedFor = null;
  let gaveUpFor = null;
  let busy = false;

  async function tick() {
    if (busy) return false;

    const since = Math.max(lastMessageAt(), confirmedAt);
    const silence = now() - since;
    if (silence < reconnectAfterMs) return false;

    if (probe) {
      busy = true;
      try {
        if (!(await probe())) {
          confirmedAt = now();
          log(`Из канала нет сообщений ${Math.round(silence / 60000)} мин, но и в самом канале нового нет — это тишина, а не застой`);
          return false;
        }
      } catch (err) {
        log(`Не удалось проверить канал (${err.message}) — считаю это застоем`);
      } finally {
        busy = false;
      }
    }

    if (silence >= giveUpAfterMs) {
      if (gaveUpFor === since) return false;
      gaveUpFor = since;
      onGiveUp();
      return true;
    }

    if (reconnectedFor !== since) {
      reconnectedFor = since;
      log(`Из канала нет сообщений ${Math.round(silence / 60000)} мин — переподключаюсь`);
      onReconnect();
    }
    return false;
  }

  return {
    tick,
    start(intervalMs) {
      return setInterval(() => {
        tick().catch((err) => log(`Сторож застоя споткнулся: ${err.message}`));
      }, intervalMs);
    },
  };
}

module.exports = { createWatchdog, createStallWatchdog };
