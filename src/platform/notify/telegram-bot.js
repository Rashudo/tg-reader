const https = require('https');
const { TELEGRAM_LIMIT } = require('../telegram/text');

const POLL_TIMEOUT_SEC = 25;

function httpsPostJson(url, body, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Bot API вернул не JSON (код ${res.statusCode})`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Bot API не ответил вовремя')));
    req.on('error', reject);
    req.end(payload);
  });
}

function createNotifier({ token, chatId, request = httpsPostJson, log = console.error }) {
  const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

  return {
    enabled: Boolean(token && chatId),
    chatId,
    async send(text, { buttons } = {}) {
      if (!token || !chatId) return false;
      try {
        const result = await request(api('sendMessage'), {
          chat_id: chatId,
          text: text.slice(0, TELEGRAM_LIMIT),
          disable_web_page_preview: true,
          ...(buttons
            ? {
                reply_markup: {
                  inline_keyboard: buttons.map((row) =>
                    row.map((button) => ({ text: button.text, callback_data: button.data }))
                  ),
                },
              }
            : {}),
        });
        if (result && result.ok === false) {
          log(`Уведомление не доставлено: ${result.description}`);
          return false;
        }
        return true;
      } catch (err) {
        log(`Уведомление не доставлено: ${err.message}`);
        return false;
      }
    },
    async updates(offset) {
      if (!token || !chatId) return { updates: [], nextOffset: offset };
      const response = await request(
        api('getUpdates'),
        { offset, timeout: POLL_TIMEOUT_SEC, allowed_updates: ['message', 'callback_query'] },
        { timeoutMs: (POLL_TIMEOUT_SEC + 10) * 1000 }
      );
      const updates = (response && response.result) || [];
      const nextOffset = updates.length ? updates[updates.length - 1].update_id + 1 : offset;
      return { updates, nextOffset };
    },
    async confirmButton(id, text) {
      if (!token) return false;
      try {
        await request(api('answerCallbackQuery'), { callback_query_id: id, text });
        return true;
      } catch (err) {
        log(`Бот: кнопка не подтверждена (${err.message})`);
        return false;
      }
    },
  };
}

module.exports = { createNotifier, httpsPostJson, POLL_TIMEOUT_SEC };
