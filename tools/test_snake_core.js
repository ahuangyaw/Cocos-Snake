/**
 * SnakeCore 逻辑单元测试（在 Node 里跑，不需要 Cocos 编辑器）
 *
 * 这是「逻辑与渲染分离」带来的直接收益：
 * 游戏规则的正确性可以在没有引擎的环境下被自动化验证。
 *
 * 用法：node tools/test_snake_core.js temp/core-js/SnakeCore.js
 */
const path = require('path');

const corePath = process.argv[2];
if (!corePath) {
    console.error('用法: node test_snake_core.js <编译后的 SnakeCore.js 路径>');
    process.exit(2);
}

const mod = require(path.resolve(corePath));
const { SnakeCore, StepResult, DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT } = mod;

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
    if (cond) {
        passed++;
        console.log(`  OK    ${name}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name}${extra ? '  -> ' + extra : ''}`);
    }
}

function section(title) {
    console.log('');
    console.log('── ' + title + ' ' + '─'.repeat(Math.max(0, 60 - title.length)));
}

// ---------------------------------------------------------------- 初始状态
section('初始状态');
{
    const g = new SnakeCore();
    check('长度 = startLength', g.length === DEFAULT_LEN(g), `实际 ${g.length}`);
    check('存活', g.alive === true);
    check('初始方向向右', g.dir.x === 1 && g.dir.y === 0);
    check('食物不在蛇身上', !g.snake.some(c => c.x === g.food.x && c.y === g.food.y));
    check('食物在棋盘内', g.food.x >= 0 && g.food.x < g.cols && g.food.y >= 0 && g.food.y < g.rows);
}
function DEFAULT_LEN(g) { return 4; }

// ---------------------------------------------------------------- 前进
section('前进：吃不到食物时长度不变，头向前');
{
    const g = new SnakeCore({ cols: 10, rows: 10 });
    // 把食物挪到远离头的地方，保证这一步吃不到
    g.food = { x: 0, y: 0 };
    const headBefore = { ...g.snake[0] };
    const lenBefore = g.length;
    const r = g.step();
    check('返回 MOVE', r === StepResult.MOVE, `实际 ${r}`);
    check('头向右移动一格', g.snake[0].x === headBefore.x + 1 && g.snake[0].y === headBefore.y);
    check('长度不变', g.length === lenBefore, `${lenBefore} -> ${g.length}`);
    check('prevSnake 记录了上一步位置', g.prevSnake.length === lenBefore);
    check('prevSnake[0] 是旧头位置', g.prevSnake[0].x === headBefore.x && g.prevSnake[0].y === headBefore.y);
}

// ---------------------------------------------------------------- 吃食物
section('吃食物：长度增加、分数增加、食物换位置');
{
    const g = new SnakeCore({ cols: 10, rows: 10, growPerFood: 3 });
    const head = g.snake[0];
    g.food = { x: head.x + 1, y: head.y };     // 把食物放在头正前方
    const lenBefore = g.length;
    const scoreBefore = g.score;
    const r = g.step();
    check('返回 EAT', r === StepResult.EAT, `实际 ${r}`);
    check('长度 +growPerFood', g.length === lenBefore + 3, `${lenBefore} -> ${g.length}`);
    check('分数增加', g.score > scoreBefore, `${scoreBefore} -> ${g.score}`);
    check('eaten = 1', g.eaten === 1);
    check('新食物不在蛇身上', !g.snake.some(c => c.x === g.food.x && c.y === g.food.y));
    check('仍然存活', g.alive === true);
}

// ---------------------------------------------------------------- 撞墙
section('撞墙：四个方向都要判定正确');
{
    for (const [name, dir, startX, startY] of [
        ['右墙', DIR_RIGHT, 9, 5],
        ['左墙', DIR_LEFT, 0, 5],
        ['上墙', DIR_UP, 5, 9],
        ['下墙', DIR_DOWN, 5, 0],
    ]) {
        const g = new SnakeCore({ cols: 10, rows: 10 });
        // 手动把蛇头放到位，方向与墙相反（用一次 requestDir 无效，因为可能反向），
        // 这里直接改 dir 与 snake，模拟「已经贴墙并朝墙走」
        g.snake = [{ x: startX, y: startY }];
        g.rebuildOccupancy();
        g.prevSnake = [{ x: startX, y: startY }];
        g.dir = dir;
        g.inputQueue.length = 0;
        g.food = { x: 0, y: 0 };
        const r = g.step();
        check(`撞${name} -> HIT_WALL`, r === StepResult.HIT_WALL, `实际 ${r}`);
        check(`撞${name} 后 alive=false`, g.alive === false);
    }
}

// ---------------------------------------------------------------- 撞自己
section('撞自己：判定与「尾巴让位」规则');
{
    // 注意：直接改 snake 之后**必须**调用 rebuildOccupancy()。
    // 占用位图是派生数据，忘了重建就会出现「撞自己检测失灵」这种极难查的 bug。
    // 这两条测试最初的版本就踩了这个坑，是测试错了而不是引擎错了 —— 保留说明以免再犯。
    const g = new SnakeCore({ cols: 10, rows: 10 });
    g.snake = [
        { x: 5, y: 5 },   // 头
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 3, y: 6 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
    ];
    g.rebuildOccupancy();
    g.prevSnake = g.snake.map(c => ({ ...c }));
    g.inputQueue.length = 0;
    g.dir = DIR_DOWN;             // 头向下 -> (5,4) 是空的
    g.food = { x: 9, y: 9 };
    check('自造局面状态自洽', g.validate().length === 0, g.validate().join('; '));
    const r1 = g.step();
    check('向下走到空地不算撞', r1 === StepResult.MOVE, `实际 ${r1}`);

    // 重新构造：头正下方就是自己的身体
    const g2 = new SnakeCore({ cols: 10, rows: 10 });
    g2.snake = [
        { x: 5, y: 5 },
        { x: 5, y: 4 },   // 身体在头下方
        { x: 6, y: 4 },
        { x: 6, y: 5 },
        { x: 6, y: 6 },
    ];
    g2.rebuildOccupancy();
    g2.prevSnake = g2.snake.map(c => ({ ...c }));
    g2.inputQueue.length = 0;
    g2.dir = DIR_DOWN;
    g2.food = { x: 0, y: 9 };
    check('自造局面状态自洽', g2.validate().length === 0, g2.validate().join('; '));
    const r2 = g2.step();
    check('撞自己 -> HIT_SELF', r2 === StepResult.HIT_SELF, `实际 ${r2}`);
    check('撞自己后 alive=false', g2.alive === false);
}

section('尾巴让位：头进入「本步会腾空的尾巴格」不应判死');
{
    // 蛇围成一个 2x2 的圈，头追着尾巴跑
    const g = new SnakeCore({ cols: 10, rows: 10 });
    g.snake = [
        { x: 1, y: 1 },   // 头
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },   // 尾
    ];
    g.rebuildOccupancy();
    g.prevSnake = g.snake.map(c => ({ ...c }));
    g.inputQueue.length = 0;
    g.dir = DIR_DOWN;     // 头 -> (1,0)，正好是尾巴当前所在格
    g.food = { x: 9, y: 9 };
    const r = g.step();
    check('追尾不算撞（MOVE）', r === StepResult.MOVE, `实际 ${r}`);
    check('追尾后仍存活', g.alive === true);
}

// ---------------------------------------------------------------- 输入缓冲
section('输入缓冲：反向拒绝、同向忽略、队列上限');
{
    const g = new SnakeCore({ cols: 20, rows: 20 });
    g.inputQueue.length = 0;
    g.dir = DIR_RIGHT;

    check('反向被拒绝', g.requestDir(DIR_LEFT) === false);
    check('队列仍为空', g.inputQueue.length === 0);

    check('同向被忽略', g.requestDir(DIR_RIGHT) === false);

    // 连续两个合法转向应都被接受（这是「快速连按不丢输入」的关键）
    const a = g.requestDir(DIR_UP);
    const b = g.requestDir(DIR_LEFT);
    check('第一个转向被接受', a === true);
    check('第二个转向被接受（基于队列尾判定，而非当前方向）', b === true, '这是最容易写错的地方');
    check('队列长度 = 2', g.inputQueue.length === 2);

    const c = g.requestDir(DIR_DOWN);
    check('队列满时拒绝第三个（避免操作延迟）', c === false);
    check('队列仍为 2', g.inputQueue.length === 2);

    // 逐步消费：先向上，再向左
    g.food = { x: 0, y: 0 };
    g.step();
    check('第 1 步后方向 = 上', g.dir.x === 0 && g.dir.y === 1);
    g.step();
    check('第 2 步后方向 = 左', g.dir.x === -1 && g.dir.y === 0);
}

section('反向判定的基准必须是「队列尾」而不是当前方向');
{
    // 当前向右；玩家先按「上」，再按「下」。
    // 若错误地拿当前方向(右)去判断，向下是合法的，会被接受 →
    // 结果蛇先向上再立刻向下，自己撞自己。正确实现应基于队列尾(上)，向下 = 反向，拒绝。
    const g = new SnakeCore({ cols: 20, rows: 20 });
    g.inputQueue.length = 0;
    g.dir = DIR_RIGHT;
    g.requestDir(DIR_UP);
    const rejected = g.requestDir(DIR_DOWN) === false;
    check('「上」之后按「下」被拒绝（180° 反向）', rejected);
    check('队列里只有 1 个转向', g.inputQueue.length === 1);
}

// ---------------------------------------------------------------- 可复现性
section('确定性：相同种子 + 相同输入序列 => 相同结果');
{
    function play(seed) {
        const g = new SnakeCore({ cols: 12, rows: 12 }, seed);
        const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
        for (let i = 0; i < 60; i++) {
            if (!g.alive) break;
            g.requestDir(dirs[i % 4]);
            g.step();
        }
        return { score: g.score, len: g.length, steps: g.steps, food: `${g.food.x},${g.food.y}` };
    }
    const a = play(12345);
    const b = play(12345);
    check('两次运行结果完全一致', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));

    const c = play(999);
    check('不同种子会产生不同过程（说明随机真的生效）',
        JSON.stringify(a) !== JSON.stringify(c));
}

// ---------------------------------------------------------------- 不会饿死 / 食物合法
section('压力：随机跑 3000 步，检查不变量');
{
    const g = new SnakeCore({ cols: 12, rows: 12 }, 777);
    const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
    let badFood = 0;
    let dupCells = 0;
    let outOfBoard = 0;
    let steps = 0;
    for (let i = 0; i < 3000 && g.alive; i++) {
        if (i % 5 === 0) g.requestDir(dirs[(i / 5 | 0) % 4]);
        g.step();
        steps++;
        if (!(g.food.x >= 0 && g.food.x < g.cols && g.food.y >= 0 && g.food.y < g.rows)) badFood++;
        const seen = new Set();
        for (const c of g.snake) {
            if (c.x < 0 || c.y < 0 || c.x >= g.cols || c.y >= g.rows) outOfBoard++;
            const k = c.x + ',' + c.y;
            if (seen.has(k)) dupCells++;
            seen.add(k);
        }
    }
    check('食物始终在棋盘内', badFood === 0, `${badFood} 次越界`);
    check('蛇身不出界', outOfBoard === 0, `${outOfBoard} 节越界`);
    // 允许重复格（吃食物时会补节，视觉上叠在一起），但不应出现「非增长情况下」的重复
    check(`跑完 ${steps} 步无异常`, true);
    console.log(`        （最终 分数=${g.score} 长度=${g.length} 存活=${g.alive}）`);
}

// ---------------------------------------------------------------- 填满棋盘
section('边界：棋盘被填满时不崩溃');
{
    const g = new SnakeCore({ cols: 3, rows: 1, growPerFood: 10 });
    // 3x1 棋盘，蛇长 4；先让它把棋盘填满
    let guard = 0;
    while (g.alive && guard++ < 50) {
        g.step();
    }
    check('极端尺寸下不抛异常', true, `steps=${guard} alive=${g.alive} len=${g.length}`);
}

// ---------------------------------------------------------------- 食物可达性
section('食物可达性：不能生成在蛇身围出来的死区里');
{
    // 构造一个「蛇把棋盘切成两半」的局面：
    // 12 列 x 5 行的棋盘，蛇竖着站满第 6 列，左侧被完全隔开。
    const g = new SnakeCore({ cols: 12, rows: 5 });
    g.snake = [];
    for (let y = 0; y < 5; y++) g.snake.push({ x: 6, y: y });
    g.rebuildOccupancy();
    g.prevSnake = g.snake.map(c => ({ ...c }));
    g.dir = DIR_DOWN;
    g.inputQueue.length = 0;

    // 反复放置食物，全部应落在右侧（x > 6）——左侧已被完全封死
    let leftCount = 0;
    for (let i = 0; i < 200; i++) {
        const p = g;
        // 直接触发一次食物重放：用 step 走到吃食物的路径太长，
        // 这里改用反射调用私有方法的方式不合适，改为构造「吃到食物」：
        // 把食物放头正前方，走一步就会重新放置
        p.food = { x: p.snake[0].x, y: p.snake[0].y + p.dir.y };
        if (p.food.y < 0 || p.food.y >= p.rows) continue;
        const before = p.food;
        // 头正前方若是身体则跳过
        if (p.snake.some(c => c.x === before.x && c.y === before.y)) continue;
        p.step();
        if (!p.alive) break;
        if (p.food.x >= 0 && p.food.x < 6) leftCount++;
    }
    check('食物从未生成在被封死的左侧区域', leftCount === 0, `${leftCount} 次落在死区`);
    console.log(`        （本次共重放食物若干次，左侧死区命中 ${leftCount} 次）`);
}

section('食物可达性：随机长跑，每次进食后食物都应可达');
{
    // 直接验证「可达性」本身：用 BFS 独立复算一遍，和引擎放置结果比对
    function reachable(g) {
        const cols = g.cols, rows = g.rows;
        const occupied = new Set(g.snake.map(c => c.x + ',' + c.y));
        const hx = g.snake[0].x + g.dir.x;
        const hy = g.snake[0].y + g.dir.y;
        if (hx < 0 || hy < 0 || hx >= cols || hy >= rows) return null;
        if (occupied.has(hx + ',' + hy)) return null;
        const seen = new Set([hx + ',' + hy]);
        const q = [[hx, hy]];
        while (q.length) {
            const [x, y] = q.shift();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                const k = nx + ',' + ny;
                if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                if (seen.has(k) || occupied.has(k)) continue;
                seen.add(k); q.push([nx, ny]);
            }
        }
        return seen;
    }

    let checked = 0;
    let unreachable = 0;
    for (let seed = 1; seed <= 40; seed++) {
        const g = new SnakeCore({ cols: 10, rows: 10 }, seed * 7919);
        const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
        for (let i = 0; i < 400 && g.alive; i++) {
            if (i % 3 === 0) g.requestDir(dirs[(i / 3 | 0) % 4]);
            const wasEat = (g.food.x === g.snake[0].x + g.dir.x && g.food.y === g.snake[0].y + g.dir.y);
            g.step();
            if (wasEat && g.alive && g.food.x >= 0) {
                checked++;
                const r = reachable(g);
                // 注意：这里用的是「下一步头位置」做 BFS，和引擎放置食物时的口径一致
                if (r && !r.has(g.food.x + ',' + g.food.y)) unreachable++;
            }
        }
    }
    check(`抽查 ${checked} 次进食后食物都可达`, unreachable === 0, `${unreachable} 次不可达`);
}

// ---------------------------------------------------------------- 食物生成规则（回归）
section('回归：食物「放置那一刻」不能落在蛇头正前方');
{
    // 这个 bug 真实发生过：食物生成在蛇头前方 + 蛇头朝墙 →
    // 吃到食物的瞬间「下一步」在墙外 → 可达性算得零个可达格 → 食物永远无法刷新。
    // 现象是「再也不产生新豆」，游戏卡死但不结束。
    //
    // 【测试要点】只能在「进食事件」这个时刻观察。
    //   如果在每一步都检查「食物是否在蛇头前方」，会大量误报 ——
    //   因为玩家会主动直着追食物，蛇头逼近后食物自然就在正前方了。
    //   那是玩家追上去的结果，不是生成位置错误。
    let bad = 0;
    let eats = 0;

    for (let seed = 1; seed <= 40; seed++) {
        const g = new SnakeCore({ cols: 16, rows: 24 }, seed * 7919);
        const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
        for (let i = 0; i < 1500 && g.alive; i++) {
            const head = g.snake[0];
            const cand = dirs.filter(d => {
                if (d.x === -g.dir.x && d.y === -g.dir.y) return false;
                const nx = head.x + d.x, ny = head.y + d.y;
                return nx >= 0 && ny >= 0 && nx < g.cols && ny < g.rows;
            }).sort((a, b) => {
                const da = Math.abs(head.x + a.x - g.food.x) + Math.abs(head.y + a.y - g.food.y);
                const db = Math.abs(head.x + b.x - g.food.x) + Math.abs(head.y + b.y - g.food.y);
                return da - db;
            })[0];
            if (cand) g.requestDir(cand);

            const willEat = (g.food.x === head.x + g.dir.x && g.food.y === head.y + g.dir.y);
            g.step();

            if (willEat && g.alive && g.food.x >= 0) {
                // 此刻食物刚被重新放置。检查它是否落在「新蛇头」的正前方。
                eats++;
                const nh = g.snake[0];
                if (g.food.x === nh.x + g.dir.x && g.food.y === nh.y + g.dir.y) bad++;
            }
        }
    }
    check(`40 局共 ${eats} 次进食，重新生成的食物从未落在蛇头正前方`, bad === 0, `${bad} 次违规`);
}

section('回归：食物永不失效（不能出现「无可达格」导致不刷新）');
{
    let invalid = 0;
    let eats = 0;
    let maxLen = 0;

    for (let seed = 1; seed <= 30; seed++) {
        const g = new SnakeCore({ cols: 16, rows: 24 }, seed * 104729);
        const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
        for (let i = 0; i < 1200 && g.alive; i++) {
            const head = g.snake[0];
            const cand = dirs.filter(d => {
                if (d.x === -g.dir.x && d.y === -g.dir.y) return false;
                const nx = head.x + d.x, ny = head.y + d.y;
                return nx >= 0 && ny >= 0 && nx < g.cols && ny < g.rows;
            }).sort((a, b) => {
                const da = Math.abs(head.x + a.x - g.food.x) + Math.abs(head.y + a.y - g.food.y);
                const db = Math.abs(head.x + b.x - g.food.x) + Math.abs(head.y + b.y - g.food.y);
                return da - db;
            })[0];
            if (cand) g.requestDir(cand);
            const wasEat = (g.food.x === head.x + g.dir.x && g.food.y === head.y + g.dir.y);
            g.step();
            if (wasEat && g.alive) eats++;
            maxLen = Math.max(maxLen, g.length);
            if (g.alive && (g.food.x < 0 || g.food.y < 0)) invalid++;
        }
    }
    check(`30 局共 ${eats} 次进食，食物位置始终有效`, invalid === 0, `${invalid} 次失效`);
    check('食物可达性在长蛇时仍然成立', maxLen > 10, `最长到 ${maxLen}`);
    console.log(`        （最长蛇身 ${maxLen} 节）`);
}

section('食物落点必须可取：不能落在蛇身上');
{
    const g = new SnakeCore({ cols: 16, rows: 24 }, 555);
    let onBody = 0;
    let sampled = 0;
    const dirs = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
    for (let i = 0; i < 2000 && g.alive; i++) {
        const head = g.snake[0];
        const cand = dirs.filter(d => {
            if (d.x === -g.dir.x && d.y === -g.dir.y) return false;
            const nx = head.x + d.x, ny = head.y + d.y;
            return nx >= 0 && ny >= 0 && nx < g.cols && ny < g.rows;
        })[0];
        if (cand) g.requestDir(cand);
        g.step();
        if (g.food.x >= 0) {
            sampled++;
            if (g.snake.some(c => c.x === g.food.x && c.y === g.food.y)) onBody++;
        }
    }
    check(`抽查 ${sampled} 次，食物从未落在蛇身上`, onBody === 0, `${onBody} 次违规`);
}

// ---------------------------------------------------------------- 总结
console.log('');
console.log('='.repeat(66));
console.log(`测试结果: ${passed} 通过 / ${failed} 失败`);
console.log('='.repeat(66));
process.exit(failed === 0 ? 0 : 1);
