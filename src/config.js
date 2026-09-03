require('dotenv').config();

function required(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`Не задана переменная ${name} в .env — см. .env.example`);
    process.exit(1);
  }
  return value;
}

const config = {
  apiId: Number(required('TG_API_ID')),
  apiHash: required('TG_API_HASH'),
  session: (process.env.TG_SESSION || '').trim(),
  channels: (process.env.CHANNEL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  target: (process.env.TARGET || 'me').trim(),
};

if (Number.isNaN(config.apiId)) {
  console.error('TG_API_ID должен быть числом');
  process.exit(1);
}

module.exports = { config, required };
