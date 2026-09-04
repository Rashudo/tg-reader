function createHost({ log = console.log, notifier = null } = {}) {
  const jobs = [];
  const running = new Set();

  return {
    add(job) {
      jobs.push(job);
    },
    async start() {
      for (const job of jobs) {
        try {
          await job.start();
          running.add(job);
        } catch (err) {
          log(`Работа «${job.name}» не поднялась: ${err.message}`);
          if (notifier) {
            await notifier
              .send(`🟠 tg-reader: работа «${job.name}» не поднялась — ${err.message}. Остальные работают.`)
              .catch(() => {});
          }
        }
      }
    },
    async stop() {
      for (const job of [...running].reverse()) {
        try {
          await job.stop();
        } catch (err) {
          log(`Работа «${job.name}» не остановилась чисто: ${err.message}`);
        }
      }
      running.clear();
    },
  };
}

module.exports = { createHost };
