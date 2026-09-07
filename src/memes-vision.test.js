const test = require('node:test');
const assert = require('node:assert');
const { describeImage, describeRequest, sniffImage, noteOf } = require('./memes-vision');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);

function answer(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

test('формат картинки узнаётся по первым байтам', () => {
  assert.strictEqual(sniffImage(JPEG), 'image/jpeg');
  assert.strictEqual(sniffImage(WEBP), 'image/webp');
  assert.strictEqual(sniffImage(Buffer.from('это не картинка вовсе')), null);
  assert.strictEqual(sniffImage(null), null);
});

test('в запросе едет картинка и подсказка про вид', () => {
  const request = describeRequest({ image: 'AAA', mediaType: 'image/webp', kind: 'gif', emoji: '😂' });
  const [image, text] = request.messages[0].content;
  assert.strictEqual(image.source.media_type, 'image/webp');
  assert.strictEqual(image.source.data, 'AAA');
  assert.match(text.text, /гифк/);
  assert.match(text.text, /😂/);
});

test('описание склеивается в одну строку', () => {
  assert.strictEqual(noteOf({ what: 'кот падает со стола', when: 'когда план развалился' }),
    'кот падает со стола; годится, когда план развалился');
});

test('без «что» описания не выходит', () => {
  assert.strictEqual(noteOf({ what: '  ', when: 'когда угодно' }), '');
});

test('картинка неизвестного формата в модель не едет', async () => {
  let called = 0;
  const out = await describeImage({
    createMessage: async () => {
      called += 1;
      return answer({ what: 'x', when: 'y' });
    },
    buffer: Buffer.from('мусор'),
    kind: 'sticker',
  });
  assert.strictEqual(called, 0);
  assert.strictEqual(out.note, '');
  assert.match(out.why, /формат/);
});

test('ответ не по схеме описание не портит', async () => {
  const out = await describeImage({
    createMessage: async () => ({ content: [{ type: 'text', text: 'ну такое' }] }),
    buffer: JPEG,
    kind: 'sticker',
  });
  assert.strictEqual(out.note, '');
  assert.match(out.why, /схем/);
});

test('удачное описание возвращается строкой', async () => {
  const out = await describeImage({
    createMessage: async () => answer({ what: 'мужик закатывает глаза', when: 'когда обещают и не делают' }),
    buffer: WEBP,
    kind: 'gif',
  });
  assert.match(out.note, /закатывает глаза/);
});
