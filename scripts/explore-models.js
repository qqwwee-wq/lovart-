// scripts/explore-models.js —— 强行点 Agent 按钮（先关弹窗）拿到所有模型选项
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[explore-models]', ...a);

async function dumpVisible(page, label) {
  return await page.evaluate((label) => {
    const all = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"], [role="menuitem"], [role="option"], li, [data-state]'));
    const visible = all
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el, i) => ({
        i,
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        dataState: el.getAttribute('data-state') || '',
        text: (el.innerText || el.value || '').trim().slice(0, 80),
        aria: el.getAttribute('aria-label') || '',
        classes: (el.className || '').toString().slice(0, 150),
      }));
    return { label, count: visible.length, items: visible.slice(0, 80) };
  }, label);
}

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  log('1. 进入画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);

  // 抓页面所有文本，看哪些含 Nano Banana / 模型
  const allModelText = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const out = [];
    for (const el of all) {
      if (el.children.length > 3) continue;
      const txt = (el.innerText || '').trim();
      if (!txt) continue;
      if (/(Nano Banana|模型|model|Model)/i.test(txt) && txt.length < 200) {
        out.push({
          tag: el.tagName,
          text: txt,
          classes: (el.className || '').toString().slice(0, 120),
        });
      }
    }
    return out.slice(0, 50);
  });
  log('   含模型关键词的所有元素（点击前）:');
  allModelText.forEach((m) => console.log('   ', m.tag, JSON.stringify(m.text.slice(0, 80))));
  log('   ---');

  // 强力关弹窗（移除所有 data-state=open 的遮罩）
  log('2. 移除所有弹窗遮罩');
  await page.evaluate(() => {
    document.querySelectorAll('[data-state="open"][aria-hidden="true"]').forEach((el) => el.remove());
    document.querySelectorAll('[role="dialog"]').forEach((el) => {
      if (el.getAttribute('aria-hidden') === 'true' || el.querySelector('[aria-hidden="true"]')) {
        el.remove();
      }
    });
  });
  await page.waitForTimeout(500);

  log('3. 找 Agent 按钮');
  // Agent 按钮可能位置变了，用文字找
  const agentBtns = await page.$$('button:has-text("Agent")');
  log('   找到 ' + agentBtns.length + ' 个 Agent 按钮');
  if (agentBtns.length > 0) {
    log('4. 强行点 Agent 按钮（绕过遮挡检查）');
    try {
      await agentBtns[0].click({ force: true });
      log('   ✓ 已点 Agent');
      await page.waitForTimeout(2000);
    } catch (e) {
      log('   ✗ 点失败：' + e.message.slice(0, 100));
    }
  }

  const afterClick = await dumpVisible(page, 'after-agent-click');
  log('   展开后可见元素: ' + afterClick.count);

  // 找包含 Nano Banana / GPT / Seedance / Pro 的元素
  const modelItems = afterClick.items.filter((i) =>
    /Nano Banana|GPT Image|Seedance|Design|模型|model/i.test(i.text),
  );
  log('   含模型关键词的元素: ' + modelItems.length);
  modelItems.forEach((m) => {
    console.log('   ', m.tag, 'text=' + JSON.stringify(m.text.slice(0, 60)), 'state=' + m.dataState, 'role=' + m.role);
  });

  // 关掉弹窗
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 也看 send 按钮附近的小按钮
  log('5. 输入框附近的所有按钮');
  const inputArea = await page.$$eval('button', (els) => {
    return els
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.x >= 1000 && r.x <= 1430 && r.y >= 770 && r.y <= 900;
      })
      .map((b, i) => ({
        i,
        text: (b.innerText || '').trim().slice(0, 40),
        aria: b.getAttribute('aria-label') || '',
        classes: (b.className || '').toString().slice(0, 120),
        x: Math.round(b.getBoundingClientRect().x),
        y: Math.round(b.getBoundingClientRect().y),
        w: Math.round(b.getBoundingClientRect().width),
      }));
  });
  inputArea.forEach((b) => console.log('   ', JSON.stringify(b)));

  // 截屏
  try { await page.screenshot({ path: 'docs/lovart-models.png', fullPage: true }); } catch {}

  fs.writeFileSync('docs/lovart-models.json', JSON.stringify({ afterClick, modelItems, inputArea }, null, 2));
  log('✓ 已保存 docs/lovart-models.json');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});