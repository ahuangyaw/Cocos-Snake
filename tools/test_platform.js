/**
 * 平台探测与存储降级测试 —— 在 Node 里跑，不需要 Cocos 编辑器
 *
 * 为什么这层值得重点测：
 *   平台适配是"上线后才发现问题"的重灾区 —— 抖音上能跑、微信上崩、
 *   Web 预览正常、真机存储写入被拒。这些都不是视觉问题，靠眼睛看不出来，
 *   只能靠断言覆盖各种平台组合与失败路径。
 *
 * 用法：
 *   tsc assets/scripts/snake/PlatformCore.ts --outDir temp/core-js --module commonjs --target ES2017
 *   node tools/test_platform.js temp/core-js/PlatformCore.js
 */
const path = require('path');

const p = process.argv[2];
if (!p) { console.error('用法: node test_platform.js <编译后的 PlatformCore.js 路径>'); process.exit(2); }
const {
    GamePlatform, detectPlatform, ResilientStore, MemoryStore, parseNonNegativeInt,
} = require(path.resolve(p));

let passed = 0, failed = 0;
function check(name, cond, extra) {
    if (cond) passed++;
    else { failed++; console.log(`  FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
}
function section(t) {
    console.log('');
    console.log('── ' + t + ' ' + '─'.repeat(Math.max(0, 56 - t.length)));
}

const G = GamePlatform;

// 模拟一个可用的抖音 API
function fakeTt(overrides) {
    return Object.assign({
        getSystemInfoSync: () => ({ platform: 'ios', system: 'iOS 17', windowWidth: 390, windowHeight: 844, pixelRatio: 3 }),
        getStorageSync: (k) => (k === 'k' ? 'v' : ''),
        setStorageSync: () => { },
        removeStorageSync: () => { },
    }, overrides || {});
}
function fakeWx(overrides) {
    return Object.assign({
        getSystemInfoSync: () => ({ platform: 'devtools' }),
        getStorageSync: () => '',
        setStorageSync: () => { },
    }, overrides || {});
}

// ======================================================================
section('平台探测：引擎枚举优先');
{
    const r = detectPlatform({
        sysPlatform: 'BYTEDANCE_MINI_GAME',
        platformEnum: { BYTEDANCE_MINI_GAME: 'BYTEDANCE_MINI_GAME' },
        globals: { tt: fakeTt() },
    });
    check('识别为抖音', r.kind === G.BYTEDANCE, r.kind);
    check('全局对象名为 tt', r.apiName === 'tt', r.apiName);
    check('拿到了 API 对象', !!r.api);
    check('reason 记录了依据', r.reason.indexOf('sys.platform') >= 0, r.reason);

    const w = detectPlatform({
        sysPlatform: 'WECHAT_GAME',
        platformEnum: { WECHAT_GAME: 'WECHAT_GAME' },
        globals: { wx: fakeWx() },
    });
    check('识别为微信', w.kind === G.WECHAT, w.kind);
    check('微信全局对象为 wx', w.apiName === 'wx', w.apiName);
}

section('平台探测：引擎没识别时靠全局对象嗅探');
{
    // 抖音开发者工具里跑 Web 版调试的典型情况：sys.platform 是浏览器，但 tt 存在
    const r = detectPlatform({
        sysPlatform: 'DESKTOP_BROWSER',
        isBrowser: true,
        globals: { tt: fakeTt() },
    });
    check('浏览器环境但存在 tt -> 仍识别为抖音', r.kind === G.BYTEDANCE, r.kind);
    check('reason 写明是嗅探', r.reason.indexOf('嗅探') >= 0, r.reason);
}

section('平台探测：嗅探优先级 order = tt > wx > my > qg > hbs');
{
    // 同时存在多个全局对象时，必须按固定顺序取第一个可用的
    const r = detectPlatform({ globals: { tt: fakeTt(), wx: fakeWx() } });
    check('tt 优先于 wx', r.kind === G.BYTEDANCE, r.kind);

    const r2 = detectPlatform({ globals: { wx: fakeWx() } });
    check('只有 wx 时识别为微信', r2.kind === G.WECHAT, r2.kind);
}

section('平台探测：形状不对的全局对象不应被误认');
{
    // 真实踩坑点：某些网站会定义同名全局变量（例如 window.wx 被别的库占用）
    const r = detectPlatform({
        isBrowser: true,
        globals: { tt: { foo: 1 }, wx: 'not-an-object', my: null },
    });
    check('形状不对的 tt/wx 不误认（判为 WEB）', r.kind === G.WEB, r.kind);
}

section('平台探测：原生与未知');
{
    const n = detectPlatform({ isNative: true, globals: {} });
    check('isNative -> NATIVE', n.kind === G.NATIVE, n.kind);
    const u = detectPlatform({ globals: {} });
    check('什么都没有 -> UNKNOWN', u.kind === G.UNKNOWN, u.kind);
}

// ======================================================================
section('存储降级：底层失败时不得抛异常');
{
    const boom = {
        get() { throw new Error('read denied'); },
        set() { throw new Error('write denied'); },
        remove() { throw new Error('remove denied'); },
    };
    const s = new ResilientStore(boom);

    let threw = false;
    try {
        s.set('a', '1');
        s.get('a');
        s.remove('a');
    } catch (e) { threw = true; }
    check('底层全部抛异常时不向外抛', !threw);
}

section('存储降级：写入失败后读到的仍是本次写入的值（内存兜底）');
{
    const denyWrite = {
        get() { return null; },
        set() { throw new Error('quota exceeded'); },
        remove() { },
    };
    const s = new ResilientStore(denyWrite);
    const ok = s.set('score', '42');
    check('set 返回 false 表示未持久化', ok === false, String(ok));
    check('但内存里保留了值（本次运行内一致）', s.get('score') === '42', String(s.get('score')));
}

section('存储降级：底层读取失败时回落到内存');
{
    let mem = null;
    const flaky = {
        get() { if (mem === null) throw new Error('read fail'); return mem; },
        set(k, v) { mem = v; return true; },
        remove() { mem = null; },
    };
    const s = new ResilientStore(flaky);
    s.set('x', 'hello');           // 写入成功
    check('正常读写', s.get('x') === 'hello', String(s.get('x')));

    mem = null;                     // 模拟底层数据丢失
    check('底层丢失后内存兜底', s.get('x') === 'hello', String(s.get('x')));
}

section('存储降级：没有底层存储（纯 Node）时也能工作');
{
    const s = new ResilientStore(null);
    check('写入返回 false（无持久化）', s.set('k', 'v') === false);
    check('读取仍能拿到内存值', s.get('k') === 'v', String(s.get('k')));
}

section('存储降级：底层成功时 set 返回 true');
{
    const m = new MemoryStore();
    const s = new ResilientStore(m);
    check('set 返回 true', s.set('k', 'v') === true);
    check('读回一致', s.get('k') === 'v');
    s.remove('k');
    check('删除后读到 null', s.get('k') === null, String(s.get('k')));
}

section('存储降级：空字符串与 null 的语义');
{
    const m = new MemoryStore();
    const s = new ResilientStore(m);
    // 空字符串应当视为"没有值"，回落到 fallback —— 这是存档解析的常见坑
    s.set('e', '');
    s.set('n', 'null');
    check('空字符串会被当作无值', s.get('e') === null || s.get('e') === '', String(s.get('e')));
    check('字符串 "null" 正常保存', s.get('n') === 'null', String(s.get('n')));
}

// ======================================================================
section('存档解析：非法值一律回落到默认值');
{
    check('null -> 默认', parseNonNegativeInt(null, 7) === 7);
    check('空串 -> 默认', parseNonNegativeInt('', 7) === 7);
    check('非数字 -> 默认', parseNonNegativeInt('abc', 7) === 7);
    check('负数 -> 默认', parseNonNegativeInt('-5', 7) === 7);
    check('正常数字', parseNonNegativeInt('123', 0) === 123);
    check('带空格', parseNonNegativeInt('  42 ', 0) === 42);
    check('小数被截断', parseNonNegativeInt('42.9', 0) === 42);
    check('0 是合法值', parseNonNegativeInt('0', 99) === 0, String(parseNonNegativeInt('0', 99)));
}

// ======================================================================
section('端到端：模拟一局游戏的存档流程（抖音 -> 真机存储失败 -> Web）');
{
    // 场景 1：抖音，存储正常
    let disk = {};
    const tt = fakeTt({
        getStorageSync: (k) => (disk[k] !== undefined ? disk[k] : ''),
        setStorageSync: (k, v) => { disk[k] = v; },
    });
    const r1 = detectPlatform({
        sysPlatform: 'BYTEDANCE_MINI_GAME',
        platformEnum: { BYTEDANCE_MINI_GAME: 'BYTEDANCE_MINI_GAME' },
        globals: { tt },
    });
    const store1 = new ResilientStore({
        get: (k) => tt.getStorageSync(k) || null,
        set: (k, v) => { tt.setStorageSync(k, v); return true; },
        remove: (k) => { delete disk[k]; },
    });
    store1.set('snake.best.v1', '150');
    check('抖音：写入成功并落盘', disk['snake.best.v1'] === '150', JSON.stringify(disk));
    check('抖音：读回一致', store1.get('snake.best.v1') === '150');

    // 场景 2：同样的存档键，在新的一局里读出来
    const store2 = new ResilientStore({
        get: (k) => tt.getStorageSync(k) || null,
        set: (k, v) => { tt.setStorageSync(k, v); return true; },
        remove: () => { },
    });
    check('重启后仍能读到最高分', parseNonNegativeInt(store2.get('snake.best.v1'), 0) === 150);

    // 场景 3：真机存储被系统拒绝（隐私模式）
    const store3 = new ResilientStore({
        get: () => { throw new Error('privacy mode'); },
        set: () => { throw new Error('privacy mode'); },
        remove: () => { },
    });
    const okWrite = store3.set('snake.best.v1', '200');
    check('隐私模式：不抛异常', true);
    check('隐私模式：告知未持久化', okWrite === false);
    check('隐私模式：本次运行内仍可读', store3.get('snake.best.v1') === '200');
    check('隐私模式：解析结果正确', parseNonNegativeInt(store3.get('snake.best.v1'), 0) === 200);
}

console.log('');
console.log('='.repeat(66));
console.log(`测试结果: ${passed} 通过 / ${failed} 失败`);
console.log('='.repeat(66));
process.exit(failed === 0 ? 0 : 1);
