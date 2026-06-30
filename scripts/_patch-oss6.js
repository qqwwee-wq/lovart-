const fs = require('fs');
let s = fs.readFileSync('src/dingtalk/client.js', 'utf8');
// 找 attachmentPutToOsS 整段
const start = s.indexOf('async function attachmentPutToOss');
if (start < 0) { console.log('NO FUNC'); process.exit(1); }
let depth = 0, i = s.indexOf('{', start), end = -1;
for (; i < s.length; i++) { if (s[i]==='{') depth++; else if (s[i]==='}') {depth--; if(depth===0) {end=i+1; break;}} }
const oldFn = s.substring(start, end);
const newFn = `async function attachmentPutToOss({ uploadUrl, filePath, headers }) {
  const fs = require('fs');
  const buf = fs.readFileSync(filePath);
  // OSS v1 签名要求 Content-Type 为空（除非真有），其他 header 不加
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    body: buf,
    headers: {
      'Content-Length': String(buf.length),
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
