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

module.exports = { createWatchdog };
