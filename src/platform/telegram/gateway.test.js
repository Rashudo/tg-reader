const test = require('node:test');
const { gatewayContract } = require('./contract');
const { createGateway } = require('./gateway');
const { createManualClock } = require('../clock');
const { createFakeClient } = require('./fake-client');

async function make({ membersFail = false } = {}) {
  const clock = createManualClock(0);
  const client = createFakeClient({ membersFail });
  const gateway = createGateway({ client, clock, log: () => {}, albumWindowMs: 800 });
  await gateway.members('@one');
  return { gateway, clock, emit: client.emit.bind(client), emitEdit: client.emitEdit.bind(client) };
}

for (const check of gatewayContract(make)) test(`шлюз: ${check.name}`, check.run);
