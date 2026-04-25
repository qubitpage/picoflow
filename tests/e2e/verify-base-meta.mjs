import { chromium } from 'playwright';

const URL = 'https://picoflow.qubitpage.com/';
const APP_ID = '69eca5f48502c283edbf948e';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('HTTP', resp.status(), resp.url());
console.log('Content-Type:', resp.headers()['content-type']);

// Read meta tag as a real browser would, after Next hydrates
const metas = await page.$$eval('meta[name="base:app_id"]', els =>
  els.map(e => ({ name: e.getAttribute('name'), content: e.getAttribute('content'), parent: e.parentElement?.tagName }))
);
console.log('META TAGS FOUND:', JSON.stringify(metas, null, 2));

const inHead = await page.evaluate(() => {
  const m = document.head.querySelector('meta[name="base:app_id"]');
  return m ? { content: m.getAttribute('content'), position: Array.from(document.head.children).indexOf(m) } : null;
});
console.log('FIRST IN <head>:', JSON.stringify(inHead));

const html = await page.content();
const fragment = html.substring(0, html.indexOf('</head>') + 7);
console.log('--- HEAD AS RENDERED BY BROWSER ---');
console.log(fragment.substring(0, 1500));

const ok = metas.some(m => m.content === APP_ID);
console.log('\nVERDICT:', ok ? 'PASS â€” base:app_id present, browser sees it' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
