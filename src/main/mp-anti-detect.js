'use strict';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.76',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const SCREEN_SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 2560, height: 1440 }
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomScreen() {
  return SCREEN_SIZES[Math.floor(Math.random() * SCREEN_SIZES.length)];
}

function randomDelay(min = 1000, max = 4000) {
  return Math.floor(Math.random() * (max - min)) + min + Math.floor(Math.random() * 300);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanDelay(min = 2, max = 8) {
  await sleep(randomDelay(min * 1000, max * 1000));
}

async function humanType(page, selector, text) {
  await page.click(selector);
  await sleep(randomDelay(300, 800));
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randomDelay(50, 180) });
    if (Math.random() < 0.03) await sleep(randomDelay(300, 900));
  }
}

async function humanScroll(page, distance = null) {
  const dist = distance || randomDelay(300, 1200);
  const steps = Math.ceil(dist / 100);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: 100 + Math.random() * 50 });
    await sleep(randomDelay(50, 200));
  }
}

async function humanMouseMove(page) {
  const x = Math.floor(Math.random() * 800) + 100;
  const y = Math.floor(Math.random() * 600) + 100;
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
}

async function injectStealth(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ar-EG', 'ar', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    window.chrome = { runtime: {} };
    const orig = window.navigator.permissions.query;
    window.navigator.permissions.query = (p) =>
      p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : orig(p);
  });
}

function spinText(template) {
  return template.replace(/\{([^}]+)\}/g, (_, group) => {
    const opts = group.split('|');
    return opts[Math.floor(Math.random() * opts.length)].trim();
  });
}

function detectRateLimit(html) {
  return ['You\'re Posting Too Fast', 'تنشر بسرعة كبيرة', 'Account Temporarily Blocked', 'محظور مؤقتاً', 'Your account has been temporarily']
    .some(p => html.toLowerCase().includes(p.toLowerCase()));
}

module.exports = {
  randomUA, randomScreen, randomDelay, sleep,
  humanDelay, humanType, humanScroll, humanMouseMove,
  injectStealth, spinText, detectRateLimit
};
