const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const config = require('../src/config');
const { uploadImageToField, uploadImagesToField } = require('../src/dingtalk/upload');
const { fetchProductRows } = require('../src/dingtalk/sheets');

function createTestImage(filePath) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(filePath, png);
}

(async () => {
  console.log('=== 测试钉钉附件上传回传 ===\n');
  console.log('1. 拉取生图表');
  const productRows = await fetchProductRows();
  console.log(`   共 ${productRows.length} 行\n`);

  const tmpDir = path.resolve(__dirname, '..', 'data', 'test-uploads');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const ts = Date.now();
  const colors = ['red', 'green', 'blue', 'yellow', 'purple'];
  const testFiles = colors.map((c, i) => {
    const fp = path.join(tmpDir, `test-${c}-${ts}-${i + 1}.png`);
    createTestImage(fp);
    return fp;
  });
  console.log('2. 创建 5 张测试图');
  testFiles.forEach((f) => console.log(`   - ${path.basename(f)} (${fs.statSync(f).size} bytes)`));
  console.log('');

  const targetRecordId = '7Gtfo83ZWU';
  const resultField = config.dingtalk.fields.product.result;

  console.log(`3. 测试单张上传到 ${targetRecordId} 的 ${resultField}`);
  try {
    await uploadImageToField({ recordId: targetRecordId, fieldId: resultField, filePath: testFiles[0] });
    console.log(`   ✓ 单张上传成功: ${path.basename(testFiles[0])}`);
  } catch (e) {
    console.log(`   ❌ 上传失败: ${e.message}`);
  }
  console.log('');

  console.log(`4. 测试批量上传剩余 4 张到 ${resultField}`);
  try {
    const results = await uploadImagesToField(targetRecordId, resultField, testFiles.slice(1));
    console.log(`   ✓ 批量上传: ${results.length} 张成功`);
  } catch (e) {
    console.log(`   ❌ 批量失败: ${e.message}`);
  }
  console.log('');

  console.log('5. 验证（拉回记录看附件）');
  try {
    const out = execFileSync('dws', [
      'aitable', 'record', 'get',
      '--base-id', config.dingtalk.baseId,
      '--table-id', config.dingtalk.productTableId,
      '--record-ids', targetRecordId,
      '--format', 'json',
    ], { encoding: 'utf8' });
    const json = JSON.parse(out);
    const field = json.data?.records?.[0]?.cells?.[resultField];
    if (Array.isArray(field)) {
      console.log(`   ${resultField} 字段现有 ${field.length} 个附件:`);
      field.forEach((a, i) => console.log(`     [${i + 1}] ${a.filename || a.name} (${a.size} bytes, type=${a.type})`));
    } else {
      console.log(`   字段 ${resultField} 存在但不是数组: ${typeof field}`);
    }
  } catch (e) {
    console.log(`   ❌ 验证失败: ${e.message}`);
  }
  console.log('');

  console.log('6. 清理测试图');
  testFiles.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
  try { fs.rmdirSync(tmpDir); } catch (_) {}
  console.log('   ✓ 已清理\n');
  console.log('=== 测试完成 ===');
  process.exit(0);
})().catch((e) => {
  console.error('❌ 错误:', e.message);
  process.exit(1);
});
