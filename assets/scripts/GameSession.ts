import { _decorator, Component, Node, SpriteFrame, Label, Color, view, HorizontalTextAlignment, KeyCode } from 'cc';
import { PlayerController } from './PlayerController';
import { CollectibleField } from './CollectibleField';

const { ccclass, property } = _decorator;

/**
 * GameSession —— 游戏流程编排
 *
 * 职责：
 *   1. 组装：把资源、引用交给其他组件（「组合优于全局查找」）
 *   2. 规则：计分、连击、倒计时、结束与重开
 *   3. 界面：用代码创建 HUD（分数/时间/连击提示），避免场景里塞满 UI 节点
 *
 * 本组件可以有两种存在方式，代码对两者都成立：
 *   A. GameBootstrap 在运行时把你挂上来（推荐）
 *   B. 你手动把它拖到工具栏上
 */
@ccclass('GameSession')
export class GameSession extends Component {

    @property({ tooltip: '玩家贴图' })
    public playerSprite: SpriteFrame | null = null;

    @property({ tooltip: '宝石贴图' })
    public dotSprite: SpriteFrame | null = null;

    @property({ tooltip: '单局时长（秒）' })
    public roundSeconds = 60;

    @property({ tooltip: '连击有效窗口（秒）' })
    public comboWindow = 1.2;

    @property({ tooltip: '是否把调试信息打到控制台' })
    public verbose = true;

    private _player: PlayerController | null = null;
    private _field: CollectibleField | null = null;

    private _score = 0;
    private _combo = 0;
    private _comboTimer = 0;
    private _remain = 0;
    private _ended = false;
    private _endElapsed = 0;
    private _hintTimer = 0;

    private _scoreLabel: Label | null = null;
    private _hintLabel: Label | null = null;
    private _timerLabel: Label | null = null;

    // 缓存上一次显示的值：只有变化时才重设 Label.string，
    // 避免每帧拼字符串（每帧分配垃圾是 UI 卡顿的常见原因）
    private _lastScore = -1;
    private _lastCombo = -1;
    private _lastSec = -1;

    private _ready = false;

    /**
     * 延迟一帧初始化。
     *
     * 为什么不用 onLoad 直接干：
     *   GameBootstrap 可能在运行时用 addComponent 把 PlayerController /
     *   CollectibleField 挂到同一个节点上，而这些组件的 onLoad 何时执行
     *   取决于挂载时机。scheduleOnce(0) 把初始化推迟到**下一帧**，
     *   此时无论它们是怎么被挂上来的，onLoad 都已完成 —— 彻底消除顺序依赖。
     *   这是引擎里非常实用的一招：**用「晚一帧」换「顺序确定」**。
     */
    onLoad() {
        this.scheduleOnce(() => this._init(), 0);
    }

    private _init() {
        if (this._ready) return;
        this._ready = true;

        // ---- ① 组装：拿到同节点上的另外两个组件 ----
        this._player = this.getComponent(PlayerController);
        this._field = this.getComponent(CollectibleField);

        if (this._player) {
            this._player.spriteFrame = this.playerSprite;
        }
        if (this._field) {
            this._field.dotSpriteFrame = this.dotSprite;
            this._field.onCollected = (count: number) => this._onDotCollected(count);
            // 注意：不在这里给 _field.player 赋值。
            // CollectibleField 会自己惰性解析玩家，避免依赖谁先初始化。
        }

        // ---- ② 依据设计分辨率决定活动范围 ----
        const size = view.getVisibleSize();
        const halfX = size.width / 2;
        const halfY = size.height / 2;
        if (this._player) {
            this._player.halfExtentX = halfX;
            this._player.halfExtentY = halfY;
            this._player.node.setPosition(0, 0, 0);
        }

        // ---- ③ 创建 HUD ----
        this._buildHud(halfX, halfY);

        // ---- ④ 开局 ----
        if (this._field) {
            this._field.begin(halfX - 60, halfY + 40, -halfY - 40);
        }
        this._remain = this.roundSeconds;
        this._refreshHud();

        if (this.verbose) {
            console.log('[GameSession] 开局：%d 秒 | WASD/方向键移动，吃宝石得分', this.roundSeconds);
            if (!this._player || !this._field) {
                console.error('[GameSession] 缺少组件：player=%s field=%s',
                    !!this._player, !!this._field);
            }
        }
    }

    // ------------------------------------------------------------------
    // HUD
    // ------------------------------------------------------------------
    private _makeLabel(name: string, x: number, y: number, fontSize: number,
                       color: Color, align = HorizontalTextAlignment.CENTER): Label {
        const node = new Node(name);
        node.layer = this.node.layer;
        this.node.addChild(node);
        node.setPosition(x, y, 0);

        const label = node.addComponent(Label);
        label.string = '';
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 4;
        label.color = color;
        label.horizontalAlign = align;
        return label;
    }

    private _buildHud(halfX: number, halfY: number) {
        const white = new Color(255, 255, 255, 255);
        const cyan = new Color(120, 230, 255, 255);
        const yellow = new Color(255, 220, 120, 255);

        this._scoreLabel = this._makeLabel('ScoreLabel', -halfX + 130, halfY - 34, 30, yellow,
            HorizontalTextAlignment.LEFT);
        this._timerLabel = this._makeLabel('TimerLabel', halfX - 110, halfY - 34, 30, cyan,
            HorizontalTextAlignment.RIGHT);
        this._hintLabel = this._makeLabel('HintLabel', 0, -halfY + 40, 22, white);
    }

    private _refreshHud() {
        const sec = Math.max(0, Math.ceil(this._remain));
        if (this._scoreLabel && (this._score !== this._lastScore || this._combo !== this._lastCombo)) {
            this._scoreLabel.string = this._combo > 1
                ? `分数 ${this._score}   x${this._combo}`
                : `分数 ${this._score}`;
            this._lastScore = this._score;
            this._lastCombo = this._combo;
        }
        if (this._timerLabel && sec !== this._lastSec) {
            this._timerLabel.string = `倒计时 ${sec}s`;
            this._lastSec = sec;
        }
    }

    // ------------------------------------------------------------------
    // 规则
    // ------------------------------------------------------------------
    private _onDotCollected(count: number) {
        // 连击：在 comboWindow 内连续吃到就累加，否则从 1 重来
        this._combo = this._comboTimer > 0 ? this._combo + count : 1;
        this._comboTimer = this.comboWindow;

        this._score += this._combo;

        if (this._combo >= 3 && this._hintLabel) {
            this._hintLabel.string = `连击 x${this._combo}！`;
            this._hintTimer = 0.5;
        }
        this._refreshHud();
    }

    private _endRound() {
        this._ended = true;
        if (this._field) this._field.halt();
        if (this._hintLabel) {
            this._hintLabel.string = `时间到！最终分数 ${this._score} —— 按 R 重开`;
        }
        if (this.verbose) {
            const s = this._field ? this._field.stats : { active: 0, pooled: 0 };
            console.log('[GameSession] 本局结束，分数 =', this._score,
                '| 对象池 active =', s.active, ' pooled =', s.pooled);
        }
    }

    private _restart() {
        this._score = 0;
        this._combo = 0;
        this._comboTimer = 0;
        this._hintTimer = 0;
        this._remain = this.roundSeconds;
        this._ended = false;
        this._endElapsed = 0;
        this._lastScore = -1;
        this._lastCombo = -1;
        this._lastSec = -1;
        if (this._hintLabel) this._hintLabel.string = '';
        if (this._player) this._player.node.setPosition(0, 0, 0);

        const size = view.getVisibleSize();
        if (this._field) {
            this._field.begin(size.width / 2 - 60, size.height / 2 + 40, -size.height / 2 - 40);
        }
        this._refreshHud();
        if (this.verbose) console.log('[GameSession] 重新开局');
    }

    update(dt: number) {
        if (!this._ready) return;

        // 连击窗口计时
        if (this._comboTimer > 0) {
            this._comboTimer -= dt;
            if (this._comboTimer <= 0) this._combo = 0;
        }
        // 连击提示的显示时长
        if (this._hintTimer > 0) {
            this._hintTimer -= dt;
            if (this._hintTimer <= 0 && this._hintLabel && !this._ended) {
                this._hintLabel.string = '';
            }
        }

        if (this._ended) {
            // 结束后 1 秒内不响应，避免结束瞬间的误触；之后按 R 重开
            this._endElapsed += dt;
            if (this._endElapsed > 1 && this._player && this._player.isKeyPressed(KeyCode.KEY_R)) {
                this._restart();
            }
            return;
        }

        this._remain -= dt;
        if (this._remain <= 0) {
            this._remain = 0;
            this._endRound();
        }
        this._refreshHud();
    }
}
