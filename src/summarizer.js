const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 16000;

const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
};

const SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, link: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
          },
        },
        required: ['topic', 'items'],
        additionalProperties: false,
      },
    },
    dropped: { type: 'integer' },
  },
  required: ['groups', 'dropped'],
  additionalProperties: false,
};

const DEFAULT_MAX_ITEMS = 20;

function systemPrompt(maxItems) {
  return [
    'Ты составляешь ежедневную сводку по сообщениям Telegram-канала для одного читателя.',
    '',
    'Отбрось: рекламу и промокоды, призывы подписаться, анонсы будущих постов,',
    'опросы, поздравления, репосты без содержания.',
    '',
    'Повторы одной новости объедини в один пункт с самой полной формулировкой.',
    '',
    `Оставь не больше ${maxItems} пунктов на всю сводку. Если событий больше,`,
    'отбери самые важные: масштаб последствий и то, насколько это меняет',
    'положение дел, важнее свежести и громкости заголовка.',
    '',
    'Сгруппируй пункты по темам, которые выделишь сам по содержанию дня.',
    'Тем обычно от трёх до шести; называй их коротко и по-русски.',
    'Расположи и темы, и пункты внутри них в порядке важности: самое значимое',
    'первым. Лишнее отрезается с конца, поэтому порядок решает, что читатель увидит.',
    'Каждый пункт — одно предложение не длиннее 25 слов, по существу, без вводных',
    'слов и оценок. Не сцепляй разные события в один пункт через запятую: если',
    'событий два, оставь важнейшее, а второе отбрось.',
    'Сохраняй числа, даты, имена и цены как в оригинале.',
    'Если во входных данных у сообщения есть ссылка, приложи её к пункту.',
    'В поле dropped укажи, сколько сообщений ты отбросил или объединил.',
    'Если существенного за сутки нет, верни пустой список групп.',
  ].join('\n');
}

function clampSummary(summary, maxItems) {
  if (!summary || !Array.isArray(summary.groups)) return summary;

  const groups = [];
  let kept = 0;
  let cutAway = 0;

  for (const group of summary.groups) {
    const room = maxItems - kept;
    const items = group.items || [];
    if (room <= 0) {
      cutAway += items.length;
      continue;
    }
    const take = items.slice(0, room);
    cutAway += items.length - take.length;
    kept += take.length;
    if (take.length) groups.push({ ...group, items: take });
  }

  if (cutAway === 0) return summary;
  return { ...summary, groups, dropped: (summary.dropped || 0) + cutAway };
}

function estimateCost(model, inputTokens, outputTokens) {
  const price = PRICES[model];
  if (!price) return null;
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

function buildUserMessage(items) {
  const lines = items.map((item) => {
    const link = item.link ? `\nссылка: ${item.link}` : '';
    return `[${item.id}] ${item.text}${link}`;
  });
  return `Сообщения канала за сутки, по одному на блок:\n\n${lines.join('\n\n')}`;
}

function textOf(response) {
  const block = (response.content || []).find((part) => part.type === 'text');
  return block ? block.text : '';
}

function createSummarizer({ model = DEFAULT_MODEL, createMessage, log = console.log, maxItems = DEFAULT_MAX_ITEMS }) {
  return {
    async summarize(items) {
      if (items.length === 0) return { groups: [], dropped: 0 };

      const response = await createMessage({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(maxItems),
        messages: [{ role: 'user', content: buildUserMessage(items) }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      });

      const usage = response.usage || {};
      const cost = estimateCost(model, usage.input_tokens || 0, usage.output_tokens || 0);
      log(
        `Сводка: ${model}, токенов на входе ${usage.input_tokens || 0}, на выходе ${usage.output_tokens || 0}` +
          (cost === null ? '' : `, примерно $${cost.toFixed(4)}`)
      );

      const text = textOf(response);
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed.groups)) throw new Error('нет списка групп');
        return clampSummary(parsed, maxItems);
      } catch (err) {
        log(`Модель ответила не по схеме (${err.message}) — отправляю как есть`);
        return { raw: text };
      }
    },
  };
}

module.exports = {
  createSummarizer,
  clampSummary,
  estimateCost,
  systemPrompt,
  DEFAULT_MODEL,
  DEFAULT_MAX_ITEMS,
};
