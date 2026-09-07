const { cut } = require('./format');

const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 300;
const NOTE_MAX = 170;

const SCHEMA = {
  type: 'object',
  properties: {
    what: { type: 'string' },
    when: { type: 'string' },
  },
  required: ['what', 'when'],
  additionalProperties: false,
};

const SYSTEM = [
  'Ты описываешь картинки для чужого промпта. Тот, кто будет их выбирать, картинок не видит',
  'и знает только твоё описание. Отвечай по-русски, коротко, без оценок и без слова «мем».',
  'what — что на картинке: кто, что делает, какая надпись, если она есть.',
  'when — в каком случае такую картинку уместно прислать в чате друзей. Одна фраза.',
].join('\n');

function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function describeRequest({ image, mediaType, kind, emoji = '', model = DEFAULT_MODEL }) {
  const what = kind === 'gif' ? 'кадр из гифки' : 'стикер';
  const hint = emoji ? `${what}, эмодзи автора: ${emoji}` : what;
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `Это ${hint}.` },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  };
}

function noteOf(parsed) {
  const what = String((parsed && parsed.what) || '').trim().replace(/\s+/g, ' ');
  const when = String((parsed && parsed.when) || '').trim().replace(/\s+/g, ' ');
  if (!what) return '';
  const note = when ? `${what}; годится, когда ${when.replace(/^когда\s+/i, '')}` : what;
  return cut(note, NOTE_MAX);
}

function textOf(response) {
  const block = ((response && response.content) || []).find((part) => part.type === 'text');
  return block ? block.text : '';
}

async function describeImage({ createMessage, buffer, kind, emoji, model }) {
  const mediaType = sniffImage(buffer);
  if (!mediaType) return { note: '', why: 'непонятный формат картинки' };
  const response = await createMessage(
    describeRequest({ image: buffer.toString('base64'), mediaType, kind, emoji, model })
  );
  let parsed;
  try {
    parsed = JSON.parse(textOf(response));
  } catch (err) {
    return { note: '', why: `ответ не по схеме (${err.message})` };
  }
  const note = noteOf(parsed);
  return note ? { note } : { note: '', why: 'пустое описание' };
}

module.exports = { describeImage, describeRequest, sniffImage, noteOf, SCHEMA, DEFAULT_MODEL };
