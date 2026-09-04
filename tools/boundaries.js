const fs = require('fs');
const path = require('path');

const PROCESS_EXIT = /\bprocess\s*\.\s*exit\s*\(/;

function jsFilesUnder(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...jsFilesUnder(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.js')) found.push(rel);
  }
  return found;
}

function scan(source) {
  const strings = [];
  const masked = String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*?\1/g, (match) => {
      strings.push(match.slice(1, -1));
      return ` ${strings.length - 1} `;
    });
  return { masked, strings };
}

function requiresOf(source) {
  const { masked, strings } = scan(source);
  const found = [];
  for (const match of masked.matchAll(/require\(\s*(\d+)\s*\)/g)) found.push(strings[Number(match[1])]);
  return found;
}

function hasProcessExit(source) {
  return PROCESS_EXIT.test(scan(source).masked);
}

module.exports = { jsFilesUnder, requiresOf, hasProcessExit };
