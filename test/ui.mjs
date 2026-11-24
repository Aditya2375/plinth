// Browser test: node test/ui.mjs <base-url> <fixtures-dir>
// Needs playwright-core and a Chrome binary (CHROME env var or /usr/bin/google-chrome).
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [, , base = 'http://127.0.0.1:8765/', fx = '/tmp/fx'] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);
const st = () => p.evaluate(() => window.__plinth.state);
const until = (fn, ms = 150000) => p.waitForFunction(fn, null, { timeout: ms });

await p.goto(base);
// Software GL rasterises 60k splats slowly; the checks below do not need that view.
await p.click('#sSmooth');
await until(() => window.__plinth.state.views === 36 && window.__plinth.state.k === 36 && window.__plinth.state.meshFresh);
ok('demo loads, finishes the carve animation and builds the smooth mesh');
assert.ok((await st()).tris > 10000);
assert.equal(await p.locator('#rVox').textContent() !== '0', true);

if (!process.env.QUICK) {
await p.fill('#views', '10'); await p.dispatchEvent('#views', 'input');
assert.equal((await st()).k, 10); ok('scrubbing the views slider sets the carve step');
const v10 = (await st()).voxels;
await p.fill('#views', '30'); await p.dispatchEvent('#views', 'input');
assert.ok((await st()).voxels < v10); ok('more views leave fewer voxels');

await p.click('.chip[data-name=mug]');
await until(() => window.__plinth.state.k === 36 && window.__plinth.state.views === 36);
await p.waitForFunction(() => /%/.test(document.getElementById('sIou').textContent) && !/^-/.test(document.getElementById('sIou').textContent), null, { timeout: 60000 });
await p.waitForTimeout(500);
const iou = parseFloat(await p.locator('#sIou').textContent());
assert.ok(iou < 45 && iou > 30, 'mug overlap ' + iou); ok(`mug overlap stays near 40% (${iou}%), matching the page copy`);

await p.click('.chip[data-name=stool]');
await p.waitForFunction((prev) => document.getElementById('sIou').textContent !== prev && /%/.test(document.getElementById('sIou').textContent), String(iou) + '%', { timeout: 90000 });
await until(() => window.__plinth.state.k === 36);
await p.waitForTimeout(2500);
const sIou = parseFloat(await p.locator('#sIou').textContent());
assert.ok(sIou > 70, 'stool ' + sIou); ok(`stool overlap ${sIou}%`);

const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xPoints')]);
const path = await dl.path(); const txt = readFileSync(path, 'utf8');
assert.ok(txt.startsWith('ply\nformat ascii 1.0')); assert.ok(dl.suggestedFilename().endsWith('.ply'));
const declared = Number(/element vertex (\d+)/.exec(txt)[1]); assert.equal(txt.trim().split('\n').length, declared + txt.split('\n').indexOf('end_header') + 1);
ok(`PLY points export is well formed (${declared} points)`);
const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#xObj')]);
const obj = readFileSync(await dl2.path(), 'utf8'); assert.ok(/^v /m.test(obj) && /^f \d+\/\/\d+ \d+\/\/\d+ \d+\/\/\d+$/m.test(obj)); ok('OBJ export is a triangle mesh with normals');
const [dl3] = await Promise.all([p.waitForEvent('download'), p.click('#xGlb')]);
const glb = readFileSync(await dl3.path()); assert.equal(glb.readUInt32LE(0), 0x46546c67); assert.equal(glb.readUInt32LE(8), glb.length); assert.ok(dl3.suggestedFilename().endsWith('.glb')); ok(`GLB export is a binary glTF (${glb.length} bytes)`);
await p.click('#sVoxels'); assert.equal((await st()).shape, 'voxels');
assert.equal(await p.evaluate(() => document.getElementById('sVoxels').getAttribute('aria-pressed')), 'true'); await p.click('#sSmooth'); ok('smooth / voxel toggle works');
const err = await p.locator('#sErr').textContent(); assert.ok(parseFloat(err) < 3, 'surface error ' + err); assert.match(await p.locator('#sTris').textContent(), /closed/); ok(`stool mesh is closed, surface error ${err}`);

}
// own photos
const files = Array.from({ length: 24 }, (_, i) => `${fx}/frame-${String(i + 1).padStart(2, '0')}.png`);
await p.setInputFiles('#file', files);
await until(() => window.__plinth.state.mode === 'user' && window.__plinth.state.views === 24 && window.__plinth.state.k === 24);
const user = await st(); assert.ok(user.voxels > 2000); ok(`24 uploaded photos carve a shape (${user.voxels} voxels)`);
assert.equal(await p.locator('#thumbs .thumb').count(), 24); ok('contact sheet shows every photo');

await p.setInputFiles('#file', files.slice(0, 3));
await p.waitForFunction(() => /at least 6/i.test(document.getElementById('ownMsg').textContent));
ok('fewer than six photos is refused with a clear message');
await p.setInputFiles('#file', [`${fx}/notimg.png`, ...files.slice(0, 6)]);
await p.waitForFunction(() => /could not be read/i.test(document.getElementById('ownMsg').textContent));
ok('a corrupt image is reported by name');

await p.setInputFiles('#file', [`${fx}/turn.webm`]);
await until(() => window.__plinth.state.mode === 'user' && window.__plinth.state.views === 36 && window.__plinth.state.k === 36, 90000);
ok('a turntable video is sampled into 36 frames and carved');

await p.click('#backDemo');
await until(() => window.__plinth.state.mode === 'demo' && window.__plinth.state.k === 36);
ok('back to demo objects works');

// keyboard: tab reaches chips and dropzone
await p.focus('.chip'); await p.keyboard.press('Tab'); assert.ok(await p.evaluate(() => document.activeElement.classList.contains('chip'))); ok('keyboard focus moves between subject chips');

// no horizontal overflow on narrow screens
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 391)); ok('no horizontal overflow at 390px');

assert.deepEqual(errors, [], 'console errors: ' + errors.join(' | '));
ok('no page or console errors');
await b.close();
