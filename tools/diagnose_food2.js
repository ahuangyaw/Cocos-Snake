/**
 * 追踪第二次进食前后的每一步，找出「头在第0列却朝左」这个矛盾状态怎么来的。
 *
 * 用法：node tools/diagnose_food2.js temp/core-js/SnakeCore.js
 */
const path = require('path');
const p = process.argv[2];
const mod = require(path.resolve(p));
const { SnakeCore, StepResult, DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT } = mod;

const DIRS = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];
const NAME = (d) => d.x === 0 && d.y === 1 ? 'UP' : d.x === 0 && d.y === -1 ? 'DOWN'
    : d.x === -1 && d.y === 0 ? 'LEFT' : d.x === 1 && d.y === 0 ? 'RIGHT' : '?';

function chooseDir(g) {
    const head = g.snake[0];
    const fx = g.food.x, fy = g.food.y;
    const cands = DIRS.filter(d => {
        if (d.x === -g.dir.x && d.y === -g.dir.y) return false;
        const nx = head.x + d.x, ny = head.y + d.y;
        return nx >= 0 && ny >= 0 && nx < g.cols && ny < g.rows;
    }).sort((a, b) => {
        const da = Math.abs(head.x + a.x - fx) + Math.abs(head.y + a.y - fy);
        const db = Math.abs(head.x + b.x - fx) + Math.abs(head.y + b.y - fy);
        return da - db;
    });
    for (const d of cands) {
        const nx = head.x + d.x, ny = head.y + d.y;
        const tail = g.snake[g.snake.length - 1];
        const isTail = (nx === tail.x && ny === tail.y);
        const bodyHit = g.snake.some(c => c.x === nx && c.y === ny);
        if (bodyHit && !isTail) continue;
        return d;
    }
    return cands.length ? cands[0] : null;
}

const g = new SnakeCore({ cols: 16, rows: 24 });

for (let step = 1; step <= 32; step++) {
    if (!g.alive) { console.log(`步${step}: 已死`); break; }

    const headBefore = { x: g.snake[0].x, y: g.snake[0].y };
    const dirBefore = { x: g.dir.x, y: g.dir.y };
    const foodBefore = { x: g.food.x, y: g.food.y };
    const want = chooseDir(g);
    const accepted = want ? g.requestDir(want) : false;
    const qLen = g.inputQueue.length;

    const r = g.step();

    const headAfter = { x: g.snake[0].x, y: g.snake[0].y };
    const dirAfter = { x: g.dir.x, y: g.dir.y };

    // 只打印第二次进食附近的步骤，避免刷屏
    if (step >= 22) {
        const tag = r === StepResult.EAT ? ' ★EAT' : (r !== StepResult.MOVE ? ' ✖' + r : '');
        console.log(
            `步${String(step).padStart(3)}: 头(${headBefore.x},${headBefore.y}) dir=${NAME(dirBefore)}` +
            ` | 想走 ${want ? NAME(want) : 'none'} 接受=${accepted} 队列=${qLen}` +
            ` | -> 头(${headAfter.x},${headAfter.y}) dir=${NAME(dirAfter)}` +
            ` 食物(${foodBefore.x},${foodBefore.y})->(${g.food.x},${g.food.y}) 长${g.length}${tag}`
        );
    }

    if (g.food.x < 0) {
        console.log('');
        console.log('❌ 食物在此刻失效');
        console.log(`   蛇头 (${headAfter.x},${headAfter.y})  方向 ${NAME(dirAfter)}`);
        console.log(`   下一步将到 (${headAfter.x + dirAfter.x},${headAfter.y + dirAfter.y})`);
        console.log(`   棋盘范围 x:0..${g.cols - 1}  y:0..${g.rows - 1}`);
        console.log(`   蛇头所在格是否越界: ${headAfter.x < 0 || headAfter.y < 0 || headAfter.x >= g.cols || headAfter.y >= g.rows}`);
        break;
    }
}
