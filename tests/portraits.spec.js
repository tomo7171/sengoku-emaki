'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../tenka-portraits.js'), 'utf8'), context);
const Portraits = context.TenkaPortraits;

test('one child retains a deterministic identity while growing into an adult portrait', () => {
  const child = { id: 'oda-child-1', name: '織田若丸', clan: 'oda', gender: 'male', birth: 1561, status: 'child' };
  const infant = Portraits.uri(child, { year: 1561 });
  const youth = Portraits.uri(child, { year: 1570 });
  const adult = Portraits.uri({ ...child, status: 'active' }, { year: 1576 });
  assert.notEqual(infant, youth);
  assert.notEqual(youth, adult);
  assert.equal(Portraits.uri(child, { year: 1561 }), infant, 'opening an older save cannot reuse the grown-up cache entry');
  Portraits.clear();
  assert.equal(Portraits.uri(child, { year: 1570 }), youth, 'rendering has no random global state');
  assert.equal(decodeURIComponent(infant.split(',')[1]), Portraits.svg(child, { year: 1561 }));
  assert.equal(Portraits.uri({ ...child, currentYear: 1570 }), youth, 'core portraits can pass the year in officer metadata');
});

test('siblings and both sexes have individualized artwork and safe embedded labels', () => {
  const princess = { id: 'oda-daughter-1', name: '姫<&"', clan: 'oda', sex: 'female', birth: 1561, status: 'child' };
  const first = Portraits.uri(princess, { year: 1570 });
  const sibling = Portraits.uri({ ...princess, id: 'oda-daughter-2' }, { year: 1570 });
  const brother = Portraits.uri({ ...princess, sex: 'male' }, { year: 1570 });
  assert.notEqual(first, sibling);
  assert.notEqual(first, brother, 'sex changes cannot reuse a cached portrait for the same id');
  const svg = decodeURIComponent(first.split(',')[1]);
  assert.ok(svg.includes('姫&lt;&amp;&quot;'));
  assert.ok(!svg.includes(princess.name));
  for (const year of [1560, 1561, 1570, 1576, 1623]) {
    const rendered = Portraits.svg(princess, { year });
    assert.ok(rendered.startsWith('<svg '));
    assert.ok(rendered.endsWith('</svg>'));
    assert.ok(!/NaN|undefined|Infinity/.test(rendered), `valid coordinates at year ${year}`);
  }
});

test('adult male artwork and explicit year resolution remain stable', () => {
  const lord = { id: 'oda_nobunaga', name: '織田信長', clan: 'oda', birth: 1534 };
  assert.equal(Portraits.svg(lord), Portraits.svg(lord, { year: 1560 }));
  context.TenkaPortraitYear = 1580;
  assert.equal(Portraits.uri(lord), Portraits.uri(lord, { year: 1580 }));
  assert.notEqual(Portraits.uri(lord), Portraits.uri(lord, { year: 1560 }));
  assert.equal(Portraits.uri({ ...lord, currentYear: 1570 }), Portraits.uri(lord, { year: 1570 }));
  delete context.TenkaPortraitYear;
});
