import { _decorator, Component, Node, Graphics, UITransform, Color, Label, HorizontalTextAlignment, VerticalTextAlignment, view, sys } from 'cc';
import { SnakeCore, StepResult, Dir } from './SnakeCore';
import { computeLayout, LayoutResult } from './layout';

const { ccclass, property } = _decorator;

/** 调色板 —— 集中管理，改主题只改这里 */
const PALETTE = {
    boardBg: new Color(17, 22, 34, 255),
    boardEdge: new Color(48, 60, 88, 255),
    gridLine: new Color(30, 38, 56, 255),
    snakeHead: new Color(126, 231, 135, 255),
    snakeBodyNear: new Color(52, 199, 89, 255),
    snakeBodyFar: new Color(24, 105, 74, 255),
    snakeGlow: new Color(52, 199, 89, 60),
    eyeWhite: new Color(240, 255, 245, 255),
    eyePupil: new Color(12, 20, 16, 255),
    foodCore: new Color(255, 196, 61, 255),
    foodGlow: new Color(255, 196, 61, 70),
    foodRing: new Color(255, 232, 150, 200),
    particle: new Color(255, 214, 102, 255),
    hudText: new Color(226, 236, 255, 255),
    hudDim: new Color(120, 138, 170, 255),
    overlay: new Color(6, 10, 18, 205),
    accent: new Color(126, 231, 135, 255),
};

/** 一个粒子（吃食物时的爆散效果） */
interface Particle {
    x: number; y: number;      // 像素坐标（相对棋盘中心）
    vx: number; vy: number;
    life: number; maxLife: number;
    size: number;
}

/**
 * 界面布局结果的类型别名。
 *
 * 真正的计算逻辑在 layout.ts 的 computeLayout() 里 —— 那是个**纯函数**，
 * 不依赖任何引擎 API，所以可以在 Node 里用真实设备尺寸做单元测试
 * （见 tools/test_layout.js，覆盖 iPhone 刘海屏 / 灵动岛 / 各种安卓长屏 / 平板）。
 * 这里只是引用它的结果类型。
 */
type Layout = LayoutResult;

/**
 * SnakeView —— 渲染 + 手感层
 *
 * 架构要点：
 *   1. **逻辑与渲染分离**：本类只读 SnakeCore 的状态，从不修改它。
 *   2. **插值渲染**：逻辑按固定步长走（每秒 6~16 步），渲染却跑满 60/120 帧。
 *      在两次逻辑步之间做线性插值，于是「格子游戏」也能有连续的顺滑运动。
 *      这是把「固定步长」和「顺滑画面」同时拿到手的标准做法。
 *   3. **静态/动态分离**：棋盘背景单独一个 Graphics，只在尺寸变化时画一次；
 *      每帧只重画蛇、食物、粒子，省掉上百次路径提交。
 */
@ccclass('SnakeView')
export class SnakeView extends Component {

    // 注意：格子边长不再由编辑器配置。
    // 它必须由「屏幕尺寸 + 行列数」算出来，否则换设备就会溢出或留白。
    // 布局参数集中在 _computeLayout()，这里只留纯玩法/手感参数。

    @property({ tooltip: '逻辑步长（秒）—— 数值越小蛇越快' })
    public baseStepInterval = 0.16;

    @property({ tooltip: '最快时的步长（秒）' })
    public minStepInterval = 0.062;

    @property({ tooltip: '每吃一个食物，步长减少多少' })
    public speedUpPerFood = 0.0035;

    /**
     * 提前转身的临界点（一步走过多少比例后，玩家的转向输入可以立刻生效）。
     *
     * 手感参数，越大越跟手，但蛇看起来越"急"：
     *   0.15 → 很跟手，转身略显突兀
     *   0.32 → 默认，平衡点
     *   0.60 → 保守，接近"老实等一步"
     * 在编辑器属性检查器里直接拖，不用改代码。
     */
    @property({ tooltip: '提前转身临界点（0~1）：越大越跟手' })
    public earlyTurnAt = 0.32;

    // ------------------------------------------------------------------
    // 内部状态
    // ------------------------------------------------------------------
    private _core!: SnakeCore;
    private _board!: Graphics;      // 静态层
    private _dyn!: Graphics;        // 动态层（每帧重绘）
    private _overlay!: Graphics;    // 覆盖层（暂停/结束）

    /** 布局结果，onLoad 时算一次 */
    private _L!: Layout;

    private _accum = 0;             // 固定步长累加器
    private _alpha = 0;             // 插值系数 0..1
    private _dirtyBoard = true;

    private _shakeTime = 0;
    private _shakeMag = 0;
    private _shakeDur = 1;
    private _dynBaseX = 0;
    private _dynBaseY = 0;
    private _particles: Particle[] = [];
    private _deathFlash = 0;
    private _eatPop = 0;
    private _time = 0;

    private _lblScore!: Label;
    private _lblBest!: Label;
    private _lblSpeed!: Label;
    private _lblTitle!: Label;
    private _lblTip!: Label;

    public paused = false;
    public best = 0;
    public onGameOver: ((score: number) => void) | null = null;

    /**
     * 事件钩子 —— 渲染层对外「广播」发生了什么，但**完全不知道谁会听**。
     *
     * 这是本项目的分层原则：
     *   SnakeView 只管把发生的事说出来，音频层 / 震动层 / 统计层自己去订阅。
     *   好处：以后加「音效」「手柄震动」「埋点上报」都不用改渲染层一行代码。
     *   坏处：比直接调用多一层间接 —— 但游戏越长，这一层越值钱。
     */
    public onEat: ((comboLevel: number) => void) | null = null;
    public onDirectionTurn: (() => void) | null = null;
    public onDeath: (() => void) | null = null;
    public onNewRecord: (() => void) | null = null;
    public onRestart: (() => void) | null = null;

    /** 连击等级：短时间内连续吃到食物就递增，用来给音效升调 */
    private _comboLevel = 0;
    private _comboTimer = 0;
    private readonly COMBO_WINDOW = 1.1;

    private _bumpCombo() {
        this._comboLevel = this._comboTimer > 0 ? Math.min(5, this._comboLevel + 1) : 0;
        this._comboTimer = this.COMBO_WINDOW;
    }

    private _dirProvider: (() => Dir | null) | null = null;
    /** 本步内是否刚收到转向输入（用于「临界点提前转身」） */
    private _pendingTurn = false;

    /**
     * 是否推进游戏逻辑。由上层（GameSession 的状态机）控制。
     *
     * 刻意不做成 `setState(GameState)`：那样渲染层就要 import 状态枚举，
     * 两个模块会互相依赖。这里只暴露一个布尔开关 ——
     * 渲染层只需要知道「动」或「不动」，不需要知道为什么不动。
     */
    public simulate = true;

    // ==================================================================
    // 生命周期
    // ==================================================================
    onLoad() {
        this._core = new SnakeCore();
        this.loadBest();

        this._L = this._computeLayout();
        this._buildLayers();
        this._buildHud();
        this._dirtyBoard = true;

        console.log(`[SnakeView] 竖屏布局：格子 ${this._L.cell.toFixed(1)}px，` +
            `棋盘 ${this._L.boardW.toFixed(0)}x${this._L.boardH.toFixed(0)}，` +
            `安全区上${this._L.insetTop.toFixed(0)}下${this._L.insetBottom.toFixed(0)}`);
    }

    /**
     * 取当前视口与安全区，交给纯函数计算布局。
     *
     * 这里只做「从引擎取数据」，不含任何布局数学 ——
     * 数学全在 layout.ts，那边有 19 条测试覆盖 11 种设备尺寸。
     * 这样即使布局出问题，也能在 Node 里复现和修复，不依赖真机。
     */
    private _computeLayout(): Layout {
        const visible = view.getVisibleSize();

        let insetTop = 0, insetBottom = 0, insetLeft = 0, insetRight = 0;
        try {
            // 安全区 API 在 sys 命名空间上，返回设计分辨率坐标系下的矩形；
            // 引擎已支持 Android / iOS / 微信 / 字节（抖音）小游戏。
            const sa = sys.getSafeAreaRect();
            if (sa && sa.width > 0 && sa.height > 0) {
                insetLeft = Math.max(0, sa.x);
                insetBottom = Math.max(0, sa.y);
                insetRight = Math.max(0, visible.width - (sa.x + sa.width));
                insetTop = Math.max(0, visible.height - (sa.y + sa.height));
            }
        } catch (e) {
            // 个别平台/旧版本不支持，退回无边距，绝不影响启动
        }

        return computeLayout(
            {
                width: visible.width,
                height: visible.height,
                insetTop, insetBottom, insetLeft, insetRight,
            },
            this._core.cols,
            this._core.rows
        );
    }

    // ==================================================================
    // 构建
    // ==================================================================
    private _makeGraphics(name: string, parent: Node): Graphics {
        const node = new Node(name);
        node.layer = this.node.layer;
        parent.addChild(node);
        node.setPosition(0, 0, 0);
        const ui = node.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);   // 锚点居中：绘制坐标 = 相对棋盘中心
        ui.setContentSize(this._L.boardW + 40, this._L.boardH + 40);
        return node.addComponent(Graphics);
    }

    private _buildLayers() {
        // 棋盘组：整体偏移到布局算出的棋盘中心。
        // 这样一来，棋盘内所有绘制代码都能用「以棋盘中心为原点」的坐标，
        // 不必到处加上中心偏移 —— 少一处偏移就少一类 bug。
        const group = new Node('BoardGroup');
        group.layer = this.node.layer;
        this.node.addChild(group);
        group.setPosition(this._L.boardCx, this._L.boardCy, 0);

        this._dynBaseX = 0;
        this._dynBaseY = 0;

        this._board = this._makeGraphics('Board', group);
        this._dyn = this._makeGraphics('Dynamic', group);
        // 覆盖层铺满整屏，所以挂在根节点上、不加棋盘偏移
        this._overlay = this._makeGraphics('Overlay', this.node);
        const oui = this._overlay.node.getComponent(UITransform);
        if (oui) oui.setContentSize(this._L.vw * 2, this._L.vh * 2);
    }

    private _makeLabel(name: string, x: number, y: number, size: number,
                       color: Color, align: HorizontalTextAlignment): Label {
        const node = new Node(name);
        node.layer = this.node.layer;
        this.node.addChild(node);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 6;
        label.color = color;
        label.horizontalAlign = align;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        const ui = node.getComponent(UITransform);
        if (ui) ui.setContentSize(360, size + 12);
        return label;
    }

    private _buildHud() {
        const L = this._L;

        // ---- 顶部：标题 ----
        const title = this._makeLabel('Title', 0, L.hudTitleY, 15, PALETTE.hudDim,
            HorizontalTextAlignment.CENTER);
        title.string = 'SNAKE';

        // ---- 顶部主行：分数（大）----
        this._lblScore = this._makeLabel('Score', 0, L.hudScoreY, 44, PALETTE.hudText,
            HorizontalTextAlignment.CENTER);

        // ---- 分数下方两侧：最高分 / 速度 ----
        const sideY = L.hudSubY;
        this._lblBest = this._makeLabel('Best', -L.vw / 2 + 88, sideY, 18, PALETTE.hudDim,
            HorizontalTextAlignment.CENTER);

        this._lblSpeed = this._makeLabel('Speed', L.vw / 2 - 88, sideY, 18, PALETTE.hudDim,
            HorizontalTextAlignment.CENTER);

        // ---- 底部：操作提示 ----
        const help = this._makeLabel('Help', 0, L.hudHintY, 15, PALETTE.hudDim,
            HorizontalTextAlignment.CENTER);
        help.string = '滑动屏幕 / WASD 转向 · R 重开 · 空格 暂停 · M 静音';

        // ---- 覆盖层文字（居中在棋盘上）----
        this._lblTitle = this._makeLabel('OverlayTitle', 0, L.boardCy + 26, 46,
            new Color(255, 255, 255, 255), HorizontalTextAlignment.CENTER);
        this._lblTip = this._makeLabel('OverlayTip', 0, L.boardCy - 30, 19,
            new Color(200, 214, 240, 255), HorizontalTextAlignment.CENTER);

        // 覆盖层文字要能盖住棋盘，宽度给足
        for (const lb of [this._lblTitle, this._lblTip]) {
            const ui = lb.node.getComponent(UITransform);
            if (ui) ui.setContentSize(L.vw, 60);
        }

        this._refreshHud();
    }

    // ==================================================================
    // 外部接口
    // ==================================================================
    public setDirectionProvider(fn: () => Dir | null) {
        this._dirProvider = fn;
    }

    /**
     * 通知：本步内刚收到一个新的转向输入。
     *
     * 【为什么要这个方法 —— 这是网格游戏手感的关键技巧】
     *
     * 固定步长意味着：玩家在一步刚开始时按方向，要等最多一整个步长（初始 160ms）
     * 才会看到蛇动。这个「等一步」就是操作延迟感的来源。
     *
     * 做法：如果输入发生在一整步的**后段**（已走过 earlyTurnAt 这个比例），
     * 说明玩家其实已经等得够久了，立刻结束这一步 —— 感知上就是「一按就转」。
     * 如果在**前段**按，则老老实实等这一步走完（否则蛇会瞬移，反而更怪）。
     *
     * 附带效果：提前转身会轻微打断节奏，但玩家永远不会察觉节奏被压缩过，
     * 只会觉得「很跟手」。这是拿时间精度换操作感的经典权衡。
     */
    public notifyDirectionInput() {
        this._pendingTurn = true;
        if (this.onDirectionTurn) this.onDirectionTurn();
    }

    public get core(): SnakeCore {
        return this._core;
    }

    public restart() {
        this._core.reset();
        this._accum = 0;
        this._alpha = 0;
        this._pendingTurn = false;
        this._particles.length = 0;
        this._shakeTime = 0;
        this._deathFlash = 0;
        this._comboLevel = 0;
        this._comboTimer = 0;
        this.paused = false;
        this._setOverlay('');
        this._refreshHud();
        if (this.onRestart) this.onRestart();
    }

    // ==================================================================
    // 最高分持久化
    //
    // 用 sys.localStorage：在浏览器里就是 localStorage，
    // 在抖音小游戏里 Cocos 的适配层会把它映射到 tt.setStorageSync。
    // 所以同一份代码，Web 与抖音小游戏都能用 —— 这是选它而不是直接写
    // window.localStorage 的原因。
    // ==================================================================
    private static readonly BEST_KEY = 'snake.best.v1';

    public loadBest(): void {
        try {
            const raw = sys.localStorage.getItem(SnakeView.BEST_KEY);
            const v = raw ? parseInt(raw, 10) : 0;
            this.best = isNaN(v) || v < 0 ? 0 : v;
        } catch (e) {
            this.best = 0;
            console.warn('[SnakeView] 读取最高分失败:', e);
        }
    }

    private saveBest(v: number) {
        try {
            sys.localStorage.setItem(SnakeView.BEST_KEY, String(Math.floor(v)));
        } catch (e) {
            // 小游戏平台可能在隐私模式下拒绝写入 —— 不能让存档失败拖垮游戏
            console.warn('[SnakeView] 保存最高分失败:', e);
        }
    }

    public get stepInterval(): number {
        const t = Math.min(1, this._core.eaten / 45);
        return this.baseStepInterval + (this.minStepInterval - this.baseStepInterval) * t;
    }

    // ==================================================================
    // 每帧
    // ==================================================================
    update(dt: number) {
        // dt 上限保护：切后台回来时 dt 可能是几秒，
        // 不夹住会让蛇一帧冲出去撞墙 —— 移动端必做
        if (dt > 0.1) dt = 0.1;
        this._time += dt;

        // ---- 死亡闪白 / 震动衰减 / 吃食物涨大 ----
        if (this._deathFlash > 0) this._deathFlash = Math.max(0, this._deathFlash - dt * 2.2);
        if (this._shakeTime > 0) this._shakeTime = Math.max(0, this._shakeTime - dt);
        if (this._eatPop > 0) this._eatPop = Math.max(0, this._eatPop - dt * 3.5);

        // ---- 连击窗口计时 ----
        if (this._comboTimer > 0) {
            this._comboTimer -= dt;
            if (this._comboTimer <= 0) this._comboLevel = 0;
        }

        // ---- 逻辑推进（固定步长） ----
        if (!this.paused && this.simulate && this._core.alive) {
            this._accum += dt;
            const interval = this.stepInterval;

            // 「临界点提前转身」：本步已走过一定比例，且玩家刚给了新转向，
            // 就立刻结算这一步，让操作显得跟手（详见 notifyDirectionInput 的说明）
            if (this._pendingTurn && this._accum >= interval * this.earlyTurnAt
                && this._accum < interval) {
                // 只保留本帧时间作为下一段的起点，避免与刚结算的那一步时间重叠
                this._accum = dt;
                this._doStep();
            }

            let guard = 0;
            while (this._accum >= interval && guard++ < 8) {
                this._accum -= interval;
                this._doStep();
                if (!this._core.alive) { this._accum = 0; break; }
            }
            this._alpha = Math.min(1, this._accum / interval);
            this._pendingTurn = false;
        } else if (!this._core.alive) {
            this._alpha = Math.min(1, this._alpha + dt * 4);
            this._pendingTurn = false;
        } else if (!this.simulate) {
            // 暂停模拟时也要清掉待执行的转向，否则恢复瞬间会突然拐弯
            this._pendingTurn = false;
        }

        // ---- 输入（仅在模拟时消费）----
        if (this._dirProvider && !this.paused && this.simulate && this._core.alive) {
            const d = this._dirProvider();
            if (d) this._core.requestDir(d);
        }

        // ---- 粒子 ----
        this._updateParticles(dt);

        // ---- 绘制 ----
        if (this._dirtyBoard) {
            this._drawBoard();
            this._dirtyBoard = false;
        }
        this._drawDynamic();
        this._drawOverlay();
    }

    private _doStep() {
        const result = this._core.step();

        if (result === StepResult.EAT) {
            this._eatPop = 1;
            this._refreshHud();
            this._bumpCombo();
            const h = this._core.snake[0];
            this._spawnBurst(this._cellToPixel(h.x, h.y), 16);
            this._shake(0.10, 3.2);
            this._refreshHud();
            if (this.onEat) this.onEat(this._comboLevel);
        } else if (result === StepResult.HIT_WALL || result === StepResult.HIT_SELF) {
            const h = this._core.snake[0];
            this._spawnBurst(this._cellToPixel(h.x, h.y), 26);
            this._shake(0.34, 9);
            this._deathFlash = 1;
            this._comboLevel = 0;
            this._comboTimer = 0;
            const prevBest = this.best;
            if (this._core.score > this.best) this.best = this._core.score;
            const isRecord = this._core.score > prevBest && this._core.score > 0;
            this.saveBest(this.best);
            this._setOverlay('GAME OVER', isRecord
                ? `新纪录 ${this._core.score} 分！按 R 重开`
                : `分数 ${this._core.score}  ·  最高 ${this.best}  ·  按 R 重开`);
            this._refreshHud();
            if (this.onDeath) this.onDeath();
            if (isRecord && this.onNewRecord) this.onNewRecord();
            if (this.onGameOver) this.onGameOver(this._core.score);
        }
    }

    private _shake(time: number, mag: number) {
        this._shakeTime = Math.max(this._shakeTime, time);
        this._shakeDur = Math.max(this._shakeDur, time);
        this._shakeMag = Math.max(this._shakeMag, mag);
    }

    private _spawnBurst(p: { x: number; y: number }, n: number) {
        for (let i = 0; i < n; i++) {
            const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
            const sp = 90 + Math.random() * 210;
            this._particles.push({
                x: p.x, y: p.y,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 0, maxLife: 0.35 + Math.random() * 0.35,
                size: 2 + Math.random() * 3.4,
            });
        }
    }

    private _updateParticles(dt: number) {
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const pt = this._particles[i];
            pt.life += dt;
            if (pt.life >= pt.maxLife) {
                this._particles.splice(i, 1);      // 倒序删除，安全
                continue;
            }
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vy -= 260 * dt;                     // 一点重力，让爆散更有重量感
            pt.vx *= 0.94;
        }
    }

    // ==================================================================
    // 坐标换算
    // ==================================================================
    private _cellToPixel(gx: number, gy: number): { x: number; y: number } {
        // 棋盘左下角为格子 (0,0)，绘制原点在棋盘中心
        const cell = this._L.cell;
        return {
            x: (gx + 0.5) * cell - this._L.boardW / 2,
            y: (gy + 0.5) * cell - this._L.boardH / 2,
        };
    }

    private _cellToPixelLerp(prevX: number, prevY: number, curX: number, curY: number, a: number) {
        const cell = this._L.cell;
        return {
            x: ((prevX + (curX - prevX) * a) + 0.5) * cell - this._L.boardW / 2,
            y: ((prevY + (curY - prevY) * a) + 0.5) * cell - this._L.boardH / 2,
        };
    }

    // ==================================================================
    // 静态层：棋盘
    // ==================================================================
    private _drawBoard() {
        const g = this._board;
        g.clear();

        const boardW = this._L.boardW;
        const boardH = this._L.boardH;
        const cell = this._L.cell;
        const halfW = boardW / 2;
        const halfH = boardH / 2;
        const pad = 14;

        // 外发光底盘
        g.fillColor = new Color(10, 14, 24, 255);
        g.roundRect(-halfW - pad, -halfH - pad, boardW + pad * 2, boardH + pad * 2, 18);
        g.fill();

        // 棋盘底色
        g.fillColor = PALETTE.boardBg;
        g.roundRect(-halfW, -halfH, boardW, boardH, 10);
        g.fill();

        // 棋盘描边
        g.lineWidth = 2;
        g.strokeColor = PALETTE.boardEdge;
        g.roundRect(-halfW, -halfH, boardW, boardH, 10);
        g.stroke();

        // 网格线：所有线段攒进一条路径，最后只 stroke 一次（性能关键）
        g.lineWidth = 1;
        g.strokeColor = PALETTE.gridLine;
        for (let i = 1; i < this._core.cols; i++) {
            const x = -halfW + i * cell;
            g.moveTo(x, -halfH);
            g.lineTo(x, halfH);
        }
        for (let j = 1; j < this._core.rows; j++) {
            const y = -halfH + j * cell;
            g.moveTo(-halfW, y);
            g.lineTo(halfW, y);
        }
        g.stroke();
    }

    // ==================================================================
    // 动态层：蛇 + 食物 + 粒子
    // ==================================================================
    private _drawDynamic() {
        const g = this._dyn;
        g.clear();

        // 抖动：作用在**动态层节点**上，不动静态棋盘。
        // 用「基准位置 + 抖动偏移」，基准位置在 _buildLayers 时记下来。
        let sx = 0, sy = 0;
        if (this._shakeTime > 0 && this._shakeDur > 0) {
            const k = this._shakeTime / this._shakeDur;
            const m = this._shakeMag * k * k;        // 平方衰减：尾部更自然地停下来
            sx = (Math.random() * 2 - 1) * m;
            sy = (Math.random() * 2 - 1) * m;
        }
        g.node.setPosition(this._dynBaseX + sx, this._dynBaseY + sy);

        this._drawFood(g);
        this._drawSnake(g);
        this._drawParticles(g);

        if (this._shakeTime <= 0) this._shakeMag = 0;
    }

    private _drawFood(g: Graphics) {
        const f = this._core.food;
        if (f.x < 0 || f.y < 0) return;
        const p = this._cellToPixel(f.x, f.y);
        const pulse = 1 + 0.12 * Math.sin(this._time * 6.5);
        const r = this._L.cell * 0.3 * pulse;

        // 光晕
        g.fillColor = PALETTE.foodGlow;
        g.circle(p.x, p.y, r * 2.1);
        g.fill();

        // 果实本体
        g.fillColor = PALETTE.foodCore;
        g.circle(p.x, p.y, r);
        g.fill();

        // 高光
        g.fillColor = PALETTE.foodRing;
        g.circle(p.x - r * 0.28, p.y + r * 0.3, r * 0.34);
        g.fill();
    }

    private _drawSnake(g: Graphics) {
        const core = this._core;
        const n = core.snake.length;
        if (n === 0) return;

        const a = core.alive ? this._alpha : 1;
        const cell = this._L.cell;
        const baseInset = cell * 0.085;
        const cornerR = cell * 0.32;
        const headR = cornerR + cell * 0.06;

        // ---- 第一遍：柔和外发光（所有圆角矩形攒成一条路径，只 fill 一次）----
        g.fillColor = PALETTE.snakeGlow;
        for (let i = 0; i < n; i++) {
            const cur = core.snake[i];
            const prev = core.prevSnake[i] || cur;
            const p = this._cellToPixelLerp(prev.x, prev.y, cur.x, cur.y, a);
            const inset = baseInset - cell * 0.05;
            const s = cell - inset * 2;
            g.roundRect(p.x - s / 2, p.y - s / 2, s, s, cornerR + 2);
        }
        g.fill();

        // ---- 第二遍：身体（跳过头部，避免头部颜色被身体路径覆盖）----
        for (let i = 1; i < n; i++) {
            const cur = core.snake[i];
            const prev = core.prevSnake[i] || cur;
            const p = this._cellToPixelLerp(prev.x, prev.y, cur.x, cur.y, a);

            // 尾巴随插值收缩：视觉上像"抽走"而不是"突然消失"
            let inset = baseInset;
            if (i === n - 1 && n > 1) {
                inset += (cell * 0.5 - baseInset) * a;
            }
            const s = Math.max(2, cell - inset * 2);
            g.fillColor = this._bodyColor(i, n);
            g.roundRect(p.x - s / 2, p.y - s / 2, s, s, cornerR);
        }
        g.fill();

        // ---- 第三遍：头部（单独 fill，颜色与圆角都不同）----
        const headCur = core.snake[0];
        const headPrev = core.prevSnake[0] || headCur;
        const hp = this._cellToPixelLerp(headPrev.x, headPrev.y, headCur.x, headCur.y, a);
        const headGrow = this._eatPop * cell * 0.07;
        const hs = cell - baseInset * 2 + headGrow;
        g.fillColor = PALETTE.snakeHead;
        g.roundRect(hp.x - hs / 2, hp.y - hs / 2, hs, hs, headR);
        g.fill();

        // ---- 第四遍：眼睛（必须在头部 fill 之后，否则会被盖住）----
        this._drawEyes(g, hp.x, hp.y);
    }

    /**
     * 蛇身配色：头亮尾暗，用颜色表达方向感与长度感。
     * 这里预计算一条颜色带（一次），运行时只做查表 —— 避免每帧为每节蛇身 new Color。
     */
    private static _ramp: Color[] | null = null;
    private static readonly RAMP_N = 48;

    private static _rampColor(): Color[] {
        if (SnakeView._ramp) return SnakeView._ramp;
        const ramp: Color[] = [];
        const c = new Color();
        for (let i = 0; i < SnakeView.RAMP_N; i++) {
            const t = i / (SnakeView.RAMP_N - 1);
            Color.lerp(c, PALETTE.snakeBodyNear, PALETTE.snakeBodyFar, t);
            ramp.push(c.clone());
        }
        SnakeView._ramp = ramp;
        return ramp;
    }

    private _bodyColor(i: number, n: number): Color {
        const ramp = SnakeView._rampColor();
        if (n <= 2) return ramp[0];
        const t = Math.min(1, (i - 1) / (n - 2) * 1.15);
        return ramp[Math.min(SnakeView.RAMP_N - 1, (t * (SnakeView.RAMP_N - 1)) | 0)];
    }

    private _drawEyes(g: Graphics, cx: number, cy: number) {
        const d = this._core.dir;
        const cell = this._L.cell;
        // 眼睛沿运动方向前移，横向分开
        const fx = d.x, fy = d.y;
        const px = -fy, py = fx;                 // 垂直向量
        const fwd = cell * 0.13;
        const side = cell * 0.19;
        const eyeR = Math.max(1.6, cell * 0.115);

        const e1x = cx + fx * fwd + px * side;
        const e1y = cy + fy * fwd + py * side;
        const e2x = cx + fx * fwd - px * side;
        const e2y = cy + fy * fwd - py * side;

        g.fillColor = PALETTE.eyeWhite;
        g.circle(e1x, e1y, eyeR);
        g.circle(e2x, e2y, eyeR);
        g.fill();

        g.fillColor = PALETTE.eyePupil;
        g.circle(e1x + fx * eyeR * 0.42, e1y + fy * eyeR * 0.42, eyeR * 0.52);
        g.circle(e2x + fx * eyeR * 0.42, e2y + fy * eyeR * 0.42, eyeR * 0.52);
        g.fill();
    }

    private _drawParticles(g: Graphics) {
        if (this._particles.length === 0) return;
        for (const pt of this._particles) {
            const k = 1 - pt.life / pt.maxLife;
            g.fillColor = new Color(
                PALETTE.particle.r, PALETTE.particle.g, PALETTE.particle.b,
                Math.max(0, Math.min(255, 255 * k))
            );
            g.circle(pt.x, pt.y, Math.max(0.5, pt.size * k));
        }
        g.fill();
    }

    // ==================================================================
    // 覆盖层：暂停 / 结束
    // ==================================================================
    private _overlayTitle = '';

    private _setOverlay(title: string, tip = '') {
        this._overlayTitle = title;
        if (this._lblTitle) this._lblTitle.string = title;
        if (this._lblTip) this._lblTip.string = tip;
    }

    public setPaused(p: boolean) {
        this.paused = p;
        if (p) {
            this._setOverlay('PAUSED', '空格 继续');
        } else if (this._core.alive) {
            this._setOverlay('', '');
        }
        // 若取消暂停时已经死亡，保持结束提示不变
    }

    private _drawOverlay() {
        const g = this._overlay;
        g.clear();
        if (!this._overlayTitle) {
            if (this._deathFlash > 0) {
                g.fillColor = new Color(255, 80, 80, Math.floor(70 * this._deathFlash));
                g.rect(-5000, -5000, 10000, 10000);
                g.fill();
            }
            return;
        }
        // 半透明遮罩
        g.fillColor = PALETTE.overlay;
        g.rect(-5000, -5000, 10000, 10000);
        g.fill();
        // 结束时的红色闪
        if (this._deathFlash > 0) {
            g.fillColor = new Color(255, 80, 80, Math.floor(46 * this._deathFlash));
            g.rect(-5000, -5000, 10000, 10000);
            g.fill();
        }
    }

    private _refreshHud() {
        if (this._lblScore) this._lblScore.string = `分数 ${this._core.score}`;
        if (this._lblBest) this._lblBest.string = `最高 ${this.best}`;
        if (this._lblSpeed) {
            const sps = 1 / this.stepInterval;
            this._lblSpeed.string = `速度 ${sps.toFixed(1)} 格/秒`;
        }
    }
}
