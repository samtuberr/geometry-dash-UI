import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByText('10 meshes · 43 predictions')).toBeVisible(); });
const ascii = `solid sample\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid sample`;
function binary() { const buffer = Buffer.alloc(134); buffer.writeUInt32LE(1, 80); [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((value, i) => buffer.writeFloatLE(value, 84 + i * 4)); return buffer; }

test('real sample, source IDs, picking, isolation, overlays and parameters', async ({ page }) => {
  await page.locator('.mesh-card').nth(1).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.canvas-error')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Parameters' }).click();
  await expect(page.locator('#detail-content')).toContainText('Radius2.00000');
  await page.locator('#triangle-id').fill('80'); await page.getByRole('button', { name: 'Inspect triangle', exact: true }).click();
  await expect(page).toHaveURL(/segment=1/); await expect(page.locator('.hover-card')).toContainText('Triangle 80'); await expect(page.locator('.hover-card')).toContainText('(0, 0, -1.000)');
  await page.keyboard.press('Escape'); await expect(page.locator('.hover-card')).toHaveCount(0);
  await page.locator('canvas').click(); await expect(page.locator('.hover-card')).toContainText('PINNED'); await expect(page).toHaveURL(/segment=0/);
  await page.getByLabel('Fitted primitive', { exact: true }).check(); await page.getByRole('button', { name: 'Isolate selected' }).click();
  await expect(page.getByLabel('Show segment 0')).toBeChecked(); await expect(page.getByLabel('Show segment 1')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const frameHash = async () => { const data = await page.locator('canvas').evaluate(async (c: HTMLCanvasElement) => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return c.toDataURL(); }); return createHash('sha256').update(data).digest('hex'); };
  const image = await frameHash();
  await page.getByRole('link', { name: 'Results', exact: true }).click(); await page.getByRole('link', { name: '3D Inspector' }).click();
  await expect(page.getByLabel('Show segment 1')).not.toBeChecked(); await expect(page.getByLabel('Fitted primitive', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Front', exact: true })).toHaveClass('active');
  await expect.poll(frameHash).toBe(image);
});

test('results filter persists across inspection and original JSON export stays unchanged', async ({ page }) => {
  await page.getByRole('link', { name: 'Results', exact: true }).click(); await page.getByLabel('Search results').fill('mesh_09');
  await expect(page.locator('tbody tr')).toHaveCount(1); await expect(page.locator('tbody')).toContainText('Unresolved'); await expect(page.locator('tbody')).toContainText('Failed');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Predictions JSON' }).click()]);
  const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe(readFileSync('public/sample/predictions.json', 'utf8'));
  await page.getByRole('button', { name: 'Inspect mesh_09 segment 0' }).click(); await expect(page.getByLabel('Fitted primitive', { exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Parameters' }).click(); await expect(page.locator('#detail-content')).toContainText('Attempted cylinder');
  await page.getByRole('link', { name: 'Results', exact: true }).click(); await expect(page.getByLabel('Search results')).toHaveValue('mesh_09');
});

for (const encoding of ['ASCII', 'binary']) test(`${encoding} STL imports through the actual file picker and renders`, async ({ page }) => {
  await page.getByRole('button', { name: 'Import geometry', exact: true }).click();
  await page.getByLabel('Choose STL file', { exact: true }).setInputFiles({ name: `${encoding.toLowerCase()}.stl`, mimeType: 'model/stl', buffer: encoding === 'ASCII' ? Buffer.from(ascii) : binary() });
  await expect(page.getByText('Ready to inspect')).toBeVisible(); await page.getByRole('button', { name: 'Open dataset', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/meshes/${encoding.toLowerCase()}$`)); await expect(page.locator('.canvas-footer')).toContainText('1 triangles');
  await expect(page.locator('canvas')).toBeVisible(); await expect(page.locator('.canvas-error')).toHaveCount(0);
  await expect(page.getByLabel('Segment colors', { exact: true })).toBeDisabled(); await expect(page.getByLabel('Fitted primitive', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Inspect triangle', exact: true }).click(); await expect(page.locator('.hover-card')).toContainText('50.000 model units²');
  await expect(page.locator('.hover-card')).toContainText('SegmentNot supplied');
});

test('imports the upstream directory and reports malformed predictions without replacing the current workspace', async ({ page }) => {
  await page.getByRole('button', { name: 'Import geometry', exact: true }).click();
  await page.getByLabel('Choose dataset directory', { exact: true }).setInputFiles(path.resolve('public/sample'));
  await expect(page.getByText('Ready to inspect')).toBeVisible(); await expect(page.locator('.validation-panel')).toContainText('43 predictions');
  await page.getByRole('button', { name: 'Open dataset', exact: true }).click(); await expect(page).toHaveURL(/mesh_01\?segment=0/);
  await page.getByRole('button', { name: 'Import geometry', exact: true }).click();
  const data = JSON.parse(readFileSync('public/sample/predictions.json', 'utf8')); data.predictions[0].confidence = 2;
  await page.getByLabel('Choose results files', { exact: true }).setInputFiles({ name: 'predictions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.getByText('Import needs attention')).toBeVisible(); await expect(page.locator('.validation-error')).toContainText('confidence');
  await expect(page.getByRole('button', { name: 'Open dataset', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '3D Inspector' }).click(); await expect(page.locator('.detail-title')).toContainText('Segment 0');
});

test('desktop, tablet and phone layouts keep all pages within the viewport', async ({ page }) => {
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/results', '/guide', '/import', '/meshes/mesh_08?segment=0']) {
      await page.goto(route); await expect(page.getByText('10 meshes · 43 predictions')).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${route}`).toBe(true);
      if (route.startsWith('/meshes')) { await expect(page.locator('canvas')).toBeVisible(); expect(await page.locator('canvas').evaluate(c => c.getBoundingClientRect().width)).toBeGreaterThan(200); }
    }
  }
});
