const MAX_HOPS = 20;

const FILLERS = new Set([
  'ага',
  'угу',
  'ок',
  'окей',
  'оке',
  'да',
  'нет',
  'ясно',
  'понял',
  'поняла',
  'понятно',
  'точно',
  'именно',
  'ну',
  'вот',
  'спасибо',
  'спс',
  'пасиб',
  'лол',
  'кек',
  'ор',
  'ору',
  'ржу',
  'топ',
  'збс',
  'хм',
  'мм',
  'ммм',
  'плюс',
]);

const LAUGHTER = /^(?:а?ха)+х?$|^(?:хи)+$|^(?:хе)+$/;

function botTurns(msg, { messageById, mine }) {
  let turns = 0;
  let parentId = msg && msg.replyTo;
  const seen = new Set();
  for (let hop = 0; hop < MAX_HOPS && parentId; hop += 1) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = messageById.get(parentId);
    if (!parent) break;
    if (mine(parent)) turns += 1;
    parentId = parent.replyTo;
  }
  return turns;
}

function isFiller(text) {
  const raw = (text || '').trim();
  if (raw.includes('?')) return false;
  const cleaned = raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9+\s]/g, ' ')
    .trim();
  if (!cleaned) return true;
  const words = cleaned.split(/\s+/);
  if (words.length > 3) return false;
  return words.every((word) => FILLERS.has(word) || LAUGHTER.test(word) || /^\++$/.test(word));
}

module.exports = { botTurns, isFiller };
