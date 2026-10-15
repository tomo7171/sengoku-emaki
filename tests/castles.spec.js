'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../tenka-castles.js'), 'utf8');
function load(extra = {}) {
  const context = { ...extra };
  vm.runInNewContext(source, context);
  return context.TenkaCastles;
}
function jpegDimensions(uri) {
  assert.match(uri, /^data:image\/jpeg;base64,/);
  const bytes = Buffer.from(uri.split(',')[1], 'base64');
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
  for (let index = 2; index < bytes.length;) {
    assert.equal(bytes[index], 0xff);
    const marker = bytes[index + 1], length = bytes.readUInt16BE(index + 2);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(index + 7), bytes.readUInt16BE(index + 5)];
    index += length + 2;
  }
  assert.fail('JPEG dimensions missing');
}

test('siege and defensive battles select distinct complete embedded castle artwork', () => {
  const castles = load();
  const examples = [
    { id: 'nanao', name: '七尾城', terrain: 'mountain' },
    { id: 'inabayama', name: '稲葉山城', terrain: 'mountain' },
    { id: 'odawara', name: '小田原城', terrain: 'hill' },
    { id: 'kiyosu', name: '清洲城', terrain: 'plain' },
  ];
  const scenes = examples.map(targetCastle => castles.scene({ mode: 'siege', targetCastle }));
  assert.equal(new Set(scenes.map(scene => scene.uri)).size, examples.length);
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    assert.equal(scene.name, examples[index].name);
    assert.match(scene.caption, /創作復元図/);
    assert.deepEqual(jpegDimensions(scene.uri), [768, 512]);
    assert.equal(castles.scene({ mode: 'siege', defending: true, targetCastle: examples[index] }).uri, scene.uri);
    assert.ok(!/undefined|NaN/.test(scene.alt));
  }
  assert.equal(castles.scene({ mode: 'field', targetCastle: examples[0] }), null);
  assert.equal(castles.scene(null), null);
});

test('all original castle terrains receive a labeled archetype without claiming exact reconstruction', () => {
  const castles = load();
  const { Game } = require('./helpers/game-runtime.cjs').runtime();
  for (const targetCastle of Game.castles) {
    const scene = castles.scene({ mode: 'siege', targetCastle });
    assert.ok(scene.uri.startsWith('data:image/jpeg;base64,'), targetCastle.name);
    assert.ok(scene.alt.includes(targetCastle.name));
    if (!['nanao', 'inabayama', 'odawara', 'kiyosu'].includes(targetCastle.id)) assert.match(scene.caption, /地形別の城郭イメージ/);
  }
  assert.equal(castles.createTextures({}), null, 'headless consumers need no browser image APIs');
});

function textureHarness() {
  const imageLoads = [];
  class Image {
    constructor() { imageLoads.push(this); }
    set src(value) { this.source = value; }
  }
  class CanvasTexture {
    constructor(canvas) { this.image = canvas; this.repeat = { set(x,y) { this.x=x;this.y=y; } }; this.disposals = 0; }
    dispose() { this.disposals++; }
  }
  const document = { createElement() { return { getContext() { return { fillRect() {}, drawImage() {} }; } }; } };
  return { castles: load({ Image, document }), imageLoads, THREE: { CanvasTexture, RepeatWrapping: 1000, SRGBColorSpace: 'srgb' } };
}

test('generated surface maps load offline, refresh the renderer, and dispose once', async () => {
  const { castles, imageLoads, THREE } = textureHarness();
  const refreshed = [];
  const textures = castles.createTextures(THREE, { anisotropy: 4, onLoad: name => refreshed.push(name) });
  const names = ['wood', 'stone', 'earth', 'plaster', 'roof', 'ground'];
  assert.equal(imageLoads.length, names.length);
  assert.equal(new Set(imageLoads.map(image => image.source)).size, names.length, 'materials do not reuse one generic image');
  for (let index = 0; index < imageLoads.length; index++) {
    assert.deepEqual(jpegDimensions(imageLoads[index].source), [512, 512]);
    imageLoads[index].onload();
    assert.equal(textures[names[index]].needsUpdate, true);
    assert.equal(textures[names[index]].colorSpace, 'srgb');
  }
  assert.deepEqual(Array.from(await textures.ready), names.map(() => true));
  assert.deepEqual(refreshed, names);
  textures.dispose();textures.dispose();
  assert.ok(names.every(name => textures[name].disposals === 1));
});

test('closing battle before images decode cancels callbacks and settles loading', async () => {
  const { castles, imageLoads, THREE } = textureHarness();
  let callbacks = 0;
  const textures = castles.createTextures(THREE, { onLoad() { callbacks++; } });
  textures.dispose();
  assert.deepEqual(Array.from(await textures.ready), imageLoads.map(() => false));
  assert.equal(callbacks, 0);
  assert.ok(imageLoads.every(image => image.onload === null && image.onerror === null));
});
