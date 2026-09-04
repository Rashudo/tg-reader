const test = require('node:test');
const assert = require('node:assert');
const { emojiCounts, emojiVotes, tally, verdictOf, chatReactionOf } = require('./reactions');

const SET = { good: ['💯', '👍', '❤', '🔥'], bad: ['💩', '👎'] };

test('счётчики из апдейта чата разбираются по эмодзи', () => {
  const counts = emojiCounts([
    { reaction: { className: 'ReactionEmoji', emoticon: '💯' }, count: 2 },
    { reaction: { className: 'ReactionEmoji', emoticon: '💩' }, count: 1 },
  ]);
  assert.deepStrictEqual(counts, { '💯': 2, '💩': 1 });
});

test('платные и кастомные реакции пропускаются', () => {
  const counts = emojiCounts([
    { reaction: { className: 'ReactionCustomEmoji', documentId: '123' }, count: 5 },
    { reaction: { className: 'ReactionEmoji', emoticon: '🔥' }, count: 1 },
  ]);
  assert.deepStrictEqual(counts, { '🔥': 1 });
});

test('реакции из лички считаются по одной', () => {
  const counts = emojiVotes([
    { type: 'emoji', emoji: '💯' },
    { type: 'emoji', emoji: '🔥' },
  ]);
  assert.deepStrictEqual(counts, { '💯': 1, '🔥': 1 });
});

test('снятая реакция даёт пустой счёт', () => {
  assert.deepStrictEqual(emojiVotes([]), {});
});

test('сердце с селектором и без — одна реакция', () => {
  assert.deepStrictEqual(tally({ '❤️': 1 }, SET), { good: 1, bad: 0 });
});

test('незнакомая реакция не считается ни хорошей, ни плохой', () => {
  assert.deepStrictEqual(tally({ '🤔': 3 }, SET), { good: 0, bad: 0 });
});

test('плохие реакции считаются отдельно', () => {
  assert.deepStrictEqual(tally({ '💩': 1, '👎': 2, '👍': 1 }, SET), { good: 1, bad: 3 });
});

test('вердикт по чату, когда своей оценки нет', () => {
  assert.strictEqual(verdictOf({ chat: { good: 2, bad: 0 }, note: { good: 0, bad: 0 } }), 'good');
});

test('своя оценка перевешивает оценку чата', () => {
  assert.strictEqual(verdictOf({ chat: { good: 3, bad: 0 }, note: { good: 0, bad: 1 } }), 'bad');
});

test('без реакций вердикта нет', () => {
  assert.strictEqual(verdictOf({ chat: { good: 0, bad: 0 }, note: { good: 0, bad: 0 } }), null);
});

test('поровну хорошего и плохого — вердикта нет', () => {
  assert.strictEqual(verdictOf({ chat: { good: 1, bad: 1 }, note: { good: 0, bad: 0 } }), null);
});

test('апдейт о реакциях превращается в оценку сообщения', () => {
  const event = chatReactionOf({
    className: 'UpdateMessageReactions',
    peer: { className: 'PeerChat', chatId: 4191861169 },
    msgId: 174912,
    reactions: { results: [{ reaction: { className: 'ReactionEmoji', emoticon: '💯' }, count: 1 }] },
  });
  assert.strictEqual(event.id, 174912);
  assert.deepStrictEqual(event.peer, { className: 'PeerChat', chatId: 4191861169 });
  assert.strictEqual(event.results.length, 1);
});

test('посторонний апдейт оценкой не считается', () => {
  assert.strictEqual(chatReactionOf({ className: 'UpdateNewMessage' }), null);
});

test('последняя снятая реакция даёт пустой список', () => {
  const event = chatReactionOf({
    className: 'UpdateMessageReactions',
    peer: { className: 'PeerChat', chatId: 1 },
    msgId: 5,
    reactions: {},
  });
  assert.deepStrictEqual(event.results, []);
});
