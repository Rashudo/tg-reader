const { execFileSync } = require('child_process');

function parseUnitStatus(text) {
  const fields = new Map();
  for (const line of String(text || '').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const restarts = Number(fields.get('NRestarts'));
  return {
    activeState: fields.get('ActiveState') || 'unknown',
    restarts: Number.isInteger(restarts) && restarts >= 0 ? restarts : 0,
  };
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

module.exports = { unitStatus, parseUnitStatus };
