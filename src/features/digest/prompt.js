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

const DEFAULT_MAX_ITEMS = 35;
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
    'Тем обычно от четырёх до восьми; называй их коротко и по-русски.',
    'Расположи и темы, и пункты внутри них в порядке важности: самое значимое',
    'первым. Лишнее отрезается с конца, поэтому порядок решает, что читатель увидит.',
    'Каждый пункт — одно-два предложения не длиннее 40 слов: суть события и то,',
    'что из него следует, без вводных слов и оценок. Не сцепляй разные события',
    'в один пункт через запятую — сделай из них два пункта.',
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

function buildUserMessage(items) {
  const lines = items.map((item) => {
    const link = item.link ? `\nссылка: ${item.link}` : '';
    return `[${item.id}] ${item.text}${link}`;
  });
  return `Сообщения канала за сутки, по одному на блок:\n\n${lines.join('\n\n')}`;
}


module.exports = { SCHEMA, systemPrompt, clampSummary, buildUserMessage, DEFAULT_MAX_ITEMS };
