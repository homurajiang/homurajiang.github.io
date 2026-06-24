const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tournament.html'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test('moves tournament results into a full-width section', () => {
  assert.match(html, /<section class="card results-card">/);
});

test('uses responsive group cards instead of fixed two-column groups', () => {
  assert.match(html, /\.group-grid\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*360px\),\s*1fr\)\)/s);
});

test('keeps standings tables from forcing page-wide overflow', () => {
  assert.match(html, /\.standings-wrap\s*{[^}]*overflow-x:\s*auto/s);
  assert.match(html, /\.standings-table\s*{[^}]*min-width:\s*640px/s);
  assert.match(html, /<div class="standings-wrap">\s*<table class="standings-table">/s);
});

test('lets match cards wrap score controls in narrow columns', () => {
  assert.match(html, /\.schedule-match\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(html, /\.score-editor\s*{[^}]*flex-wrap:\s*wrap/s);
}
);
