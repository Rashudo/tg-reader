const RUNNING_STATES = ['active', 'activating', 'reloading'];

function isRunning(snapshot) {
  if (snapshot.serviceActive !== undefined) return snapshot.serviceActive;
  return RUNNING_STATES.includes(snapshot.activeState);
}

function problemOf(snapshot, memory, thresholds) {
  if (!isRunning(snapshot)) return 'dead';
  if (snapshot.restarts - memory.seenRestarts >= thresholds.flappingRestarts) return 'flapping';
  if (snapshot.forwarding === false) return null;
  if (snapshot.stateAgeMs === null || snapshot.stateAgeMs > thresholds.stallMs) return 'stall';
  return null;
}

function digestDueAt(now, hour) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

function decide(snapshot, memory, thresholds) {
  const base = { ...memory, seenRestarts: snapshot.restarts };
  const kind = problemOf(snapshot, memory, thresholds);

  if (kind) {
    const repeated = memory.lastKind === kind && snapshot.now - memory.lastAlertAt < thresholds.repeatMs;
    if (repeated) return { alert: null, memory: base };
    return { alert: { kind }, memory: { ...base, lastKind: kind, lastAlertAt: snapshot.now } };
  }

  if (memory.lastKind && memory.lastKind !== 'recovered') {
    return {
      alert: { kind: 'recovered' },
      memory: { ...base, lastKind: 'recovered', lastAlertAt: snapshot.now },
    };
  }

  const dueAt = digestDueAt(snapshot.now, thresholds.digestHour);
  if (snapshot.now >= dueAt && memory.lastDigestAt < dueAt) {
    const since = memory.lastDigestCounters || { checked: 0, forwarded: 0 };
    const counters = { checked: snapshot.checked || 0, forwarded: snapshot.forwarded || 0 };
    return {
      alert: {
        kind: 'digest',
        checkedDelta: counters.checked - since.checked,
        forwardedDelta: counters.forwarded - since.forwarded,
      },
      memory: { ...base, lastDigestAt: snapshot.now, lastDigestCounters: counters },
    };
  }

  return { alert: null, memory: base };
}

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

module.exports = { decide, parseUnitStatus };
