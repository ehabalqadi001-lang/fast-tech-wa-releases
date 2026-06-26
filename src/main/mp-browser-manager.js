'use strict';
const path = require('path');
const { app } = require('electron');
const { randomUA, randomScreen, injectStealth } = require('./mp-anti-detect');

let puppeteer;
try {
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());
  puppeteer = puppeteerExtra;
} catch {
  puppeteer = require('puppeteer');
}

const activeBrowsers = new Map();

function getProfileDir(accountId) {
  return path.join(app.getPath('userData'), 'mp-browser-profiles', accountId);
}

async function launchBrowser(account) {
  if (activeBrowsers.has(account.id)) {
    const existing = activeBrowsers.get(account.id);
    try { await existing.pages(); return existing; } catch {}
    activeBrowsers.delete(account.id);
  }

  const screen = randomScreen();
  const ua = account.user_agent || randomUA();
  const profileDir = getProfileDir(account.id);

  const args = [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars', '--disable-dev-shm-usage',
    `--window-size=${screen.width},${screen.height}`
  ];
  if (account.proxy) args.push(`--proxy-server=${account.proxy}`);

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: profileDir,
    args,
    defaultViewport: { width: screen.width, height: screen.height }
  });

  browser._mpAccountId = account.id;
  browser._mpUA = ua;
  activeBrowsers.set(account.id, browser);

  browser.on('targetcreated', async (target) => {
    try {
      const page = await target.page();
      if (page) {
        await page.setUserAgent(ua).catch(() => {});
        await injectStealth(page).catch(() => {});
      }
    } catch {}
  });

  return browser;
}

async function getPage(account) {
  const browser = await launchBrowser(account);
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.setUserAgent(browser._mpUA).catch(() => {});
  await injectStealth(page).catch(() => {});
  return page;
}

async function closeBrowser(accountId) {
  if (activeBrowsers.has(accountId)) {
    try { await activeBrowsers.get(accountId).close(); } catch {}
    activeBrowsers.delete(accountId);
  }
}

async function closeAll() {
  for (const [id] of activeBrowsers) await closeBrowser(id);
}

module.exports = { launchBrowser, getPage, closeBrowser, closeAll };
