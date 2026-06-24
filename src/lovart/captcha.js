// src/lovart/captcha.js —— hCaptcha 自动求解（via 2Captcha）
// 流程：
//   1) 在页面里找 hCaptcha iframe / sitekey
//   2) 调 2Captcha API 提交
//   3) 轮询直到拿到 h-captcha-response token
//   4) 注入到页面的 textarea + 触发 callback
'use strict';

const config = require('../config');
const { sleep } = require('../utils/sleep');

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * 提交 captcha 任务到 2Captcha 并轮询
 * @param {string} sitekey
 * @param {string} pageUrl
 * @returns {Promise<string>} h-captcha-response token
 */
async function solveHCaptcha(sitekey, pageUrl) {
  if (!config.captcha.twoCaptchaApiKey) {
    throw new Error('TWO_CAPTCHA_API_KEY 未配置（在 .env 里设置）');
  }
  const key = config.captcha.twoCaptchaApiKey;
  const apiBase = config.captcha.apiBase;

  // Step 1: 提交任务
  const submitUrl = `${apiBase}/in.php?` + new URLSearchParams({
    key,
    method: 'hcaptcha',
    sitekey,
    pageurl: pageUrl,
    json: '1',
    soft_id: '4599', // Lovart 项目专用，可选
  });
  const submitResp = await fetch(submitUrl);
  const submitJson = await submitResp.json();
  if (submitJson.status !== 1) {
    throw new Error(`2Captcha 提交失败: ${JSON.stringify(submitJson)}`);
  }
  const taskId = submitJson.request;
  console.log(`[captcha] 已提交任务 taskId=${taskId}`);

  // Step 2: 轮询
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pollUrl = `${apiBase}/res.php?` + new URLSearchParams({
      key,
      action: 'get',
      id: taskId,
      json: '1',
    });
    const pollResp = await fetch(pollUrl);
    const pollJson = await pollResp.json();
    if (pollJson.status === 1) {
      console.log(`[captcha] ✅ 求解完成（${Math.round((Date.now() - start) / 1000)}s）`);
      return pollJson.request; // h-captcha-response token
    }
    if (pollJson.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2Captcha 轮询失败: ${JSON.stringify(pollJson)}`);
    }
  }
  throw new Error('2Captcha 求解超时');
}

/**
 * 在 Lovart 页面里检测 hCaptcha 并自动求解
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} 是否真解了 captcha
 */
async function detectAndSolveHCaptcha(page) {
  // 检查是否有 hCaptcha（多种方式：iframe / data-sitekey / hCaptcha 容器）
  const hcInfo = await page.evaluate(() => {
    // 1) 找 hCaptcha iframe（含 about:blank 嵌入的）
    const allIframes = Array.from(document.querySelectorAll('iframe'));
    let hcIframe = allIframes.find((f) => /hcaptcha\.com/i.test(f.src || ''));
    let sitekey = '';
    let iframeSrc = '';

    if (hcIframe) {
      iframeSrc = hcIframe.src || '';
      const m = iframeSrc.match(/sitekey=([a-f0-9-]+)/i);
      if (m) sitekey = m[1];
    }

    // 2) 找 data-sitekey 元素
    if (!sitekey) {
      const sk = document.querySelector('[data-sitekey]');
      if (sk) sitekey = sk.getAttribute('data-sitekey') || '';
    }

    // 3) 找 hCaptcha widget div（可能在 hidden iframe 里，需要查所有层级）
    const hcWidget = document.querySelector('[data-hcaptcha-widget-id], .h-captcha, [class*="hcaptcha"]');
    if (!sitekey && hcWidget) {
      sitekey = hcWidget.getAttribute('data-sitekey') || '';
    }

    // 4) 找页面 text 含 "hCaptcha" / "hcaptcha" / "隐私 - 条款" 验证存在
    const bodyText = (document.body?.innerText || '').slice(0, 5000);
    const looksLikeCaptcha = /hCaptcha|hcaptcha|我是真实访客|隐私\s*[-–—]\s*条款|继续之前.+安全性|Browser verification/i.test(bodyText);

    return {
      present: !!(hcIframe || hcWidget || looksLikeCaptcha),
      sitekey,
      iframeSrc,
      widgetFound: !!hcWidget,
      iframeFound: !!hcIframe,
      textFound: looksLikeCaptcha,
    };
  });

  if (!hcInfo.present) {
    return false;
  }
  if (!hcInfo.sitekey) {
    console.warn('[captcha] hCaptcha 检测到但没 sitekey（尝试从 iframe 拿）:', JSON.stringify(hcInfo));
    // 兜底：如果有 iframe 但没 sitekey，从 iframe DOM 里取
    if (hcInfo.iframeFound) {
      const sk2 = await page.evaluate(() => {
        const f = Array.from(document.querySelectorAll('iframe')).find((f) => /hcaptcha\.com/i.test(f.src || ''));
        try {
          const idoc = f.contentDocument || f.contentWindow?.document;
          const sk = idoc?.querySelector?.('[data-sitekey]')?.getAttribute?.('data-sitekey');
          return sk || '';
        } catch (e) { return ''; }
      });
      if (sk2) hcInfo.sitekey = sk2;
    }
    if (!hcInfo.sitekey) {
      throw new Error('hCaptcha 出现但拿不到 sitekey，请人工处理');
    }
  }
  console.log(`[captcha] 检测到 hCaptcha sitekey=${hcInfo.sitekey} (iframeSrc=${hcInfo.iframeSrc.slice(0, 80)})`);

  const pageUrl = page.url();
  const token = await solveHCaptcha(hcInfo.sitekey, pageUrl);

  // 注入 token 到 hCaptcha response textarea + 触发 callback
  await page.evaluate((token) => {
    // hCaptcha 的 textarea 名字是 h-captcha-response
    const ta = document.querySelector('textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"]');
    if (ta) {
      ta.value = token;
      ta.style.display = 'block';
    }
    // 触发 change/input 事件
    if (ta) {
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 触发 hCaptcha 的回调（多种命名）
    const tryCall = (name) => {
      try {
        const fn = window[name];
        if (typeof fn === 'function') {
          fn(token);
          console.log('[captcha] 调用回调', name);
        }
      } catch (e) {}
    };
    ['hcaptchaCallback', 'onCaptchaSuccess', 'captchaCallback', 'onHCaptchaSuccess'].forEach(tryCall);

    // hCaptcha 标准 API：window.hcaptcha.getResponse() 或 callback
    try {
      if (window.hcaptcha && typeof window.hcaptcha.setResponse === 'function') {
        window.hcaptcha.setResponse(token);
        console.log('[captcha] window.hcaptcha.setResponse 调用');
      }
    } catch (e) {}

    // 兜底：找 form submit
    const form = ta?.closest('form');
    if (form) {
      try { form.submit(); } catch (e) {}
    }
  }, token);

  // 等几秒让 Lovart 处理 token
  await sleep(2000);
  return true;
}

module.exports = { detectAndSolveHCaptcha, solveHCaptcha };