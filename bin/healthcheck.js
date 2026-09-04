const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig } = require('../src/platform/config');
const { unitStatus } = require('../src/platform/systemd');
const { createNotifier } = require('../src/platform/notify/telegram-bot');
const { readStatus } = require('../src/features/health/status');
const { loadMemory, saveMemory } = require('../src/features/health/memory');
const { decide } = require('../src/features/health/rules');
const { formatAlert } = require('../src/features/health/alert-text');

const DB_PATH = process.env.TG_DB_PATH || path.join(__dirname, '..', 'state.db');

async function main() {
  const now = Date.now();
  const { config, errors } = loadConfig(process.env);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    return 1;
  }

  const notifier = createNotifier({
    token: config.alert.token,
    chatId: config.alert.chatId,
    log: console.error,
  });

  const shout = async (text) => {
    console.log(text);
    if (!notifier.enabled) {
      console.error('ALERT_BOT_TOKEN или ALERT_CHAT_ID не заданы — уведомление только в консоль');
      return;
    }
    await notifier.send(text);
  };

  const unit = unitStatus(config.health.serviceName);
  const thresholds = {
    stallMs: config.health.stallGiveUpMin * 60 * 1000,
    repeatMs: config.health.repeatMin * 60 * 1000,
    digestHour: config.health.digestHour,
    flappingRestarts: config.health.flappingRestarts,
  };

  const result = readStatus(DB_PATH);
  if (!result.ok) {
    await shout(`🔴 tg-reader: не читается состояние сервиса — ${result.reason}`);
    return 0;
  }

  const status = result.status;
  const statusAgeMs = now - status.updatedAt;
  if (statusAgeMs > thresholds.stallMs) {
    await shout(
      `🔴 tg-reader: сервис не обновляет состояние уже ${Math.round(statusAgeMs / 60000)} мин ` +
        `(юнит: ${unit.activeState}). Похоже, событийный цикл завис.`
    );
    return 0;
  }

  const since = Math.max(status.lastPostAt || 0, status.startedAt || 0, status.probeOkAt || 0);
  const snapshot = {
    now,
    activeState: unit.activeState,
    serviceState: unit.activeState,
    restarts: unit.restarts,
    stateAgeMs: since ? now - since : null,
    forwarding: status.forwarding,
    checked: status.checked || 0,
    forwarded: status.forwarded || 0,
  };

  const memory = loadMemory();
  const { alert, memory: next } = decide(snapshot, memory, thresholds);
  saveMemory(next);

  if (!alert) {
    if (process.argv.includes('--verbose')) console.log('всё в порядке', JSON.stringify(snapshot));
    return 0;
  }

  await shout(formatAlert(alert, snapshot));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Проверка не удалась:', err.message);
    process.exit(1);
  });
