const { createLlm } = require('../../platform/llm/anthropic');

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 800;
const DEFAULT_MAX_CHARS = 160;

const SILENCE = { reply: false, text: '', replyToId: null };

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
  return ['', 'Так ты пишешь на самом деле:', ...samples.map((sample) => `— ${sample}`), ''].join('\n');
}

function avoidBlock(avoid) {
  if (avoid.length === 0) return '';
  return [
    '',
    'Ты уже говорил это недавно. Не повторяй эти обороты и не развивай эти шутки —',
    'даже если чат их подхватил и они кажутся темой дня:',
    ...avoid.map((line) => `— ${line}`),
    '',
  ].join('\n');
}

function systemPrompt({ samples = [], maxChars = DEFAULT_MAX_CHARS, mode = 'spontaneous', name = 'Стас', avoid = [] }) {
  const task =
    mode === 'addressed'
      ? [
          'К тебе обратились: ответили на твоё сообщение или назвали по имени.',
          'Ответь именно на это сообщение, своими словами.',
        ]
      : [
          'К тебе никто не обращался. Ты решаешь, есть ли повод вставить одну реплику.',
          'Повод есть редко: три-четыре раза за сутки. Нет повода — молчи, это нормальный исход.',
          'В поле replyToId укажи id сообщения, к которому цепляешь реплику.',
        ];

  return [
    `Ты — ${name}, участник чата из четырёх друзей. Пишешь в этот чат от своего имени.`,
    'Ты там свой, постироничный. Друзья знают тебя много лет и подделку заметят.',
    'Твои прошлые сообщения в переписке подписаны «ты».',
    '',
    ...task,
    voiceBlock(samples),
    avoidBlock(avoid),
    'Правила:',
    `— одна фраза, не длиннее ${maxChars} символов; длинная складная реплика выдаёт подделку вернее всего;`,
    '— строчные буквы и твоя пунктуация, а не грамотная письменная речь;',
    '— без вступлений, без «конечно», без извинений, без объяснения шутки;',
    '— не переспрашивай и не предлагай помощь: это чат друзей, а не поддержка;',
    '— эмодзи только такие и настолько же редко, как в образцах;',
    `— пиши от первого лица; никогда не говори о себе в третьем лице и не называй себя «${name}»;`,
    '— отвечай по существу того, что тебе написали: спросили — ответь на вопрос,',
    '  сказали — среагируй на сказанное. Так выглядит большинство обращений;',
    '— остальная переписка — только фон, чтобы понять, о чём речь. Не подхватывай',
    '  её шутки, не пересказывай их и не выкручивай разговор обратно к ним;',
    '— каждая реплика — новая мысль. Нечего сказать по существу — промолчи,',
    '  это лучше, чем поддержать разговор ради разговора;',
    '— не выдумывай факты о людях: ни планов, ни договорённостей, ни обещаний;',
    '— никакой прямой похабщины про названных по имени людей;',
    '— если сказать нечего или разговор не твой — верни reply: false и промолчи.',
  ].join('\n');
}

function buildUserMessage({ window, trigger }) {
  const lines = window.map((msg) => `[${msg.id}] ${msg.mine ? 'ты' : msg.author}: ${msg.text}`);
  const parts = ['Последние сообщения чата:', ...lines];
  if (trigger) {
    parts.push('', `Обращение к тебе: [${trigger.id}] ${trigger.author}: ${trigger.text}`);
  }
  return parts.join('\n');
}


function parseReply(json, { window, trigger, maxChars }) {
  if (!json || json.reply !== true) return SILENCE;
  const text = clampText(String(json.text || ''), maxChars);
  if (!text) return SILENCE;

  const known = new Set(window.map((msg) => msg.id));
  let replyToId = trigger ? trigger.id : null;
  if (!trigger) {
    replyToId = Number.isInteger(json.replyToId) && known.has(json.replyToId) ? json.replyToId : null;
  }
  return { reply: true, text, replyToId };
}

function createResponder({
  llm,
  request,
  model = DEFAULT_MODEL,
  samples = [],
  maxChars = DEFAULT_MAX_CHARS,
  name = 'Стас',
  log = console.log,
}) {
  const model_ = model;
  const engine = llm || createLlm({ request, log });

  return {
    async compose({ window, trigger, mode, avoid = [] }) {
      const answer = await engine.call({
        model: model_,
        system: systemPrompt({ samples, maxChars, mode, name, avoid }),
        messages: [{ role: 'user', content: buildUserMessage({ window, trigger }) }],
        schema: SCHEMA,
        maxTokens: MAX_TOKENS,
      });

      const usage = answer.usage || {};
      if (usage.input_tokens) {
        log(
          `Ответчик: токенов на входе ${usage.input_tokens}, на выходе ${usage.output_tokens || 0}` +
            (answer.cost === null || answer.cost === undefined ? '' : `, примерно $${answer.cost.toFixed(4)}`)
        );
      }

      if (answer.json === null) {
        log('Ответчик: модель ответила не по схеме — молчу');
        return SILENCE;
      }
      return parseReply(answer.json, { window, trigger, maxChars });
    },
  };
}

module.exports = {
  createResponder,
  SCHEMA,
  SILENCE,
  systemPrompt,
  clampText,
  buildUserMessage,
  parseReply,
  DEFAULT_MODEL,
  DEFAULT_MAX_CHARS,
  MAX_TOKENS,
};
