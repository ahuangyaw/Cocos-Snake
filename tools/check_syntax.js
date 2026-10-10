/**
 * 用编辑器自带的 TypeScript 编译器检查脚本语法。
 *
 * 为什么需要它：
 *   我没有 Cocos 编辑器，无法预览运行。但语法错误（少括号、少逗号、拼错结构）
 *   是「一跑就崩」的最常见原因，而这类错误**不需要引擎类型就能查出来**。
 *   这个脚本用 TS 的 transpileModule 做纯语法/局部语义检查。
 *
 * 用法：
 *   node tools/check_syntax.js assets/scripts/*.ts
 */
const fs = require('fs');
const path = require('path');

const TS_PATH = process.argv[2];
const files = process.argv.slice(3);

if (!TS_PATH || files.length === 0) {
  console.error('用法: node check_syntax.js <typescript.js 路径> <待检查的 .ts 文件...>');
  process.exit(2);
}

let ts;
try {
  ts = require(TS_PATH);
} catch (e) {
  console.error('无法加载 TypeScript 编译器:', e.message);
  process.exit(2);
}

console.log('TypeScript 版本:', ts.version);
console.log('='.repeat(70));

let failed = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ES2015,
      experimentalDecorators: true,
      isolatedModules: true,
      removeComments: false,
    },
    fileName: path.basename(file),
    reportDiagnostics: true,
  });

  const diags = result.diagnostics || [];
  const errors = diags.filter(d => d.category === ts.DiagnosticCategory.Error);

  if (errors.length === 0) {
    const lines = src.split('\n').length;
    console.log(`OK    ${path.basename(file)}  (${lines} 行, 编译产出 ${result.outputText.length} 字节)`);
  } else {
    failed++;
    console.log(`FAIL  ${path.basename(file)}`);
    for (const d of errors) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n    ');
      let where = '';
      if (d.file && typeof d.start === 'number') {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        where = ` 第${pos.line + 1}行 第${pos.character + 1}列`;
      }
      console.log(`      [TS${d.code}]${where} ${msg}`);
    }
  }
}

console.log('='.repeat(70));
console.log(failed === 0 ? `全部通过：${files.length} 个文件 ✅` : `${failed} 个文件有语法错误 ❌`);
process.exit(failed === 0 ? 0 : 1);
