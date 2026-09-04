const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { config } = require('./config');
const { createState } = require('./state');
const { createNotifier } = require('./notify');
const { decide, parseUnitStatus } = require('./health');
const { formatAlert } = require('./message');

const MEMORY_PATH = process.env.TG_ALERT_STATE_PATH || path.join(__dirname, '..', 'alert-state.json');

const EMPTY_MEMORY = {
  lastKind: null,
  lastAlertAt: 0,
  seenRestarts: 0,
  lastDigestAt: 0,
  lastDigestCounters: null,
};

function loadMemory() {
  try {
    return { ...EMPTY_MEMORY, ...JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')) };
  } catch (err) {
    return { ...EMPTY_MEMORY };
  }
}

function saveMemory(memory) {
  const tmp = `${MEMORY_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(memory, null, 2));
  fs.renameSync(tmp, MEMORY_PATH);
}

function unitStatus(name) {
  try {
    const out = execFileSync(
      'systemctl',
      ['show', name, '--property=ActiveState', '--property=NRestarts'],
      { encoding: 'utf8', timeout: 10000 }
    );
    return parseUnitStatus(out);
  } catch (err) {
    return { activeState: 'unknown', restarts: 0 };
  }
}

function main() {
  const now = Date.now();
  const state = createState();
  const status = unitStatus(config.health.serviceName);

  const since = Math.max(
    state.lastMessageAt() || 0,
    state.startedAt() || 0,
    state.probeOkAt() || 0
  );
  const snapshot = {
    now,
    activeState: status.activeState,
    serviceState: status.activeState,
    restarts: status.restarts,
    stateAgeMs: since ? now - since : null,
    forwarding: state.forwarding(),
    ...state.totals(),
  };

  const thresholds = {
    stallMs: config.health.stallGiveUpMin * 60 * 1000,
    repeatMs: config.health.repeatMin * 60 * 1000,
    digestHour: config.health.digestHour,
    flappingRestarts: config.health.flappingRestarts,
  };

  const memory = loadMemory();
  const { alert, memory: next } = decide(snapshot, memory, thresholds);
  saveMemory(next);

  if (!alert) {
    if (process.argv.includes('--verbose')) console.log('всё в порядке', JSON.stringify(snapshot));
    return Promise.resolve();
  }

  const text = formatAlert(alert, snapshot);
  console.log(text);
  const notifier = createNotifier({
    token: config.alert.token,
    chatId: config.alert.chatId,
    log: console.error,
  });
  if (!notifier.enabled) {
    console.error('ALERT_BOT_TOKEN или ALERT_CHAT_ID не заданы — уведомление только в консоль');
    return Promise.resolve();
  }
  return notifier.send(text);
}

main().catch((err) => {
  console.error('Проверка не удалась:', err.message);
  process.exit(1);
});
