function createFakeLlm({ answers = [], errors = [] } = {}) {
  const calls = [];
  let at = 0;

  return {
    calls,
    async call(request) {
      calls.push(request);
      const failure = errors[at];
      const answer = answers[at] === undefined ? answers[answers.length - 1] : answers[at];
      at += 1;
      if (failure) throw failure;
      const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (err) {
        json = null;
      }
      return { json, text, usage: { input_tokens: 10, output_tokens: 5 }, cost: 0 };
    },
    estimateCost: () => 0,
  };
}

module.exports = { createFakeLlm };
