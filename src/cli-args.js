const KNOWN = ['--dry-run', '--from-file'];

function parseDigestArgs(argv) {
  const result = { dryRun: false, fromFile: null, error: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!KNOWN.includes(arg)) {
      result.error = `Непонятный аргумент ${arg}. Есть только: ${KNOWN.join(', ')}`;
      return result;
    }
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result.error = 'После --from-file нужен путь к файлу с выгруженными сообщениями';
      return result;
    }
    result.fromFile = value;
    i += 1;
  }

  return result;
}

module.exports = { parseDigestArgs };
