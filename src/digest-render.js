const { cut, TELEGRAM_LIMIT } = require('./platform/telegram/text');

function digestHeading({ title, at, timeZone }) {
  let day;
  try {
    day = new Intl.DateTimeFormat('ru-RU', { timeZone, day: 'numeric', month: 'long' }).format(at);
  } catch (err) {
    day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(at);
  }
  return `Сводка «${title}» за ${day}`;
}

function renderGroup(group) {
  const lines = [`▪ ${group.topic}`];
  for (const item of group.items || []) {
    const link = item.link ? ` ${item.link}` : '';
    lines.push(`   • ${item.text}${link}`);
  }
  return lines.join('\n');
}

function splitLongBlock(block) {
  const parts = [];
  let rest = block;
  while (rest.length > TELEGRAM_LIMIT) {
    parts.push(cut(rest.slice(0, TELEGRAM_LIMIT), TELEGRAM_LIMIT));
    rest = rest.slice(TELEGRAM_LIMIT - 1);
  }
  if (rest) parts.push(rest);
  return parts;
}

function pack(blocks) {
  const messages = [];
  let current = '';
  for (const block of blocks) {
    if (block.length > TELEGRAM_LIMIT) {
      if (current) {
        messages.push(current);
        current = '';
      }
      messages.push(...splitLongBlock(block));
      continue;
    }
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > TELEGRAM_LIMIT) {
      messages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function renderDigest(summary, meta) {
  const heading = digestHeading(meta);

  if (summary && typeof summary.raw === 'string') {
    return pack([heading, summary.raw]);
  }

  const groups = (summary && summary.groups) || [];
  const counts = [`Просмотрено сообщений: ${meta.total}`];
  if (Number.isInteger(summary && summary.dropped)) counts.push(`отброшено как шум: ${summary.dropped}`);
  const intro = `${heading}\n${counts.join(', ')}`;

  if (groups.length === 0) {
    return pack([`${intro}\n\nЗа сутки ничего существенного.`]);
  }

  return pack([intro, ...groups.map(renderGroup)]);
}

module.exports = { renderDigest, digestHeading };
