function hourIn(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(at));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

function inQuietHours(at, { from, to, timeZone }) {
  const { hour } = hourIn(at, timeZone);
  if (from === to) return false;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

function mentionsAlias(text, aliases) {
  const lowered = text.toLowerCase().replace(/ё/g, 'е');
  return aliases.some((alias) => {
    const needle = alias.toLowerCase().replace(/ё/g, 'е');
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zа-я0-9_])${escaped}([^a-zа-я0-9_]|$)`, 'i').test(lowered);
  });
}

function isAddressed(msg, { meId, aliases = [], messageById = new Map() }) {
  if (!msg || String(msg.from) === String(meId)) return false;
  const text = (msg.text || '').trim();
  if (!text) return false;
  if (msg.replyTo) {
    const parent = messageById.get(msg.replyTo);
    if (parent && String(parent.from) === String(meId)) return true;
  }
  return mentionsAlias(text, aliases);
}

function decideAddressed({ now, enabled, quiet, used, budget, lastAt, pauseMs }) {
  if (!enabled) return { allow: false, why: 'ответы выключены' };
  if (inQuietHours(now, quiet)) return { allow: false, why: 'тихие часы' };
  if (used >= budget) return { allow: false, why: `бюджет ответов на сутки исчерпан (${budget})` };
  if (lastAt && now - lastAt < pauseMs) return { allow: false, why: 'пауза после прошлого ответа' };
  return { allow: true, why: 'можно' };
}

function decideSpontaneous({
  now,
  enabled,
  quiet,
  used,
  budget,
  lastAt,
  pauseMs,
  ownerSpokeAt,
  ownerSilenceMs,
  freshCount,
  minFresh,
}) {
  if (!enabled) return { allow: false, why: 'ответы выключены' };
  if (inQuietHours(now, quiet)) return { allow: false, why: 'тихие часы' };
  if (used >= budget) return { allow: false, why: `бюджет реплик на сутки исчерпан (${budget})` };
  if (lastAt && now - lastAt < pauseMs) return { allow: false, why: 'пауза после прошлой реплики' };
  if (ownerSpokeAt && now - ownerSpokeAt < ownerSilenceMs) return { allow: false, why: 'хозяин говорил сам' };
  if (freshCount < minFresh) return { allow: false, why: `мало новых сообщений (${freshCount})` };
  return { allow: true, why: 'можно' };
}

module.exports = { isAddressed, mentionsAlias, inQuietHours, decideAddressed, decideSpontaneous };
