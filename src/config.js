const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadConfig } = require('./platform/config');

const { config, errors } = loadConfig(process.env);

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

module.exports = { config };
