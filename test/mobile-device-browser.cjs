'use strict';

/*
 * Narrow-phone browser regression. Existing visual smoke primarily covers
 * 390px, so this checks 320/375/430px with real mobile viewport emulation.
 * All business routes use explicit fictional demo data; no account/API writes.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { buildStatic } = require('../scripts/build-static.js');

const root = buildStatic();
const artifacts = path.resolve(__dirname, '..', 'test-artifacts', 'mobile');
fs.mkdirSync(artifacts, { recursive: true });

const routes = [
  { id: 'dashboard', url: 'portal/dashboard.html?demo=1' },
  { id: 'receivables', url: 'portal/index.html?demo=1' },
  { id: 'invoices', url: 'portal/invoices.html?demo=1' },
  { id: 'accounting', url: 'portal/accounting.html?demo=1' },
  { id: 'ai-bookkeeping', url: 'portal/ai-bookkeeping.html?demo=1' },
  { id: 'payments', url: 'portal/payments.html?demo=1' },
  { id: 'unplaced', url: 'portal/unplaced-payments.html?demo=1' },
  { id: 'payables', url: 'portal/payables.html?demo=1' },
  { id: 'documents', url: 'portal/documents.html?demo=1' },
  { id: 'year-close', url: 'portal/bokslut.html?demo=1' },
  { id: 'operator-login', url: 'operator/index.html' }
];
const devices = [
  { width: 320, height: 680 },
  { width: 375, height: 812 },
  { width: 430, height: 932 }
];
const schemes = ['light', 'dark'];

function mime(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2'
  })[path.extname(file)] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!url.pathname.startsWith('/Rollands/')) { res.writeHead(404); res.end(); return; }
  let relative = decodeURIComponent(url.pathname.slice('/Rollands/'.length));
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

function check(problemList, condition, description) {
  if (!condition) problemList.push(description);
}

(async () => {
  let browser;
  const problems = [];
  let inspected = 0;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/Rollands/';
    browser = await chromium.launch({ headless: true });

    for (const device of devices) {
      for (const colorScheme of schemes) {
        const context = await browser.newContext({
          viewport: device,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          colorScheme
        });

        for (const route of routes) {
          const page = await context.newPage();
          const label = route.id + ' ' + device.width + 'px ' + colorScheme;
          const caseProblems = [];
          const jsErrors = [];
          page.on('pageerror', error => jsErrors.push(error.message));

          try {
            const response = await page.goto(new URL(route.url, base).href, {
              waitUntil: 'domcontentloaded',
              timeout: 20000
            });
            check(caseProblems, Boolean(response) && response.status() === 200, 'Page did not load (HTTP 200 expected)');
            await page.waitForSelector(route.id === 'operator-login' ? '.login-shell' : '.topbar', {
              state: 'visible',
              timeout: 13000
            });
            await page.waitForTimeout(220);

            const state = await page.evaluate(() => {
              const visible = el => {
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                  && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
              };
              const regions = [
                ...document.querySelectorAll(
                  '.shared-workspace-shell, .reports-main, .dash-main, .main-area, ' +
                  '.accounting-content, .dashboard-content, .payments-content, .content, ' +
                  '.operator-shell, .operator-shell .main, .topbar'
                )
              ].filter(visible).map(el => {
                const box = el.getBoundingClientRect();
                return { className: String(el.className).slice(0, 70),
                  left: Math.round(box.left), right: Math.round(box.right) };
              }).filter(box => box.left < -2 || box.right > innerWidth + 2).slice(0, 8);

              const tinyFields = [
                ...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea')
              ].filter(visible).map(el => ({
                name: el.getAttribute('name') || el.getAttribute('data-field') || el.tagName,
                pixels: Number.parseFloat(getComputedStyle(el).fontSize)
              })).filter(el => el.pixels < 15.9).slice(0, 8);

              const toggle = document.querySelector('.shared-menu-toggle');
              const toggleRect = toggle && visible(toggle) ? toggle.getBoundingClientRect() : null;
              const userTrigger = document.querySelector('.shared-user-trigger');
              const userRect = userTrigger && visible(userTrigger) ? userTrigger.getBoundingClientRect() : null;
              const report = document.querySelector('.payments-content .report-table-wrap');
              return {
                innerWidth,
                layoutViewport: document.documentElement.clientWidth,
                documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                visualScale: window.visualViewport?.scale || 1,
                bodyTextLength: document.body.innerText.trim().length,
                viewportMeta: document.querySelector('meta[name="viewport"]')?.content || '',
                regions,
                tinyFields,
                menu: toggleRect ? {
                  x: toggleRect.x, right: toggleRect.right,
                  width: toggleRect.width, height: toggleRect.height
                } : null,
                user: userRect ? { x: userRect.x, right: userRect.right } : null,
                reportScroll: report ? {
                  client: report.clientWidth,
                  scroll: report.scrollWidth,
                  left: report.getBoundingClientRect().left,
                  right: report.getBoundingClientRect().right
                } : null
              };
            });

            check(caseProblems, state.bodyTextLength > 40, 'Page has too little visible text');
            check(caseProblems, state.innerWidth === device.width, 'Unexpected CSS viewport width: ' + state.innerWidth);
            check(caseProblems, state.layoutViewport === device.width, 'Layout viewport is not phone width: ' + state.layoutViewport);
            check(caseProblems, state.documentWidth <= device.width + 2,
              'Whole-page horizontal overflow (' + state.documentWidth + 'px)');
            check(caseProblems, state.visualScale === 1,
              'Page started zoomed at scale ' + state.visualScale);
            check(caseProblems, /width=device-width/.test(state.viewportMeta),
              'Device-width meta viewport missing');
            check(caseProblems, state.regions.length === 0,
              'Main section wider than screen: ' + JSON.stringify(state.regions));
            check(caseProblems, state.tinyFields.length === 0,
              'iPhone auto-zoom risk (form text below 16px): ' + JSON.stringify(state.tinyFields));
            check(caseProblems, jsErrors.length === 0, 'JavaScript errors: ' + jsErrors.join('; '));

            if (route.id !== 'operator-login') {
              check(caseProblems, Boolean(state.menu), 'Mobile navigation button missing');
              if (state.menu) {
                check(caseProblems, state.menu.x >= 0 && state.menu.right <= device.width + 1,
                  'Navigation button outside screen');
                check(caseProblems, state.menu.width >= 40 && state.menu.height >= 40,
                  'Navigation touch target below 40px');
              }
              if (state.user) {
                check(caseProblems, state.user.x >= -1 && state.user.right <= device.width + 1,
                  'Account button outside screen');
              }
            }

            if (route.id === 'payments') {
              check(caseProblems, Boolean(state.reportScroll), 'Payment table scroll container missing');
              if (state.reportScroll) {
                check(caseProblems, state.reportScroll.right <= device.width + 2 &&
                  state.reportScroll.left >= -2, 'Payment table container crosses viewport');
              }
            }

            /* Tap interactions: menu must open, lock the page and close again.
             * These run on every phone size, with touch emulation. */
            if (route.id === 'dashboard' && colorScheme === 'light') {
              const toggle = page.locator('.shared-menu-toggle');
              await toggle.tap();
              check(caseProblems, await toggle.getAttribute('aria-expanded') === 'true',
                'Hamburger menu did not open on touch');
              check(caseProblems, await page.locator('body.shared-mobile-nav-lock').count() === 1,
                'Opening menu did not lock background scrolling');
              await page.keyboard.press('Escape');
              check(caseProblems, await toggle.getAttribute('aria-expanded') === 'false',
                'Escape did not close mobile menu');
              check(caseProblems, await page.locator('body.shared-mobile-nav-lock').count() === 0,
                'Closing menu did not restore background scrolling');
            }

            if (
              (route.id === 'dashboard' || route.id === 'payments' || route.id === 'operator-login' || route.id === 'ai-bookkeeping') &&
              (device.width === 320 || device.width === 430)
            ) {
              await page.screenshot({
                path: path.join(artifacts, route.id + '-' + device.width + '-' + colorScheme + '.png'),
                fullPage: true
              });
            }
            inspected += 1;
          } catch (error) {
            caseProblems.push(error.stack || error.message || String(error));
            try {
              await page.screenshot({ path: path.join(artifacts,
                'failure-' + route.id + '-' + device.width + '-' + colorScheme + '.png'), fullPage: true });
            } catch {}
          } finally {
            if (caseProblems.length) problems.push(label + ': ' + caseProblems.join(' | '));
            await page.close();
          }
        }
        await context.close();
      }
    }

    console.log('Checked ' + inspected + ' mobile page/theme/device combinations.');
    fs.writeFileSync(path.join(artifacts, 'mobile-qa-report.json'),
      JSON.stringify({ inspected, errors: problems }, null, 2) + '\n');
    assert.deepEqual(problems, [], 'Narrow-phone usability failures:\n' + problems.join('\n'));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
