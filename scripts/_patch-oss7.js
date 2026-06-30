const fs = require('fs');
let s = fs.readFileSync('src/dingtalk/client.js', 'utf8');
// 找 attachmentPutToOsS 整段（用附件标志行定位）
const start = s.indexOf('/** 把分块 PUT 到 OSS');
if (start < 0) { console.log('NOT FOUND'); process.exit(1); }
let depth = 0, i = s.indexOf('{', start), end = -1;
for (; i < s.length; i++) { if (s[i]==='{') depth++; else if (s[i]==='}') {depth--; if(depth===0) {end=i+1; break;}} }
const oldFn = s.substring(start, end);
const newFn = `/** 把分块 PUT 到 OSS（用 fetch，Content-Type 留空匹配 OSS 签名） */
async function attachmentPutToOss({ uploadUrl, filePath, headers }) {
  const fs = require('fs');
  const buf = fs.readFileSync(filePath);
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    body: buf,
    headers: {
      'Content-Length': String(buf.length),
      // OSS v1 签名：如果没有 Content-Type header，签名里 Content-Type 字段是空字符串
      // 不要主动设 Content-Type: 'application/octet-stream'（会干扰签名）
      ...headers,
    },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('OSS PUT failed ' + resp.status + ': ' + errText);
  }
  return { statusCode: resp.status, body: await resp.text() };
}`;
s = s.substring(0, start) + newFn + s.substring(end);
fs.writeFileSync('src/dingtalk/client.js', s);
console.log('OK');
