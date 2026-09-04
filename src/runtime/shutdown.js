function installShutdown({ host, telegram, state, log, exit, graceMs = 3000 }) {
  let leaving = false;

  async function shutdown(code) {
    if (leaving) return;
    leaving = true;
    log('Останавливаюсь');

    const forced = setTimeout(() => exit(code), graceMs);
    if (forced.unref) forced.unref();

    try {
      await host.stop();
    } catch (err) {
      log(`Работы остановились не чисто: ${err.message}`);
    }
    try {
      await telegram.close();
    } catch (err) {
      log(`Telegram отключился не чисто: ${err.message}`);
    }
    try {
      if (state && state.close) state.close();
    } catch (err) {
      log(`Хранилище закрылось не чисто: ${err.message}`);
    }

    clearTimeout(forced);
    exit(code);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  return shutdown;
}

module.exports = { installShutdown };
