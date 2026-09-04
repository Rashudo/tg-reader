const fs = require('fs');
const path = require('path');

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function holderOf(file) {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim());
  } catch (err) {
    return NaN;
  }
}

function takeLock(file, { pid = process.pid } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(file, 'wx');
      fs.writeSync(handle, String(pid));
      fs.closeSync(handle);
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          try {
            fs.unlinkSync(file);
          } catch (err) {
            released = true;
          }
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = holderOf(file);
      if (alive(holder)) return { ok: false, holder };
      try {
        fs.unlinkSync(file);
      } catch (unlinkErr) {
        return { ok: false, holder };
      }
    }
  }

  return { ok: false, holder: holderOf(file) };
}

module.exports = { takeLock };
