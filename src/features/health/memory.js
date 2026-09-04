const fs = require('fs');
const path = require('path');

const MEMORY_PATH = process.env.TG_ALERT_STATE_PATH || path.join(__dirname, '..', '..', '..', 'alert-state.json');

const EMPTY_MEMORY = {
  lastKind: null,
  lastAlertAt: 0,
  seenRestarts: 0,
  lastDigestAt: 0,
  lastDigestCounters: null,
};

function loadMemory(file = MEMORY_PATH) {
  try {
    return { ...EMPTY_MEMORY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ...EMPTY_MEMORY };
  }
}

function saveMemory(memory, file = MEMORY_PATH) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(memory, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { loadMemory, saveMemory, EMPTY_MEMORY, MEMORY_PATH };
