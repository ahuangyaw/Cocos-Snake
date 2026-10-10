/**
 * 状态机单元测试 —— 在 Node 里跑，不需要 Cocos 编辑器
 *
 * 为什么状态机值得单独测：
 *   流程 bug（结束后还能暂停、菜单里蛇在动、暂停后无法恢复）
 *   是玩家最容易遇到、开发者最难复现的一类问题。
 *   状态机是纯逻辑，把它测干净，这类 bug 就基本绝迹了。
 *
 * 用法：
 *   tsc assets/scripts/snake/StateMachine.ts --outDir temp/core-js --module commonjs --target ES2017
 *   node tools/test_state_machine.js temp/core-js/StateMachine.js
 */
const path = require('path');

const p = process.argv[2];
if (!p) {
    console.error('用法: node test_state_machine.js <编译后的 StateMachine.js 路径>');
    process.exit(2);
}
const { StateMachine, GameState } = require(path.resolve(p));

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
    if (cond) passed++;
    else { failed++; console.log(`  FAIL  ${name}${extra ? '  -> ' + extra : ''}`); }
}
function section(t) {
    console.log('');
    console.log('── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length)));
}

const S = GameState;

// ---------------------------------------------------------------- 初始
section('初始状态');
{
    const m = new StateMachine();
    check('默认是 BOOT', m.state === S.BOOT, m.state);
    check('previous 为 null', m.previous === null);
    check('isFresh 为 true', m.isFresh === true);
    check('elapsed 为 0', m.elapsed === 0);
}

// ---------------------------------------------------------------- 合法路径
section('合法路径：BOOT -> MENU -> PLAYING -> PAUSED -> PLAYING');
{
    const m = new StateMachine(S.BOOT);
    const log = [];
    m.onChange = (n, pv) => log.push(`${pv}->${n}`);

    check('BOOT -> MENU', m.go(S.MENU) === true);
    check('当前 MENU', m.is(S.MENU));
    check('MENU -> PLAYING', m.go(S.PLAYING) === true);
    check('PLAYING -> PAUSED', m.go(S.PAUSED) === true);
    check('PAUSED -> PLAYING（恢复）', m.go(S.PLAYING) === true);
    check('回调按顺序触发', log.join('|') === 'BOOT->MENU|MENU->PLAYING|PLAYING->PAUSED|PAUSED->PLAYING',
        log.join('|'));
}

// ---------------------------------------------------------------- 游戏结束两条出口
section('GAME_OVER 的两条出口：重开 / 回菜单');
{
    const m = new StateMachine(S.PLAYING);
    check('PLAYING -> GAME_OVER', m.go(S.GAME_OVER) === true);
    check('GAME_OVER -> PLAYING（再来一局）', m.go(S.PLAYING) === true);

    const m2 = new StateMachine(S.PLAYING);
    m2.go(S.GAME_OVER);
    check('GAME_OVER -> MENU（返回主菜单）', m2.go(S.MENU) === true);
}

// ---------------------------------------------------------------- 非法切换
section('非法切换必须被拒绝');
{
    const m = new StateMachine(S.MENU);
    let illegal = null;
    m.onIllegal = (from, to) => { illegal = `${from}->${to}`; };

    check('MENU -> GAME_OVER 被拒绝（不能跳过游戏直接结束）', m.go(S.GAME_OVER) === false);
    check('状态未被改变', m.is(S.MENU), m.state);
    check('onIllegal 被调用', illegal === 'MENU->GAME_OVER', String(illegal));

    check('MENU -> PAUSED 被拒绝（没在玩怎么暂停）', m.go(S.PAUSED) === false);
    check('状态仍为 MENU', m.is(S.MENU), m.state);

    check('MENU -> MENU 也返回 false（同状态不算切换）', m.go(S.MENU) === false);
}

section('GAME_OVER 不能再被暂停（这是最典型的流程 bug）');
{
    const m = new StateMachine(S.PLAYING);
    m.go(S.GAME_OVER);
    const ok = m.go(S.PAUSED) === false;
    check('GAME_OVER -> PAUSED 被拒绝', ok);
    check('状态仍是 GAME_OVER', m.is(S.GAME_OVER), m.state);
}

section('BOOT 可以直达 PLAYING（skipMenu 调试开关）');
{
    const m = new StateMachine(S.BOOT);
    check('BOOT -> PLAYING', m.go(S.PLAYING) === true);
}

// ---------------------------------------------------------------- elapsed / isFresh
section('elapsed 与 isFresh');
{
    const m = new StateMachine(S.MENU);
    m.go(S.PLAYING);
    check('刚切换后 isFresh = true', m.isFresh === true);
    check('刚切换后 elapsed = 0', m.elapsed === 0);

    m.update(0.5);
    check('update 累积 elapsed', Math.abs(m.elapsed - 0.5) < 1e-9, String(m.elapsed));
    check('累积后 isFresh = false', m.isFresh === false);

    m.update(0.25);
    check('多次 update 累加', Math.abs(m.elapsed - 0.75) < 1e-9, String(m.elapsed));

    m.go(S.PAUSED);
    check('切换后 elapsed 归零', m.elapsed === 0, String(m.elapsed));
    check('切换后 isFresh 恢复 true', m.isFresh === true);
}

// ---------------------------------------------------------------- previous
section('previous 追踪');
{
    const m = new StateMachine(S.MENU);
    m.go(S.PLAYING);
    check('previous = MENU', m.previous === S.MENU, String(m.previous));
    m.go(S.PAUSED);
    check('previous = PLAYING', m.previous === S.PLAYING, String(m.previous));
    // 被拒绝的切换不应污染 previous
    m.go(S.BOOT);
    check('非法切换后 previous 不变', m.previous === S.PLAYING, String(m.previous));
}

// ---------------------------------------------------------------- 全路径穷举
section('穷举：从每个状态出发，只有表中允许的目标能成功');
{
    const ALL = [S.BOOT, S.MENU, S.PLAYING, S.PAUSED, S.GAME_OVER];
    // 期望的合法表（与 StateMachine.ts 中的 TRANSITIONS 对应）
    const EXPECT = {
        [S.BOOT]: [S.MENU, S.PLAYING],
        [S.MENU]: [S.PLAYING],
        [S.PLAYING]: [S.PAUSED, S.GAME_OVER, S.MENU],
        [S.PAUSED]: [S.PLAYING, S.MENU, S.GAME_OVER],
        [S.GAME_OVER]: [S.PLAYING, S.MENU],
    };

    let mismatches = [];
    for (const from of ALL) {
        for (const to of ALL) {
            if (from === to) continue;
            const m = new StateMachine(from);
            const got = m.go(to);
            const want = EXPECT[from].indexOf(to) >= 0;
            if (got !== want) {
                mismatches.push(`${from}->${to} 期望 ${want} 实际 ${got}`);
            }
        }
    }
    check(`穷举 ${ALL.length * (ALL.length - 1)} 组切换全部符合预期`, mismatches.length === 0,
        mismatches.join('; '));
}

// ---------------------------------------------------------------- 无回调时不崩
section('健壮性：未注册回调时不崩');
{
    const m = new StateMachine(S.MENU);
    let ok = true;
    try {
        m.go(S.PLAYING);        // 没有 onChange
        m.go(S.GAME_OVER);
        m.go(S.BOOT);           // 非法切换，且没有 onIllegal
    } catch (e) {
        ok = false;
    }
    check('无回调时切换不抛异常', ok);
    check('非法切换仍被拒绝', m.is(S.GAME_OVER), m.state);
}

console.log('');
console.log('='.repeat(66));
console.log(`测试结果: ${passed} 通过 / ${failed} 失败`);
console.log('='.repeat(66));
process.exit(failed === 0 ? 0 : 1);
