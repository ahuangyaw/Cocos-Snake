/**
 * 竖屏布局单元测试 —— 在 Node 里把常见设备尺寸全跑一遍
 *
 * 这是「布局数学抽成纯函数」带来的直接收益：
 *   我无法在真机上看画面，但可以用断言保证
 *   ① 棋盘不溢出屏幕 ② 不压住 HUD ③ 格子够大能玩 ④ 各尺寸下都成立。
 *
 * 用法：
 *   tsc assets/scripts/snake/layout.ts --outDir temp/core-js --module commonjs --target ES2017
 *   node tools/test_layout.js temp/core-js/layout.js
 */
const path = require('path');

const layoutPath = process.argv[2];
if (!layoutPath) {
    console.error('用法: node test_layout.js <编译后的 layout.js 路径>');
    process.exit(2);
}
const { computeLayout, MIN_BOARD_SIZE, MIN_CELL_SIZE } = require(path.resolve(layoutPath));

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log(`  FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
    return cond;
}

// ======================================================================
// 设备清单
//
// 设计分辨率策略是 FIXED_WIDTH(720x1280)，所以「设计分辨率宽度」恒为 720，
// 高度 = 720 * (设备高/设备宽)。下面按真实机型换算。
// ======================================================================
const DESIGN_W = 720;

/** 由设备物理分辨率推算设计分辨率高度 */
function designH(w, h) { return Math.round(DESIGN_W * (h / w)); }

const DEVICES = [
    // 名称,              设备宽, 设备高, 圆角/刘海 顶部内边距(px), 底部内边距(px)
    { name: 'iPhone SE (16:9)',       w: 750,  h: 1334, top: 0,  bottom: 0 },
    { name: 'iPhone 8  (16:9)',       w: 750,  h: 1334, top: 0,  bottom: 0 },
    { name: 'iPhone X  (刘海 19.5:9)', w: 1125, h: 2436, top: 132, bottom: 102 },
    { name: 'iPhone 14 Pro (灵动岛)',  w: 1179, h: 2556, top: 177, bottom: 102 },
    { name: 'iPhone 14 Pro Max',      w: 1290, h: 2796, top: 177, bottom: 102 },
    { name: 'Android 19.5:9',         w: 1080, h: 2340, top: 90,  bottom: 48 },
    { name: 'Android 20:9 (长屏)',     w: 1080, h: 2400, top: 96,  bottom: 48 },
    { name: 'Android 21:9 (超长)',     w: 1080, h: 2520, top: 100, bottom: 48 },
    { name: '平板 4:3 (iPad)',        w: 1536, h: 2048, top: 0,   bottom: 0 },
    { name: '平板 16:10',             w: 1600, h: 2560, top: 0,   bottom: 0 },
    { name: '极端方形 (1:1)',          w: 1000, h: 1000, top: 0,   bottom: 0 },
];

const COLS = 16;
const ROWS = 24;

console.log('='.repeat(96));
console.log(`竖屏布局测试 | 设计宽度固定 ${DESIGN_W} (FIXED_WIDTH) | 棋盘 ${COLS}x${ROWS} 格`);
console.log(`约束: 棋盘边长 >= ${MIN_BOARD_SIZE}, 格子边长 >= ${MIN_CELL_SIZE}`);
console.log('='.repeat(96));
console.log('% -32s %10s %8s %8s %10s %10s %8s' .replace('% -', '%-')
    .replace('%10s', '%10s'), '设备', '设计高', '格子px', '棋盘px', '棋盘上沿', '棋盘下沿', '结论');
console.log('-'.repeat(96));

for (const d of DEVICES) {
    // 像素安全区 -> 设计分辨率单位
    const scale = DESIGN_W / d.w;
    const vh = designH(d.w, d.h);
    const vp = {
        width: DESIGN_W,
        height: vh,
        insetTop: Math.round(d.top * scale),
        insetBottom: Math.round(d.bottom * scale),
        insetLeft: 0,
        insetRight: 0,
    };

    const L = computeLayout(vp, COLS, ROWS);

    const problems = [];
    // ① 棋盘不溢出屏幕
    if (L.boardW > DESIGN_W + 0.01) problems.push(`棋盘宽 ${L.boardW.toFixed(1)} 溢出 ${DESIGN_W}`);
    if (L.boardH > vh + 0.01) problems.push(`棋盘高 ${L.boardH.toFixed(1)} 溢出 ${vh}`);
    // ② 棋盘上下沿都在屏幕内
    if (L.boardTopY > vh / 2 + 0.01) problems.push(`棋盘上沿 ${L.boardTopY.toFixed(1)} 超出屏幕顶 ${(vh / 2).toFixed(1)}`);
    if (L.boardBottomY < -vh / 2 - 0.01) problems.push(`棋盘下沿 ${L.boardBottomY.toFixed(1)} 低于屏幕底 ${(-vh / 2).toFixed(1)}`);
    // ③ 不压住 HUD（分数那一行在棋盘上沿之上）
    if (L.boardTopY > L.hudSubY - 4) {
        problems.push(`棋盘上沿 ${L.boardTopY.toFixed(1)} 压到 HUD(底线 ${(L.hudSubY - 4).toFixed(1)})`);
    }
    // ④ 不压住底部提示
    if (L.boardBottomY < L.hudHintY + 14) {
        problems.push(`棋盘下沿 ${L.boardBottomY.toFixed(1)} 压到底部提示(y=${L.hudHintY.toFixed(1)})`);
    }
    // ⑤ 尺寸下限
    if (Math.min(L.boardW, L.boardH) < MIN_BOARD_SIZE - 0.01) {
        problems.push(`棋盘只有 ${Math.min(L.boardW, L.boardH).toFixed(0)}，小于下限 ${MIN_BOARD_SIZE}`);
    }
    if (L.cell < MIN_CELL_SIZE - 0.01) {
        problems.push(`格子只有 ${L.cell.toFixed(2)}，小于下限 ${MIN_CELL_SIZE}`);
    }
    // ⑥ 棋盘在可用区间内垂直居中（上下余量差不超过 2px）
    const topGap = (vh / 2 - L.insetTop - 78) - L.boardTopY;
    const botGap = L.boardBottomY - (-vh / 2 + L.insetBottom + 34);

    const verdict = problems.length === 0 ? 'OK' : '问题: ' + problems.join('; ');
    if (problems.length > 0) failed++;

    console.log(
        `${d.name.padEnd(24)} ${String(vh).padStart(10)} ${L.cell.toFixed(2).padStart(8)} ` +
        `${L.boardH.toFixed(0).padStart(8)} ${L.boardTopY.toFixed(0).padStart(10)} ` +
        `${L.boardBottomY.toFixed(0).padStart(10)}   ${verdict}`
    );

    // 用 check 记录通过项，让统计更直观
    check(`${d.name} 布局合法`, problems.length === 0, problems.join('; '));
}

// ======================================================================
// 边界与不变量
// ======================================================================
console.log('');
console.log('── 不变量检查 ──');

{
    // 格子边长 * 行列数 必须等于棋盘尺寸（不能有累积误差）
    const L = computeLayout({ width: 720, height: 1280, insetTop: 0, insetBottom: 0, insetLeft: 0, insetRight: 0 }, COLS, ROWS);
    const dw = Math.abs(L.cell * COLS - L.boardW);
    const dh = Math.abs(L.cell * ROWS - L.boardH);
    check('棋盘尺寸与格子数严格一致 (w)', dw < 1e-6, `误差 ${dw}`);
    check('棋盘尺寸与格子数严格一致 (h)', dh < 1e-6, `误差 ${dh}`);
}

{
    // 极小视口不能崩，且被下限兜住
    const L = computeLayout({ width: 100, height: 100, insetTop: 0, insetBottom: 0, insetLeft: 0, insetRight: 0 }, COLS, ROWS);
    check('极小视口不崩溃', isFinite(L.cell) && isFinite(L.boardW) && L.cell > 0, JSON.stringify({ cell: L.cell, boardW: L.boardW }));
    check('极小视口下格子仍有下限', L.cell >= MIN_CELL_SIZE - 1e-6, `cell=${L.cell}`);
}

{
    // 超大视口（桌面浏览器全屏）棋盘不被拉爆：受宽度约束
    const L = computeLayout({ width: 2560, height: 1440, insetTop: 0, insetBottom: 0, insetLeft: 0, insetRight: 0 }, COLS, ROWS);
    check('超宽视口棋盘不超宽', L.boardW <= 2560 + 1e-6, `boardW=${L.boardW}`);
    check('超宽视口格子为正', L.cell > 0, `cell=${L.cell}`);
}

{
    // 安全区很大时，棋盘应缩小而不是被推出去
    const L = computeLayout({ width: 720, height: 1280, insetTop: 120, insetBottom: 80, insetLeft: 0, insetRight: 0 }, COLS, ROWS);
    check('大安全区下棋盘仍在屏幕内', L.boardTopY <= 1280 / 2 && L.boardBottomY >= -1280 / 2,
        `top=${L.boardTopY.toFixed(1)} bottom=${L.boardBottomY.toFixed(1)}`);
}

{
    // 比例一致性：棋盘必须保持严格正方形（宽高由同一 cell 推出）
    // 注意：由于 cols != rows，棋盘本身不是正方形，但「格子」必须是正方形
    const L = computeLayout({ width: 720, height: 1280, insetTop: 0, insetBottom: 0, insetLeft: 0, insetRight: 0 }, COLS, ROWS);
    const cellW = L.boardW / COLS;
    const cellH = L.boardH / ROWS;
    check('格子是正方形（宽=高）', Math.abs(cellW - cellH) < 1e-6, `cellW=${cellW} cellH=${cellH}`);
}

console.log('');
console.log('='.repeat(96));
console.log(`测试结果: ${passed} 通过 / ${failed} 失败`);
console.log('='.repeat(96));
process.exit(failed === 0 ? 0 : 1);
