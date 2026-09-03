/** Обещание с крайним сроком: висящий вызов должен падать, а не молчать вечно. */
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

module.exports = { withTimeout };
