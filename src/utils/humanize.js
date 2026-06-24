// src/utils/humanize.js —— 模拟真人节奏（随机 delay + 鼠标移动 + 滚动）
'use strict';

const { sleep } = require('./sleep');

/**
 * 真人节奏的随机 sleep（默认 2-8 秒）
 * @param {number} min ms
 * @param {number} max ms
 */
async function humanSleep(min = 2000, max = 8000) {
  const ms = min + Math.random() * (max - min);
  await sleep(ms);
}

/**
 * 在页面里做几次随机鼠标移动（模拟人浏览）
 */
async function randomMouseMove(page) {
  try {
    const box = page.viewportSize() || { width: 1440, height: 900 };
    for (let i = 0; i < 3; i++) {
      const x = 100 + Math.random() * (box.width - 200);
      const y = 100 + Math.random() * (box.height - 200);
      await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
      await sleep(50 + Math.random() * 100);
    }
  } catch (e) {}
}

/**
 * 模拟真人滚动（少量 + 不规则）
 */
async function randomScroll(page) {
  try {
    const dy = (Math.random() < 0.5 ? -1 : 1) * (50 + Math.floor(Math.random() * 200));
    await page.mouse.wheel(0, dy);
  } catch (e) {}
}

module.exports = { humanSleep, randomMouseMove, randomScroll };