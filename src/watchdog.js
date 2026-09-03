/**
 * Сторож соединения.
 *
 * GramJS умеет молча перестать переподключаться: сендер помечается отключённым,
 * процесс остаётся жив и больше ничего не пересылает. Restart=always в systemd
 * такое не ловит — перезапускают только то, что завершилось. Поэтому после
 * затяжного отсутствия связи выходим сами.
 */
function createWatchdog({ isConnected, onGiveUp, log, limitMs, intervalMs, now = Date.now }) {
  let offlineSince = null;

  /** @returns {boolean} true, если терпение кончилось и запрошен выход. */
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
