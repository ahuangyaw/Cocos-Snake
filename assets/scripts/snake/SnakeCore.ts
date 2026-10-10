/**
 * SnakeCore —— 纯逻辑核心（不依赖任何 Cocos API）
 *
 * 【为什么单独拆出来，这是全项目最重要的一层设计】
 *
 *   1. 可测试：不导入 cc，就能用 Node 直接跑单元测试验证规则（撞墙/反向/吃食物）。
 *   2. 可移植：同一份逻辑可以套不同渲染层（Graphics / 贴图 / 抖音小游戏自绘）。
 *   3. 可确定性：固定步长 + 无随机数状态 → 相同输入序列必得相同结果，
 *      这对「录像回放」「断线重连」「bug 复现」都是决定性的。
 *
 * 坐标约定：格子坐标 (x, y)，x 向右增大，y 向上增大。
 *     (0,0) 是棋盘左下角。
 */

/** 单次输入的方向 */
export interface Dir {
    x: number;
    y: number;
}

export const DIR_UP: Dir = { x: 0, y: 1 };
export const DIR_DOWN: Dir = { x: 0, y: -1 };
export const DIR_LEFT: Dir = { x: -1, y: 0 };
export const DIR_RIGHT: Dir = { x: 1, y: 0 };

/** 一个可度的格子 */
export interface Cell {
    x: number;
    y: number;
}

export enum StepResult {
    /** 正常前进 */
    MOVE = 0,
    /** 吃到食物 */
    EAT = 1,
    /** 撞墙 */
    HIT_WALL = 2,
    /** 撞到自己 */
    HIT_SELF = 3,
}

export interface SnakeConfig {
    cols: number;
    rows: number;
    /** 初始长度 */
    startLength: number;
    /** 每个食物增长几节 */
    growPerFood: number;
}

export const DEFAULT_CONFIG: SnakeConfig = {
    cols: 16,
    rows: 24,
    startLength: 4,
    growPerFood: 3,
};

export class SnakeCore {

    public readonly cols: number;
    public readonly rows: number;
    public readonly growPerFood: number;

    /** 蛇身格子，**下标 0 是头** */
    public snake: Cell[] = [];
    /** 本步开始时蛇身各节的格子位置（用于渲染插值） */
    public prevSnake: Cell[] = [];
    public dir: Dir = DIR_RIGHT;
    /** 输入缓冲：最多缓存 2 个转向，快速连按不丢输入 */
    public readonly inputQueue: Dir[] = [];
    public food: Cell = { x: 0, y: 0 };
    public score = 0;
    public eaten = 0;
    public steps = 0;
    public alive = true;

    /** 已占用的格子位图，用一维数组代替 Set，避免每步分配对象 */
    private readonly _occupied: Uint8Array;
    /** 伪随机状态，自带种子以便可复现 */
    private _rng: number;

    constructor(config: Partial<SnakeConfig> = {}, seed = 0x9e3779b9) {
        const cfg = { ...DEFAULT_CONFIG, ...config };
        this.cols = cfg.cols;
        this.rows = cfg.rows;
        this.growPerFood = cfg.growPerFood;
        this._occupied = new Uint8Array(this.cols * this.rows);
        this._rng = seed >>> 0;
        this.reset();
    }

    private _idx(x: number, y: number): number {
        return y * this.cols + x;
    }

    private _rand(): number {
        // xorshift32：确定性、无分配，比 Math.random 更适合需要可复现的游戏逻辑
        let s = this._rng;
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        this._rng = s;
        return s / 0xffffffff;
    }

    /** 重开一局 */
    public reset(): void {
        this.snake = [];
        this.prevSnake = [];
        this.dir = DIR_RIGHT;
        this.inputQueue.length = 0;
        this.score = 0;
        this.eaten = 0;
        this.steps = 0;
        this.alive = true;
        this._occupied.fill(0);

        const cx = Math.floor(this.cols / 2);
        const cy = Math.floor(this.rows / 2);
        for (let i = 0; i < DEFAULT_CONFIG.startLength; i++) {
            const cell = { x: cx - i, y: cy };
            this.snake.push(cell);
            this._occupied[this._idx(cell.x, cell.y)] = 1;
        }
        this._placeFood();
    }

    /**
     * 请求转向。
     *
     * 三条规则，缺一不可：
     *   1. 不能 180° 反向（会立刻撞到自己脖子）
     *   2. 不能和「队列里最后一个待执行方向」相同或相反 —— 判定基准必须是队列尾，
     *      不是当前方向。否则「向上时快速按左再按下」会被错误地全部丢弃。
     *   3. 队列最多 2 个，防止玩家狂按把操作延迟拖长
     */
    public requestDir(d: Dir): boolean {
        const base = this.inputQueue.length > 0
            ? this.inputQueue[this.inputQueue.length - 1]
            : this.dir;

        // 同向：忽略
        if (d.x === base.x && d.y === base.y) return false;
        // 反向：拒绝
        if (d.x === -base.x && d.y === -base.y) return false;
        // 队列已满：丢弃（宁可丢输入，也不要制造操作延迟）
        if (this.inputQueue.length >= 2) return false;

        this.inputQueue.push(d);
        return true;
    }

    /**
     * 依据当前蛇身重建占用位图。
     *
     * 存在的理由：占用位图是「派生数据」，必须和 snake 数组保持一致。
     * 一旦有人直接改 snake（测试、调试、读档回放），位图就会失配，
     * 现象是「撞自己检测失灵」——非常难查。
     * 所以凡是外部改动了蛇身，都必须调用这个方法重建。
     */
    public rebuildOccupancy(): void {
        this._occupied.fill(0);
        for (const c of this.snake) {
            if (c.x >= 0 && c.y >= 0 && c.x < this.cols && c.y < this.rows) {
                this._occupied[this._idx(c.x, c.y)] = 1;
            }
        }
    }

    /** 调试/测试用：校验内部状态是否自洽 */
    public validate(): string[] {
        const problems: string[] = [];
        if (this.snake.length === 0) problems.push('蛇身为空');
        for (const c of this.snake) {
            if (c.x < 0 || c.y < 0 || c.x >= this.cols || c.y >= this.rows) {
                problems.push(`蛇身越界 (${c.x},${c.y})`);
            }
        }
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const occupied = this.snake.some(c => c.x === x && c.y === y);
                if (occupied !== (this._occupied[this._idx(x, y)] === 1)) {
                    problems.push(`占用位图与蛇身不一致 @(${x},${y})`);
                    return problems;   // 一个例子足够定位
                }
            }
        }
        return problems;
    }

    /** 食物不能生成在蛇身上，也不能和当前位置重合 */
    private _placeFood(): void {
        const total = this.cols * this.rows;
        if (this.snake.length >= total) {
            // 棋盘被填满 = 通关
            this.food = { x: -1, y: -1 };
            return;
        }
        // 先从蛇头做一次洪水填充，得到所有「真正走得到」的格子。
        // 少了这一步，食物会生成在被蛇身圈起来的死区里 —— 玩家看得见却永远吃不到。
        const reachable = this._reachableFromHead();
        const pool: number[] = [];
        for (let p = 0; p < total; p++) {
            if (reachable[p]) pool.push(p);
        }
        if (pool.length === 0) {
            // 没有可达空格（蛇把自己完全封死），保持原食物
            this.food = { x: -1, y: -1 };
            return;
        }
        const chosen = pool[Math.floor(this._rand() * pool.length)];
        this.food = { x: chosen % this.cols, y: Math.floor(chosen / this.cols) };
    }

    /**
     * 从蛇头出发做一次 BFS，返回 1 = 可到达 的位图。
     *
     * 用「遍历棋盘」这种朴素做法，是因为它只在吃食物时调用一次
     * （不是每帧），384 格的棋盘一次遍历完全可以忽略。
     * 判断「要不要优化」的依据是调用频率，不是代码看起来先不先进。
     */
    private _reachableFromHead(): Uint8Array {
        const total = this.cols * this.rows;
        const visited = new Uint8Array(total);
        const head = this.snake[0];
        const cols = this.cols;
        const rows = this.rows;
        const occupied = this._occupied;

        // 蛇头下一步要进入的格子才是「起点」
        const hx = head.x + this.dir.x;
        const hy = head.y + this.dir.y;
        if (hx < 0 || hy < 0 || hx >= cols || hy >= rows) return visited;

        const start = hy * cols + hx;
        if (occupied[start] === 1) return visited;    // 正前方就是身体，无处可去

        // 用普通数组当队列（只存下标，容量天然不超过格子数）
        const queue: number[] = [start];
        visited[start] = 1;
        let qh = 0;

        while (qh < queue.length) {
            const p = queue[qh++];
            const x = p % cols;
            const y = (p / cols) | 0;

            if (x > 0) this._push(p - 1, visited, occupied, queue);
            if (x < cols - 1) this._push(p + 1, visited, occupied, queue);
            if (y > 0) this._push(p - cols, visited, occupied, queue);
            if (y < rows - 1) this._push(p + cols, visited, occupied, queue);
        }
        return visited;
    }

    private _push(p: number, visited: Uint8Array, occupied: Uint8Array, queue: number[]): void {
        if (visited[p] === 1 || occupied[p] === 1) return;
        visited[p] = 1;
        queue.push(p);
    }

    /**
     * 推进一个逻辑步。
     * 这是整个游戏唯一改变状态的地方 —— 固定步长调用它，渲染层只负责画。
     */
    public step(): StepResult {
        if (!this.alive) return StepResult.MOVE;

        // ① 从缓冲取出一个方向正式生效
        const next = this.inputQueue.shift();
        if (next) this.dir = next;

        const head = this.snake[0];
        const nx = head.x + this.dir.x;
        const ny = head.y + this.dir.y;

        // ② 撞墙
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) {
            this.alive = false;
            return StepResult.HIT_WALL;
        }

        // ③ 撞自己。
        //    细节：尾巴这一格本步会被腾出来，所以「头进入当前尾巴格」不算撞。
        //    少了这个判断，贴着自己转弯时会莫名其妙暴毙。
        const tailIdx = this.snake.length - 1;
        const tail = this.snake[tailIdx];
        const isTailCell = (nx === tail.x && ny === tail.y);
        const willEat = (nx === this.food.x && ny === this.food.y);

        if (this._occupied[this._idx(nx, ny)] === 1) {
            if (!isTailCell || willEat) {
                this.alive = false;
                return StepResult.HIT_SELF;
            }
        }

        // ④ 记录本步起始位置，供渲染层做插值
        this.prevSnake = this.snake.map(c => ({ x: c.x, y: c.y }));

        // ⑤ 前进：整体后移一格
        this.snake.unshift({ x: nx, y: ny });
        this._occupied[this._idx(nx, ny)] = 1;

        if (willEat) {
            // 吃到了：不删尾 → 长度 +1；额外增长通过再补几节实现
            for (let i = 1; i < this.growPerFood; i++) {
                const t = this.snake[this.snake.length - 1];
                this.snake.push({ x: t.x, y: t.y });
            }
            this.eaten++;
            this.score += 10 + Math.min(40, (this.eaten - 1) * 2);   // 越吃越值钱，制造正反馈
            this._placeFood();
            this.steps++;
            return StepResult.EAT;
        }

        // 没吃到：删尾
        const removed = this.snake.pop()!;
        // 注意：若蛇身里还有同格（吃食物时补的节），不能清掉占用位
        let stillOccupied = false;
        for (let i = 0; i < this.snake.length; i++) {
            if (this.snake[i].x === removed.x && this.snake[i].y === removed.y) {
                stillOccupied = true;
                break;
            }
        }
        if (!stillOccupied) this._occupied[this._idx(removed.x, removed.y)] = 0;

        this.steps++;
        return StepResult.MOVE;
    }

    /** 供渲染层读取：返回格子中心在一维数组里的顺序（0 是头） */
    public get length(): number {
        return this.snake.length;
    }
}
