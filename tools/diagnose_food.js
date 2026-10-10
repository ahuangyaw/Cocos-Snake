/**
 * 诊断：食物为什么会停止刷新
 *
 * 用手写贪心机器人把游戏一直玩下去，在「进食」时刻检查食物是否有效。
 * 一旦出现 food = (-1,-1)（无效位置），立刻打印当时的完整局面，
 * 这样就能确定是「棋盘真的满了」「可达性判定出错」还是别的。
 *
 * 用法：node tools/diagnose_food.js temp/core-js/SnakeCore.js
 */
const path = require('path');

const p = process.argv[2];
if (!p) { console.error('用法: node diagnose_food.js <SnakeCore.js 路径>'); process.exit(2); }
const { SnakeCore, StepResult, DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT } = require(path.resolve(p));

const DIRS = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];

/** 简易贪心：优先朝食物方向走，避开立刻会撞的位置 */
function chooseDir(g) {
    const head = g.snake[0];
    const fx = g.food.x, fy = g.food.y;

    // 按「离食物的距离」排序候选方向
    const cands = DIRS.filter(d => {
        if (d.x === -g.dir.x && d.y === -g.dir.y) return false;   // 不能反向
        const nx = head.x + d.x, ny = head.y + d.y;
        return nx >= 0 && ny >= 0 && nx < g.cols && ny < g.rows;
    }).sort((a, b) => {
        const da = Math.abs(head.x + a.x - fx) + Math.abs(head.y + a.y - fy);
        const db = Math.abs(head.x + b.x - fx) + Math.abs(head.y + b.y - fy);
        return da - db;
    });

    for (const d of cands) {
        const nx = head.x + d.x, ny = head.y + d.y;
        // 避开蛇身（尾巴会让位，所以尾巴格允许）
        const tail = g.snake[g.snake.length - 1];
        const isTail = (nx === tail.x && ny === tail.y);
        const bodyHit = g.snake.some(c => c.x === nx && c.y === ny);
        if (bodyHit && !isTail) continue;
        return d;
    }
    return cands.length ? cands[0] : null;
}

/** 独立复算可达格数（不依赖 SnakeCore 的私有实现） */
function reachableCount(g) {
    const cols = g.cols, rows = g.rows;
    const occ = new Set(g.snake.map(c => c.x + ',' + c.y));
    const hx = g.snake[0].x + g.dir.x;
    const hy = g.snake[0].y + g.dir.y;
    if (hx < 0 || hy < 0 || hx >= cols || hy >= rows) return -1;
    if (occ.has(hx + ',' + hy)) return -1;
    const seen = new Set([hx + ',' + hy]);
    const q = [[hx, hy]];
    while (q.length) {
        const [x, y] = q.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const k = nx + ',' + ny;
            if (seen.has(k) || occ.has(k)) continue;
            seen.add(k);
            q.push([nx, ny]);
        }
    }
    return seen.size;
}

function printBoard(g) {
    const rows = [];
    for (let y = g.rows - 1; y >= 0; y--) {
        let line = '';
        for (let x = 0; x < g.cols; x++) {
            const isHead = g.snake[0].x === x && g.snake[0].y === y;
            const isBody = g.snake.some(c => c.x === x && c.y === y);
            const isFood = g.food.x === x && g.food.y === y;
            if (isHead) line += ' H ';
            else if (isFood) line += ' * ';
            else if (isBody) line += ' o ';
            else line += ' . ';
        }
        rows.push(line);
    }
    return rows.join('\n');
}

function main() {
    const g = new SnakeCore({ cols: 16, rows: 24 });
    console.log('棋盘 %dx%d，初始长度 %d', g.cols, g.rows, g.snake.length);
    console.log('='.repeat(70));

    const total = g.cols * g.rows;
    let lastEat = -1;
    let invalidAt = -1;

    for (let step = 1; step <= 5000; step++) {
        if (!g.alive) {
            console.log(`第 ${step} 步撞死。分数 ${g.score}，长度 ${g.length}，进食 ${g.eaten} 次`);
            break;
        }

        const d = chooseDir(g);
        if (d) g.requestDir(d);

        const headBefore = { x: g.snake[0].x, y: g.snake[0].y };
        const foodBefore = { x: g.food.x, y: g.food.y };
        const r = g.step();

        if (r === StepResult.EAT) {
            lastEat = step;
            const rc = reachableCount(g);
            const occ = g.snake.length;
            const dupCheck = new Set(g.snake.map(c => c.x + ',' + c.y)).size;

            console.log(`进食#${g.eaten} 步${step}: 分数=${g.score} 长度=${occ} 占格=${dupCheck} ` +
                `食物=(${g.food.x},${g.food.y}) 可达格=${rc}`);

            if (g.food.x < 0 || g.food.y < 0) {
                invalidAt = step;
                console.log('');
                console.log('❌❌❌ 食物变成无效位置！❌❌❌');
                console.log(`  局面：长度 ${occ}（占格 ${dupCheck}）  棋盘总格 ${total}  已占 ${(dupCheck / total * 100).toFixed(1)}%`);
                console.log(`  可达格数（独立复算）：${rc}`);
                console.log(`  蛇头位置：(${g.snake[0].x},${g.snake[0].y})  朝向：(${g.dir.x},${g.dir.y})`);
                console.log('');
                console.log('  棋盘：');
                console.log(printBoard(g));
                break;
            }
        }
    }

    console.log('='.repeat(70));
    console.log(`最终：分数 ${g.score}  长度 ${g.length}  进食 ${g.eaten} 次  存活 ${g.alive}`);
    console.log(`最后一次进食在第 ${lastEat} 步`);
    if (invalidAt > 0) {
        console.log(`食物失效发生在第 ${invalidAt} 步 —— 这就是「不再产生新豆」的原因`);
    } else {
        console.log('全程食物位置始终有效（未复现「食物失效」）');
    }
    return 0;
}

main();
