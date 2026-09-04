const { keyOf, eventKeyOf } = require('./platform/telegram/gateway');

module.exports = { peerKey: keyOf, eventPeerKey: eventKeyOf };
