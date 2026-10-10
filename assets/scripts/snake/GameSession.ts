import { _decorator, Component, Node, Label, Color, view, sys, HorizontalTextAlignment, UITransform } from 'cc';
import { SnakeView } from './SnakeView';
import { SnakeAudio } from './SnakeAudio';
import { GameState, StateMachine } from './StateMachine';
import { makeButton, ButtonHandle, makeLabel, makeDimOverlay, UI, STYLE_PRIMARY, STYLE_DEFAULT } from './UIFactory';

const { ccclass, property } = _decorator;

/**
 * GameSession —— 游戏流程编排（状态机 + 界面 + 按钮）
 *
 * 【它存在的理由】
 *   在此之前，游戏一加载就直接开始跑 —— 因为没有任何「流程」的概念。
 *   本组件引入明确的状态机：
 *
 *       BOOT ──▶ MENU ──▶ PLAYING ⇄ PAUSED
 *                            │
 *                            ▼
 *                        GAME_OVER ──▶ PLAYING（重开）
 *                            └──────▶ MENU（回菜单）
 *
 *   并把「按钮该不该出现」这件事**绑定到状态**上，而不是靠散落的 bool 判断。
 *   这样就不会出现「结束界面上还能点暂停」这类诡异情况。
 *
 * 【它负责什么】
 *   状态机、常驻按钮（静音/暂停）、菜单与结束界面、按钮的显隐与文字刷新
 *
 * 【它不负责什么】
 *   输入监听（SnakeGame）、渲染（SnakeView）、声音细节（SnakeAudio）
 */
@ccclass('GameSession')
export class GameSession extends Component {

    @property({ tooltip: '是否在启动后直接进入游戏（调试用；关掉则先进主菜单）' })
    public skipMenu = false;

    private _view: SnakeView | null = null;
    private _audio: SnakeAudio | null = null;
    private _fsm: StateMachine = new StateMachine(GameState.BOOT);

    // ---- 常驻按钮 ----
    private _btnMute: ButtonHandle | null = null;
    private _btnPause: ButtonHandle | null = null;
    private _btnMenu: ButtonHandle | null = null;

    // ---- 菜单 / 结束界面的节点 ----
    private _overlayRoot: Node | null = null;
    private _menuTitle: Label | null = null;
    private _menuSub: Label | null = null;
    private _menuBtn: ButtonHandle | null = null;
    private _menuBtn2: ButtonHandle | null = null;

    private _vw = 0;
    private _vh = 0;

    // ==================================================================
    // 生命周期
    // ==================================================================
    onLoad() {
        const visible = view.getVisibleSize();
        this._vw = visible.width;
        this._vh = visible.height;

        // 拿到兄弟组件（顺序由 SnakeGame 保证：本组件先于 SnakeView 挂载）
        this._view = this.node.getComponent(SnakeView);
        this._audio = this.node.getComponent(SnakeAudio);

        this._fsm.onChange = (next, prev) => this._onStateChanged(next, prev);
        this._fsm.onIllegal = (from, to) => {
            // 非法切换说明逻辑写错了 —— 开发期必须看得见
            console.warn(`[GameSession] 非法状态切换被拒绝: ${from} -> ${to}`);
        };

        this._buildPersistentButtons();
        this._buildOverlay();

        // 初始状态先不设，等 SnakeGame 调用 bind() 之后再设。
        //
        // 为什么要这样：SnakeView 的 onLoad 晚于本组件，在 bind() 之前
        // view.core 还不存在，此时若切到 GAME_OVER 去读 score 就会崩。
        // 把「状态推进」延后到所有组件都就绪之后，是消除初始化顺序问题的标准做法。
    }

    /**
     * 由 SnakeGame 在所有组件挂载完成后调用一次。
     * 这里才真正启动状态机，并接上「渲染层广播的游戏结束事件」。
     */
    public bind() {
        const view = this._view;
        if (!view) {
            console.error('[GameSession] 找不到 SnakeView，无法启动');
            return;
        }

        // 渲染层广播「本局结束」-> 状态机切到 GAME_OVER。
        // 注意方向是单向的：SnakeView 只知道"我死了"，不知道状态机怎么处理。
        view.onGameOver = () => this.notifyGameOver();

        // 同步一次静音按钮外观
        if (this._audio && this._btnMute) {
            const muted = this._audio.muted;
            this._btnMute.setText(muted ? '🔇 静音' : '🔊 音效');
            this._btnMute.setOn(muted);
        }

        this._fsm.go(this.skipMenu ? GameState.PLAYING : GameState.MENU);
    }

    // ==================================================================
    // 构建：常驻按钮（静音 / 暂停 / 菜单）
    // ==================================================================
    private _buildPersistentButtons() {
        const topY = this._vh / 2 - 40;
        const h = 46;
        const w = 78;

        // 三个按钮排在右下角，避开棋盘与顶部分数
        this._btnMute = makeButton('BtnMute', this.node, this._vw / 2 - 132, topY, w, h,
            '🔊 音效', 16, () => this._toggleMute());

        this._btnPause = makeButton('BtnPause', this.node, this._vw / 2 - 48, topY, w, h,
            '暂停', 17, () => this._togglePause());

        this._btnMenu = makeButton('BtnMenu', this.node, -this._vw / 2 + 60, topY, w, h,
            '菜单', 17, () => this._backToMenu());
    }

    private _toggleMute() {
        if (!this._audio) return;
        const muted = this._audio.toggleMute();
        if (this._btnMute) {
            this._btnMute.setText(muted ? '🔇 静音' : '🔊 音效');
            this._btnMute.setOn(muted);
        }
    }

    private _togglePause() {
        // 先排除「已经死了」的情况。
        // 这能覆盖一个不易察觉的竞态：蛇在 update 里撞墙的同一帧，
        // 玩家正好点了暂停按钮 —— 此时 onGameOver 已把状态推到 GAME_OVER，
        // 若不检查就会把它强行拉回 PAUSED，出现"死亡后还能暂停"的诡异界面。
        if (this._view && !this._view.core.alive) return;

        if (this._fsm.is(GameState.PLAYING)) {
            this._fsm.go(GameState.PAUSED);
        } else if (this._fsm.is(GameState.PAUSED)) {
            this._fsm.go(GameState.PLAYING);
        }
        // 其它状态下忽略（按钮本应是隐藏的，这里再兜一层）
    }

    private _backToMenu() {
        if (!this._fsm.is(GameState.PLAYING) && !this._fsm.is(GameState.PAUSED)) return;
        this._fsm.go(GameState.MENU);
    }

    // ==================================================================
    // 构建：覆盖层（主菜单 / 暂停 / 结束）
    // ==================================================================
    private _buildOverlay() {
        const root = new Node('OverlayRoot');
        root.layer = this.node.layer;
        this.node.addChild(root);
        root.setPosition(0, 0, 0);
        root.addComponent(UITransform).setContentSize(this._vw, this._vh);
        this._overlayRoot = root;

        makeDimOverlay('Dim', root, this._vw, this._vh, 214);

        // 标题与副标题（不同状态换文字，所以只创建一次）
        this._menuTitle = makeLabel('MenuTitle', root, 0, this._vh / 2 - 300, 62,
            UI.menuTitle, HorizontalTextAlignment.CENTER, this._vw);
        this._menuSub = makeLabel('MenuSub', root, 0, this._vh / 2 - 370, 20,
            UI.menuSub, HorizontalTextAlignment.CENTER, this._vw);

        // 主按钮（菜单里是「开始游戏」，结束时是「再来一局」）
        this._menuBtn = makeButton('MenuBtnMain', root, 0, -this._vh / 2 + 300, 260, 74,
            '开始游戏', 30, () => this._onMainAction(), STYLE_PRIMARY);

        // 次按钮：菜单里隐藏；结束时用来「返回主菜单」
        this._menuBtn2 = makeButton('MenuBtnSecondary', root, 0, -this._vh / 2 + 206, 200, 56,
            '返回主菜单', 20, () => this._fsm.go(GameState.MENU), STYLE_DEFAULT);
    }

    /** 主按钮的行为随状态变化：菜单里是「开始」，结束时是「再来一局」 */
    private _onMainAction() {
        this._fsm.go(GameState.PLAYING);
    }

    // ==================================================================
    // 状态变化 —— 界面在这里统一刷新，而不是到处散落 if
    // ==================================================================
    private _onStateChanged(next: GameState, prev: GameState) {
        const view = this._view;

        // ---- 模拟开关 ----
        if (view) view.simulate = (next === GameState.PLAYING);

        // ---- 覆盖层显隐 ----
        const overlayVisible = (next === GameState.MENU || next === GameState.PAUSED
            || next === GameState.GAME_OVER);
        if (this._overlayRoot) this._overlayRoot.active = overlayVisible;

        // ---- 常驻按钮显隐：只在真正游戏中有意义 ----
        const persistentVisible = (next === GameState.PLAYING || next === GameState.PAUSED);
        if (this._btnMute) this._btnMute.node.active = persistentVisible;
        if (this._btnPause) this._btnPause.node.active = persistentVisible;
        if (this._btnMenu) this._btnMenu.node.active = persistentVisible;

        // ---- 按状态刷新覆盖层内容 ----
        switch (next) {
            case GameState.MENU:
                this._setOverlayContent('SNAKE', '滑动 / WASD 转向  ·  吃食物变长',
                    '开始游戏', true);
                break;
            case GameState.PAUSED:
                this._setOverlayContent('已暂停', '点击下方按钮继续',
                    '继续游戏', false);
                break;
            case GameState.GAME_OVER: {
                // view.core 此时一定存在（bind() 在所有组件 onLoad 之后才调用）
                const score = (view && view.core) ? view.core.score : 0;
                const best = view ? view.best : 0;
                const isRecord = score > 0 && score >= best;
                this._setOverlayContent('游戏结束',
                    isRecord ? `新纪录！${score} 分` : `本局 ${score} 分  ·  最高 ${best} 分`,
                    '再来一局', true);
                if (this._menuSub) {
                    this._menuSub.color = isRecord ? UI.menuRecord : UI.menuSub;
                }
                break;
            }
            default:
                break;
        }

        // ---- 进入 PLAYING 时重置局面 ----
        if (next === GameState.PLAYING && prev !== GameState.PAUSED) {
            // 从菜单或结束进入 -> 开新局；从暂停恢复 -> 保持局面不动
            if (view && (prev === GameState.MENU || prev === GameState.GAME_OVER
                || prev === GameState.BOOT)) {
                view.restart();
            }
            if (this._btnPause) this._btnPause.setText('暂停');
        }
        if (next === GameState.PAUSED && this._btnPause) {
            this._btnPause.setText('继续');
        }

        console.log(`[GameSession] ${prev} -> ${next}`);
    }

    private _setOverlayContent(title: string, sub: string, mainBtnText: string, showSecondary: boolean) {
        if (this._menuTitle) {
            this._menuTitle.string = title;
            this._menuTitle.color = UI.menuTitle;
        }
        if (this._menuSub) {
            this._menuSub.string = sub;
            this._menuSub.color = UI.menuSub;
        }
        if (this._menuBtn) this._menuBtn.setText(mainBtnText);
        if (this._menuBtn2) this._menuBtn2.node.active = showSecondary;
    }

    // ==================================================================
    // 每帧
    // ==================================================================
    update(dt: number) {
        this._fsm.update(dt);
    }

    // ==================================================================
    // 供输入层调用
    // ==================================================================
    /** 键盘空格 / 触摸暂停键 */
    public requestTogglePause() {
        this._togglePause();
    }

    /** 键盘 R：在非暂停状态下重开 */
    public requestRestart() {
        if (this._fsm.is(GameState.PAUSED)) return;
        if (this._fsm.is(GameState.PLAYING) || this._fsm.is(GameState.GAME_OVER)) {
            this._fsm.go(GameState.PLAYING);
        }
    }

    /** 键盘 M */
    public requestToggleMute() {
        this._toggleMute();
    }

    /** 键盘 Esc：回主菜单 */
    public requestMenu() {
        if (this._fsm.is(GameState.PAUSED)) {
            this._fsm.go(GameState.MENU);
        }
    }

    public get state(): GameState {
        return this._fsm.state;
    }

    /** 是否允许方向输入（只有真正在玩的时候） */
    public get acceptsDirectionInput(): boolean {
        return this._fsm.is(GameState.PLAYING);
    }

    /** 供渲染层广播「本局结束」 -> 状态机切到 GAME_OVER */
    public notifyGameOver() {
        this._fsm.go(GameState.GAME_OVER);
    }
}
