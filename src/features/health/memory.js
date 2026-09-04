const path = require('path');
const { readJson, writeJson } = require('../../platform/json-file');

const MEMORY_PATH = process.env.TG_ALERT_STATE_PATH || path.join(__dirname, '..', '..', '..', 'alert-state.json');

const EMPTY_MEMORY = {
  lastKind: null,
  lastAlertAt: 0,
  seenRestarts: 0,
  lastDigestAt: 0,
  lastDigestCounters: null,
};

function loadMemory(file = MEMORY_PATH) {
  return { ...EMPTY_MEMORY, ...(readJson(file, null) || {}) };
}

function saveMemory(memory, file = MEMORY_PATH) {
  writeJson(file, memory);
}

module.exports = { loadMemory, saveMemory, EMPTY_MEMORY, MEMORY_PATH };
