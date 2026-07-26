// scripts/auto-login.js —— 手动登录 Lovart，自动保存 cookies（无需手动按回车）
// 用法：
//   node scripts/auto-login.js              # 默认 300 秒超时
//   node scripts/auto-login.js --timeout=600 --min-wait=30
// 流程：
//   1. 弹出浏览器（headless=false）打开 Lovart
//   2. 用户手动登录（Google / Apple / 邮箱）
//   3. 检测到登录态（auth cookie / localStorage token）→ 自动保存 cookies 并退出
//   4. 兜底：超时后保存当前所有 cookies（可能不够，但聊胜于无）
'use strict';

const { chromium } = require('playwright');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
);
const TIMEOUT_MS = parseInt(args.timeout || '300', 10) * 1000;
const MIN_WAIT_MS = parseInt(args['min-wait'] || '30', 10) * 1000;

// 登录态判定：cookie / localStorage 名字匹配这些模式
const AUTH_PATTERNS = [
  /token/i,
  /^auth/i,
  /jwt/i,
  /session/i,
  /^user[-_]?id/i,
  /^access/i,
  /^refresh/i,
  /sso/i,
];

// 第三方追踪 cookie（必须排除，否则 Hotjar / GA 会被误判）
// 注意：用前缀匹配，因为 Hotjar = _hjSessionUser_xxx / _hjSession_xxx，名字带后缀
const TRACKING_PREFIX = [
  '_hj', '_ga', '_gid', '_fbp', '_fbc', '_clck', '_clsk',
  '_pin_unauth', '_ttp', '_tt_enable_cookie', 'ttcsid',
  '_uet', '_ym_', 'yandexuid', 'yuidss', 'ymex', '_gcl',
  'receive-cookie-deprecation', 'guest_id', '_yasc', 'CLID',
  'MUID', 'SRM_B', 'ANONCHK', 'yabs-sid', '__cf_bm', '_cfuvid', 'test_cookie',
  // 第三方 localStorage key 前缀（也算追踪）
  'statsig', 'gtag', 'ga:', 'fb_', '_hj', 'pin_',
];
const TRACKING_EXACT = new Set(['MR', 'SM', 'bh', 'i']);
function isTracking(name) {
  if (!name) return false;
  if (TRACKING_EXACT.has(name)) return true;
  return TRACKING_PREFIX.some((p) => name.startsWith(p));
}

// 真正的 auth cookie 应该是长 JWT（>30 字符）。短值一律视为追踪/状态
const MIN_AUTH_VALUE_LEN = 30;

function hasAuth(state) {
  const cookies = state?.cookies || [];
  // 1) 排除第三方追踪 cookie，看剩下的里有没有 auth-looking（且值要够长）
  const realCookies = cookies.filter((c) => !isTracking(c.name));
  for (const c of realCookies) {
    if (AUTH_PATTERNS.some((re) => re.test(c.name || ''))) {
      const valLen = (c.value || '').length;
      if (valLen >= MIN_AUTH_VALUE_LEN) {
        return { ok: true, source: 'cookie', name: c.name, domain: c.domain, valueLen: valLen };
      }
    }
  }
  // 2) localStorage 里找 auth token（同样排除第三方 + 值要够长）
  const origins = state?.origins || [];
  for (const o of origins) {
    for (const ls of o.localStorage || []) {
      if (isTracking(ls.name)) continue; // 排除 Statsig/gtag 等
      if (AUTH_PATTERNS.some((re) => re.test(ls.name || ''))) {
        const valLen = (ls.value || '').length;
        if (valLen >= MIN_AUTH_VALUE_LEN) {
          return { ok: true, source: 'localStorage', name: ls.name, origin: o.origin, valueLen: valLen };
        }
      }
    }
  }
  return { ok: false };
}

(async () => {
  console.log(`[auto-login] 启动浏览器 (timeout=${TIMEOUT_MS/1000}s min-wait=${MIN_WAIT_MS/1000}s)...`);
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log(`[auto-login] 已打开 ${page.url()}`);
  console.log('[auto-login] 请在弹出的浏览器里完成登录（Google / Apple / 邮箱）');
  console.log(`[auto-login] 至少 ${MIN_WAIT_MS/1000}s 后才开始检测，给你登录时间`);

  const start = Date.now();
  let saved = false;

  const trySave = async (reason) => {
    if (saved) return;
    saved = true;
    try {
      const state = await ctx.storageState();
      auth.save(state);
      const cookieCount = state.cookies?.length || 0;
      console.log(`[auto-login] ✅ cookies 已保存 (${cookieCount} 个) — 触发原因: ${reason}`);
      if (cookieCount < 5) {
        console.log('[auto-login] ⚠️ cookie 数量偏少，可能没登录成功，建议检查浏览器');
      }
    } catch (e) {
      console.error('[auto-login] ❌ 保存失败:', e.message);
    }
    try { await browser.close(); } catch {}
    process.exit(0);
  };

  const poll = setInterval(async () => {
    const elapsed = Date.now() - start;
    if (elapsed < MIN_WAIT_MS) return; // 给用户登录时间

    if (elapsed >= TIMEOUT_MS) {
      clearInterval(poll);
      await trySave('timeout');
      return;
    }

    try {
      const state = await ctx.storageState();
      const check = hasAuth(state);
      if (check.ok) {
        clearInterval(poll);
        console.log(`[auto-login] 检测到登录态: ${check.source}=${check.name}，多等 2s 让 cookies 全部写入...`);
        setTimeout(() => trySave(`${check.source}=${check.name}`), 2000);
      } else {
        const cookieCount = state.cookies?.length || 0;
        if (elapsed % 15000 < 1500) {
          // 每 15 秒提示一次进度（避免日志太吵）
          console.log(`[auto-login] 等待登录... (已 ${Math.floor(elapsed/1000)}s，当前 ${cookieCount} cookies)`);
        }
      }
    } catch (e) {
      // ignore polling errors
    }
  }, 1500);

  process.on('SIGINT', async () => {
    clearInterval(poll);
    await trySave('SIGINT');
  });
})().catch((e) => {
  console.error('[auto-login] ❌ 失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});