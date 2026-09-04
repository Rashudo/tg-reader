const https = require('https');

const { TELEGRAM_LIMIT } = require('./platform/telegram/text');

function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Bot API вернул не JSON (код ${res.statusCode})`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Bot API не ответил за 15 секунд')));
    req.on('error', reject);
    req.end(payload);
  });
}

function createNotifier({ token, chatId, request = httpsPostJson, log = console.error }) {
  return {
    enabled: Boolean(token && chatId),
    async send(text, { buttons } = {}) {
      if (!token || !chatId) return false;
      try {
        const result = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
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
  };
}

module.exports = { createNotifier };
