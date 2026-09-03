const fs = require('fs');

function setEnvVar(file, name, value) {
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${name}=${value}`;
  const existing = new RegExp(`^${name}=.*$`, 'm');
  if (existing.test(content)) {
    content = content.replace(existing, () => line);
  } else {
    content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
  }
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

module.exports = { setEnvVar };
