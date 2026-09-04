const test = require('node:test');
const { gatewayContract } = require('./contract');
const { createFakeGateway } = require('./fake');
const { createManualClock } = require('../clock');

async function make({ membersFail = false } = {}) {
  const clock = createManualClock(0);
  const gateway = createFakeGateway({ clock, membersFail });
  return { gateway, clock, emit: gateway.emit, emitEdit: gateway.emitEdit };
}

for (const check of gatewayContract(make)) test(`фейк: ${check.name}`, check.run);
