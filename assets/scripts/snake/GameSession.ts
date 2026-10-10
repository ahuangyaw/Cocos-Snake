import { _decorator, Component, Node, Label, Color, Graphics, view, sys, HorizontalTextAlignment, UITransform } from 'cc';
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
    /** 覆盖层遮罩，resize 时需要重画尺寸 */
    private _dimG: Graphics | null = null;
    /** 常驻按钮与菜单按钮的引用，resize 时重新定位 */
    private _persistentBtns: ButtonHandle[] = [];

    // ==================================================================
    // 生命周期
    // ==================================================================
    onLoad() {
        const visible = view.getVisibleSize();
        this._vw = visible.width;
        this._vh = visible.height;

        // 注意：这里**不要**去抢 SnakeView / SnakeAudio 的引用。
        // 本组件可能是被 SnakeGame 运行时 addComponent 挂上的，
        // 那一刻它们还没挂上，缓存下来的就是 null 且永远不会更新。
        // 正确做法是在 bind() 里现取（见 bind 的说明）。

        this._fsm.onChange = (next, prev) => this._onStateChanged(next, prev);
        this._fsm.onIllegal = (from, to) => {
            // 非法切换说明逻辑写错了 —— 开发期必须看得见
            console.warn(`[GameSession] 非法状态切换被拒绝: ${from} -> ${to}`);
        };

        this._buildPersistentButtons();
        this._buildOverlay();
        this._applyLayout();

        // 初始状态先不设，等 bind() 成功后再推进 ——
        // 那时 SnakeView 才存在，读 score / 控制 simulate 才安全。
    }

    /**
     * 由 SnakeGame 调用（会重复调用直到成功）。
     *
     * 【为什么必须自己去 getComponent，而不是用 onLoad 时缓存的引用】
     *   本组件可能是被 SnakeGame 在运行时 addComponent 挂上的。
     *   那一刻 SnakeView 还没被挂上，所以 onLoad 里
     *   `this.node.getComponent(SnakeView)` 拿到的是 **null**，
     *   缓存在 this._view 里就一直是个过期的 null ——
     *   bind() 拿着它必然失败。
     *
     *   教训：**不要缓存「在初始化阶段还拿不到的东西」**。
     *   要么每次都重新取，要么明确地在就绪后再取。
     *
     * 返回值表示是否接线成功，失败时 SnakeGame 会在下一帧重试。
     */
    public bind(): boolean {
        // 每次都重新取，绝不用可能过期的缓存
        const view = this.node.getComponent(SnakeView);
        if (!view) {
            return false;      // 还没就绪，交给调用方重试
        }
        this._view = view;

        // 音频同样重新取（它可能是首次手势后才挂上的）
        if (!this._audio) this._audio = this.node.getComponent(SnakeAudio);

        // 渲染层广播「本局结束」-> 状态机切到 GAME_OVER。
        // 注意方向是单向的：SnakeView 只知道"我死了"，不知道状态机怎么处理。
        view.onGameOver = () => this.notifyGameOver();

        // 同步一次静音按钮外观
        if (this._audio) this._syncMuteButton(this._audio.muted);

        // 现在 SnakeView 已就绪，用它的布局结果重新定位按钮。
        // onLoad 时 SnakeView 可能还不存在，那时用的是兜底尺寸。
        this._applyLayout();

        // 首次成功接线时才启动状态机
        if (this._fsm.is(GameState.BOOT)) {
            this._fsm.go(this.skipMenu ? GameState.PLAYING : GameState.MENU);
        }
        return true;
    }

    // ==================================================================
    // 布局：位置全部从 _applyLayout 设置，resize 时复用同一套逻辑
    // ==================================================================
    private _applyLayout() {
        // 布局的唯一来源是 SnakeView.layout（由 layout.ts 的纯函数算出，有单测）。
        // 这里只做「把结果套到节点上」，不自己算坐标。
        const view0 = this._view || this.node.getComponent(SnakeView);
        const visible = view.getVisibleSize();

        if (!view0) {
            // SnakeView 还没就绪（接线阶段），先用可视尺寸兜底，
            // 等 bind() 成功后会再调一次 _applyLayout
            this._vw = visible.width;
            this._vh = visible.height;
            return;
        }
        const L = view0.layout;
        this._vw = L.vw;
        this._vh = L.vh;

        // ---- 常驻按钮：位置与尺寸都来自布局 ----
        if (this._btnMenu) {
            this._btnMenu.node.setPosition(L.hudMenuX, L.hudMenuY, 0);
        }
        if (this._btnMute) this._btnMute.node.setPosition(L.hudMuteX, L.hudTopBtnY, 0);
        if (this._btnPause) this._btnPause.node.setPosition(L.hudPauseX, L.hudTopBtnY, 0);

        // ---- 覆盖层铺满整屏 ----
        if (this._overlayRoot) {
            const ui = this._overlayRoot.getComponent(UITransform);
            if (ui) ui.setContentSize(this._vw, this._vh);
        }
        if (this._dimG) {
            this._dimG.clear();
            this._dimG.fillColor = new Color(6, 10, 18, 214);
            this._dimG.rect(-this._vw, -this._vh, this._vw * 2, this._vh * 2);
            this._dimG.fill();
        }

        // ---- 覆盖层内容：标题在上、按钮在下，都排布在安全区内 ----
        // 注意棋盘中心是向右偏的（左侧让给了按钮），覆盖层文字以屏幕中心为准更协调。
        const titleY = this._vh / 2 - 300;
        if (this._menuTitle) {
            this._menuTitle.node.setPosition(0, titleY, 0);
            const ui = this._menuTitle.node.getComponent(UITransform);
            if (ui) ui.setContentSize(this._vw, 80);
        }
        if (this._menuSub) {
            this._menuSub.node.setPosition(0, titleY - 72, 0);
            const ui = this._menuSub.node.getComponent(UITransform);
            if (ui) ui.setContentSize(this._vw, 40);
        }
        if (this._menuBtn) this._menuBtn.node.setPosition(0, -this._vh / 2 + 300, 0);
        if (this._menuBtn2) this._menuBtn2.node.setPosition(0, -this._vh / 2 + 206, 0);
    }

    /** 屏幕尺寸/方向变化时重新定位（与 SnakeView.rebuildForResize 配合） */
    public rebuildForResize() {
        this._applyLayout();
    }

    /** 由 SnakeGame 在音频就绪后调用，同步一次静音按钮外观 */
    public syncAudioState() {
        if (this._audio) this._syncMuteButton(this._audio.muted);
    }

    // ==================================================================
    // 构建：常驻按钮（静音 / 暂停 / 菜单）
    // ==================================================================
    private _buildPersistentButtons() {
        // 尺寸先给占位值，真实位置与尺寸由 _applyLayout 从布局结果设置。
        // 这里刻意不在构建时算坐标 —— 那时 SnakeView 可能还没就绪。
        // 文字一律用纯文本，不用 emoji（Canvas 字体缺字形会渲染成空白）。
        const h = 40;
        const w = 74;

        this._btnMute = makeButton('BtnMute', this.node, 0, 0, w, h,
            '音效', 18, () => this._toggleMute());

        this._btnPause = makeButton('BtnPause', this.node, 0, 0, w, h,
            '暂停', 18, () => this._togglePause());

        this._btnMenu = makeButton('BtnMenu', this.node, 0, 0, w, h,
            '菜单', 18, () => this._backToMenu());

        this._persistentBtns = [this._btnMute, this._btnPause, this._btnMenu];
    }

    private _toggleMute() {
        // 点静音也算用户手势（首次点击时应在这里初始化音频）
        if (this.onUserGesture) this.onUserGesture();

        if (!this._audio) {
            // 音频仍不可用：说明解锁失败（例如平台限制），给出明确提示而不是静默失败
            console.warn('[GameSession] 音频组件不可用，静音按钮无效');
            return;
        }
        const muted = this._audio.toggleMute();
        this._syncMuteButton(muted);
    }

    /**
     * 静音按钮外观与实际状态同步。
     *
     * 注意：用**纯文字**而不是 emoji。
     * Canvas 的系统字体通常没有 emoji 字形，`🔊` 会直接渲染成空白 ——
     * 这个坑真实踩过（按钮看起来是空的）。跨平台可靠的图标要么用贴图，
     * 要么用文字，要么用 Graphics 自己画。
     */
    private _syncMuteButton(muted: boolean) {
        if (!this._btnMute) return;
        this._btnMute.setText(muted ? '静音中' : '音效');
        this._btnMute.setOn(muted);
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

        this._dimG = makeDimOverlay('Dim', root, this._vw, this._vh, 214);

        // 标题与副标题（不同状态换文字，所以只创建一次；位置由 _applyLayout 设置）
        this._menuTitle = makeLabel('MenuTitle', root, 0, 0, 62,
            UI.menuTitle, HorizontalTextAlignment.CENTER, this._vw);
        this._menuSub = makeLabel('MenuSub', root, 0, 0, 20,
            UI.menuSub, HorizontalTextAlignment.CENTER, this._vw);

        // 主按钮（菜单里是「开始游戏」，结束时是「再来一局」）
        this._menuBtn = makeButton('MenuBtnMain', root, 0, 0, 260, 74,
            '开始游戏', 30, () => this._onMainAction(), STYLE_PRIMARY);

        // 次按钮：菜单里隐藏；结束时用来「返回主菜单」
        this._menuBtn2 = makeButton('MenuBtnSecondary', root, 0, 0, 200, 56,
            '返回主菜单', 20, () => this._fsm.go(GameState.MENU), STYLE_DEFAULT);
    }

    /** 主按钮的行为随状态变化：菜单里是「开始」，结束时是「再来一局」 */
    private _onMainAction() {
        // 点击也是用户手势 —— 音频解锁挂在 SnakeGame 上，这里通过回调通知它
        if (this.onUserGesture) this.onUserGesture();
        this._fsm.go(GameState.PLAYING);
    }

    /** 由 SnakeGame 注入：任何用户手势发生时调用（用于解锁音频） */
    public onUserGesture: (() => void) | null = null;

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
