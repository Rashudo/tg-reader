const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 400;
const DEFAULT_MAX_CHARS = 160;

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'boolean' },
    text: { type: 'string' },
    replyToId: { type: ['integer', 'null'] },
  },
  required: ['reply', 'text'],
  additionalProperties: false,
};

function clampText(text, maxChars) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > maxChars / 3) return cut.slice(0, stop + 1).trim();
  return cut;
}

function voiceBlock(samples) {
  if (samples.length === 0) return '';
  return ['', 'Так он пишет на самом деле:', ...samples.map((sample) => `— ${sample}`), ''].join('\n');
}

function systemPrompt({ samples = [], maxChars = DEFAULT_MAX_CHARS, mode = 'spontaneous' }) {
  const task =
    mode === 'addressed'
      ? [
          'К нему обратились: ответили на его сообщение или назвали по имени.',
          'Ответь так, как ответил бы он сам.',
        ]
      : [
          'К нему никто не обращался. Ты решаешь, есть ли повод вставить одну реплику.',
          'Повод есть редко: три-четыре раза за сутки. Нет повода — молчи, это нормальный исход.',
          'В поле replyToId укажи id сообщения, к которому цепляешь реплику.',
        ];

  return [
    'Ты пишешь сообщения в чат из четырёх друзей за одного из них.',
    'Он там свой, немного язвительный. Друзья знают его много лет и подделку заметят.',
    '',
    ...task,
    voiceBlock(samples),
    'Правила:',
    `— одна фраза, не длиннее ${maxChars} символов; длинная складная реплика выдаёт подделку вернее всего;`,
    '— строчные буквы и его пунктуация, а не грамотная письменная речь;',
    '— без вступлений, без «конечно», без извинений, без объяснения шутки;',
    '— не переспрашивай и не предлагай помощь: это чат друзей, а не поддержка;',
    '— эмодзи только такие и настолько же редко, как в образцах;',
    '— не выдумывай факты о людях: ни планов, ни договорённостей, ни обещаний;',
    '— никакой прямой похабщины про названных по имени людей;',
    '— если сказать нечего или разговор не твой — верни reply: false и промолчи.',
  ].join('\n');
}

function buildUserMessage({ window, trigger }) {
  const lines = window.map((msg) => `[${msg.id}] ${msg.author}: ${msg.text}`);
  const parts = ['Последние сообщения чата:', ...lines];
  if (trigger) {
    parts.push('', `Обращение к тебе: [${trigger.id}] ${trigger.author}: ${trigger.text}`);
  }
  return parts.join('\n');
}

function textOf(response) {
  const block = (response.content || []).find((part) => part.type === 'text');
  return block ? block.text : '';
}

const SILENCE = { reply: false, text: '', replyToId: null };

function createResponder({
  model = DEFAULT_MODEL,
  createMessage,
  samples = [],
  maxChars = DEFAULT_MAX_CHARS,
  log = console.log,
}) {
  return {
    async compose({ window, trigger, mode }) {
      const response = await createMessage({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt({ samples, maxChars, mode }),
        messages: [{ role: 'user', content: buildUserMessage({ window, trigger }) }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      });

      let parsed;
      try {
        parsed = JSON.parse(textOf(response));
      } catch (err) {
        log(`Ответчик: модель ответила не по схеме (${err.message}) — молчу`);
        return SILENCE;
      }

      if (!parsed || parsed.reply !== true) return SILENCE;
      const text = clampText(String(parsed.text || ''), maxChars);
      if (!text) return SILENCE;

      const known = new Set(window.map((msg) => msg.id));
      let replyToId = trigger ? trigger.id : null;
      if (!trigger) {
        replyToId = Number.isInteger(parsed.replyToId) && known.has(parsed.replyToId) ? parsed.replyToId : null;
      }

      return { reply: true, text, replyToId };
    },
  };
}

module.exports = { createResponder, systemPrompt, clampText, SCHEMA };
