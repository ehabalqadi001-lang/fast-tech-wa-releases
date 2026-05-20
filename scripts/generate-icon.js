'use strict';
/**
 * Generate app icon from assets/icon.svg
 * Uses Puppeteer to render SVG → PNG → ICO
 * Usage: node scripts/generate-icon.js
 */

const fs   = require('fs');
const path = require('path');

const ASSETS  = path.join(__dirname, '..', 'assets');
const SVG_SRC = path.join(ASSETS, 'icon.svg');
const OUT_PNG = path.join(ASSETS, 'logo-generated.png');
const OUT_ICO = path.join(ASSETS, 'icon.ico');

if (!fs.existsSync(ASSETS)) fs.mkdirSync(ASSETS, { recursive: true });

const svgContent = fs.readFileSync(SVG_SRC, 'utf8');

const ICON_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1024px; height: 1024px; background: #0a0e17; overflow: hidden; }
.wrap {
  width: 1024px; height: 1024px;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 40% 35%, #0d1830 0%, #080e1c 60%, #040810 100%);
}
svg { width: 1024px; height: 1024px; }
</style>
</head>
<body>
<div class="wrap">
${svgContent}
</div>
</body>
</html>`;

async function run() {
  let pngBuffer;

  console.log('Rendering SVG icon with Puppeteer...');
  try {
    const puppeteer = require('puppeteer');
    const browser   = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
    await page.setContent(ICON_HTML, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 500));
    pngBuffer = await page.screenshot({
      clip: { x: 0, y: 0, width: 1024, height: 1024 },
      omitBackground: false,
    });
    await browser.close();
    fs.writeFileSync(OUT_PNG, pngBuffer);
    console.log('PNG saved →', OUT_PNG);
  } catch (err) {
    console.error('Puppeteer failed:', err.message);
    process.exit(1);
  }

  const toIco    = require('to-ico');
  const { Jimp } = require('jimp');
  const img      = await Jimp.fromBuffer(pngBuffer);
  const sizes    = [16, 24, 32, 48, 64, 128, 256];
  console.log('Generating ICO sizes:', sizes.join(', '));

  const pngs = await Promise.all(
    sizes.map(async s => {
      const clone = img.clone();
      clone.resize({ w: s, h: s });
      return clone.getBuffer('image/png');
    })
  );

  const ico = await toIco(pngs);
  fs.writeFileSync(OUT_ICO, ico);
  console.log('SUCCESS: icon.ico →', OUT_ICO);

  // Also copy as logo.png at 512x512
  const logo512 = img.clone();
  logo512.resize({ w: 512, h: 512 });
  const logoBuf = await logo512.getBuffer('image/png');
  fs.writeFileSync(path.join(ASSETS, 'logo.png'), logoBuf);
  console.log('SUCCESS: logo.png (512x512) →', path.join(ASSETS, 'logo.png'));
}

run().catch(err => { console.error('Failed:', err.message); process.exit(1); });
