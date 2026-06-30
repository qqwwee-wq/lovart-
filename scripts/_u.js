const fs = require('fs');
let s = fs.readFileSync('src/dingtalk/upload.js', 'utf8').replace(/\r\n/g, '\n');
const start = s.indexOf('/**\n * 上传单张图片');
let depth = 0, i = s.indexOf('{', start), end = -1;
for (; i < s.length; i++) { if (s[i]==='{') depth++; else if (s[i]==='}') {depth--; if(depth===0) {end=i+1; break;}} }
const newFn = `/**
 * 上传单张图片到生图表某行的某个 attachment 字段
 * 直接 dws record update + inline base64（dws 内部处理 OSS 上传）
 * dws 简化版 attachment upload 的 uploadUrl 是给 aliyun-sdk 内部用的，Node HTTP 调用永远 403
 * 但 record update 直接传 {fileName, fileType, data: base64} 会被 dws 内部上传
 */
async function uploadImageToField({ recordId, fieldId, filePath }) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  const base64 = buf.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  const fileType = mimeMap[ext] || 'application/octet-stream';
  log.debug('上传（inline base64）', { recordId, fieldId, fileName, size: stat.size });
  const cells = { [fieldId]: [{ fileName, fileType, data: base64 }] };
  return recordUpdate({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    records: [{ recordId, cells }],
  });
}`;
s = s.substring(0, start) + newFn + s.substring(end);
fs.writeFileSync('src/dingtalk/upload.js', s);
console.log('OK, new length:', s.length);
