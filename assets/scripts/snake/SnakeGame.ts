import { _decorator, Component, Node, EventKeyboard, EventTouch, Input, input, KeyCode, Vec2, view, screen, sys, Canvas, ResolutionPolicy, director, Director } from 'cc';
import { SnakeView } from './SnakeView';
import { SnakeAudio } from './SnakeAudio';
import { GameSession } from './GameSession';
import { Platform } from './Platform';
import { DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT, Dir } from './SnakeCore';

const { ccclass, property } = _decorator;

const DESIGN_W = 720;
const DESIGN_H = 1280;

/**
 * SnakeGame —— 输入层与总装配（唯一需要手动挂到 Canvas 上的组件）
 *
 * 操作：
 *   W A S D / 方向键  转向（仅游戏中生效）
 *   R                 重开
 *   空格 / Esc        暂停·继续 / 回主菜单
 *   M                 静音切换
 *   滑动屏幕          转向
 *   屏幕上的按钮       静音 / 暂停 / 菜单 / 开始 / 再来一局
 *
 * 【一个必须记住的引擎生命周期事实】
 *   `addComponent()` 返回后，该组件的 `onLoad` **不会立刻执行** ——
 *   它要等本帧稍后的激活阶段。而 `getComponent()` 只返回**已经加载**的组件。
 *
 *   所以：在 A 的 onLoad 里 addComponent(B)，然后在同一个 onLoad 里
 *   getComponent(B) 会拿到 **null**！
 *
 *   本组件最初就踩了这个坑：Session.bind() 在 onLoad 里拿不到 SnakeView，
 *   直接 return，导致状态机从未启动 -> 游戏没冻结（蛇立刻开始跑）、
 *   输入层因状态不是 PLAYING 而拒绝所有按键。
 *
 *   解决办法：所有「跨组件接线」都推迟到第一帧 update 里做（见 _tryBind）。
 */
@ccclass('SnakeGame')
export class SnakeGame extends Component {

    @property({ tooltip: '滑动判定的最小位移（像素）' })
    public swipeThreshold = 24;

    @property({ tooltip: '是否启用音效' })
    public enableAudio = true;

    /**
     * 是否在运行时再强制一次竖屏设计分辨率。
     *
     * 【为什么默认关掉】
     *   竖屏的正确配置位置是**工程设置**（`settings/v2/packages/project.json`
     *   的 `general.designResolution`），而不是运行时代码。
     *   实测：在浏览器预览里调用 `view.setDesignResolutionSize()` 未必生效
     *   （预览容器有自己的尺寸策略），日志里会看到设计分辨率仍是 720x405。
     *
     *   所以真正的竖屏由工程设置保证；本开关只在个别平台需要额外兜底时才打开。
     */
    @property({ tooltip: '运行时再强制一次竖屏分辨率（一般不需要，竖屏应配在工程设置里）' })
    public forcePortrait = false;

    @property({ tooltip: '跳过主菜单直接开始（调试用）' })
    public skipMenu = false;

    private _view: SnakeView | null = null;
    private _audio: SnakeAudio | null = null;
    private _session: GameSession | null = null;

    /** 是否已完成接线 */
    private _bound = false;
    /** 接线重试计数（用于超时告警与日志） */
    private _bindRetries = 0;
    /** 音频延后到用户手势后初始化（浏览器自动播放限制） */
    private _audioPending = false;

    private _touchStart: Vec2 = new Vec2();
    private _touchActive = false;

    onLoad() {
        // ---------- ① 屏幕适配 ----------
        this._applyDesignResolution();

        // 打印平台信息 —— 这是排查"到底跑在 Web 还是抖音"的第一手依据。
        // 小游戏平台上很多问题（存储/音频/触摸）都与平台相关，先确认平台再谈别的。
        console.log('[SnakeGame] ' + Platform.describe());

        // 屏幕尺寸/方向变化时重新适配并重建布局。
        // 3.8 起用 screen.on 监听（view.setResizeCallback 已废弃）。
        // 开发时在浏览器 DevTools 里切换设备，走的就是这个事件。
        screen.on('window-resize', this._onScreenResize, this);
        screen.on('orientation-change', this._onScreenResize, this);

        // ---------- ② 校验挂载位置 ----------
        const canvas = this.node.getComponent(Canvas);
        if (!canvas) {
            const parent = this.node.parent;
            if (!(parent && parent.getComponent(Canvas))) {
                console.warn('[SnakeGame] 建议把它挂在 Canvas 节点上，否则可能不被渲染');
            }
        }

        // ---------- ③ 装配（顺序很重要，见类注释） ----------
        // GameSession 先挂：它的 onLoad 最先跑，可以先建好界面
        this._session = this.node.getComponent(GameSession);
        if (!this._session) this._session = this.node.addComponent(GameSession);
        this._session.skipMenu = this.skipMenu;

        // SnakeView 最后挂：它的 onLoad 最后跑，此时界面已就绪
        this._view = this.node.getComponent(SnakeView);
        if (!this._view) this._view = this.node.addComponent(SnakeView);

        // 让 Session 在用户手势时回调本组件以解锁音频
        this._session.onUserGesture = () => this._unlockAudio();

        // ---------- ④ 输入监听 ----------
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);

        // 注意：音频与状态机的接线**不在这里做**，见 update() 里的 _tryBind
        this._audioPending = this.enableAudio;

        console.log('[SnakeGame] 已启动 | 触摸或键盘操作');
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        screen.off('window-resize', this._onScreenResize, this);
        screen.off('orientation-change', this._onScreenResize, this);
    }

    private _applyDesignResolution() {
        if (!this.forcePortrait) return;
        try {
            view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);
        } catch (e) {
            console.warn('[SnakeGame] 设置设计分辨率失败:', e);
        }
        this._logSafeArea();
    }

    /**
     * 接线：每帧尝试，直到成功为止（不静默失败）。
     *
     * 为什么需要重试而不是只试一次：
     *   组件可能是本组件在运行时 addComponent 挂上的，而 addComponent 之后
     *   对方的 onLoad 要等本帧稍后的激活阶段才执行 —— 在同一个 onLoad 里
     *   getComponent 拿不到它。等到下一帧虽然通常就绪，但不同启动路径
     *   （手动挂载 / 自动挂载 / 热重载）时序并不完全一致。
     *
     *   与其赌「第一帧一定就绪」，不如老老实实重试到成功 ——
     *   这比依赖精确时序可靠得多，而且失败会打日志，不会默默黑屏。
     */
    update(dt: number) {
        if (this._bound) return;

        const view = this.node.getComponent(SnakeView);
        if (!view) {
            this._bindRetries++;
            if (this._bindRetries > 120) {
                // 大约 2 秒还拿不到，说明不是时序问题，而是真的缺组件
                console.error('[SnakeGame] 等待 2 秒仍找不到 SnakeView，放弃接线。' +
                    '请检查 assets/scripts/snake/ 下的脚本是否编译通过。');
                this._bound = true;      // 停止刷屏
            }
            return;
        }
        this._view = view;

        // 把 Session 与 View 接起来。bind 自己会去取需要的组件，
        // 拿不到就返回 false，下一帧继续。
        if (this._session && !this._session.bind()) {
            return;
        }

        this._bound = true;
        console.log('[SnakeGame] 接线完成（第 %d 帧）', this._bindRetries + 1);
    }

    /** 首次用户手势：创建音频并把 AudioContext 解锁 */
    private _unlockAudio() {
        if (!this.enableAudio || this._audio) return;
        this._audioPending = false;
        this._audio = this.node.getComponent(SnakeAudio);
        if (!this._audio) this._audio = this.node.addComponent(SnakeAudio);
        if (this._view) this._audio.bind(this._view);
        // 同步静音按钮外观（音频可能比界面晚就绪）
        if (this._session) this._session.syncAudioState();
    }

    /** 屏幕尺寸/方向变化：重新适配分辨率并让界面按新尺寸重建 */
    private _onScreenResize() {
        this._applyDesignResolution();
        if (this._session && this._session.state) {
            // 重建界面：布局、按钮位置、覆盖层尺寸都会随之更新
            if (this._view) this._view.rebuildForResize();
            this._session.rebuildForResize();
        }
    }

    /**
     * 打印安全区信息，方便真机上核对 HUD 有没有被刘海压住。
     * 注意：安全区 API 在 sys 命名空间上（不是 screen）。
     */
    private _logSafeArea() {
        try {
            const visible = view.getVisibleSize();
            const sa = sys.getSafeAreaRect();
            if (!sa || sa.width <= 0 || sa.height <= 0) return;
            const topInset = (sa.y + sa.height) - visible.height / 2;
            const bottomInset = -(sa.y - visible.height / 2);
            console.log(
                `[SnakeGame] 设计分辨率 ${visible.width.toFixed(0)}x${visible.height.toFixed(0)}` +
                ` | 安全区 ${sa.width.toFixed(0)}x${sa.height.toFixed(0)}` +
                ` | 内边距 上${topInset.toFixed(0)} 下${bottomInset.toFixed(0)}`);
        } catch (e) {
            console.warn('[SnakeGame] 读取安全区失败（不影响游戏）:', e);
        }
    }

    // ==================================================================
    // 键盘
    // ==================================================================
    private _onKeyDown(e: EventKeyboard) {
        // 首次按键也算用户手势，同样可以解锁音频
        this._unlockAudio();

        const s = this._session;

        switch (e.keyCode) {
            case KeyCode.KEY_W:
            case KeyCode.ARROW_UP:
                this._pushDirection(DIR_UP); break;
            case KeyCode.KEY_S:
            case KeyCode.ARROW_DOWN:
                this._pushDirection(DIR_DOWN); break;
            case KeyCode.KEY_A:
            case KeyCode.ARROW_LEFT:
                this._pushDirection(DIR_LEFT); break;
            case KeyCode.KEY_D:
            case KeyCode.ARROW_RIGHT:
                this._pushDirection(DIR_RIGHT); break;

            case KeyCode.KEY_R:
                if (s) s.requestRestart();
                break;
            case KeyCode.SPACE:
                if (s) s.requestTogglePause();
                break;
            case KeyCode.KEY_M:
                if (s) s.requestToggleMute();
                break;
            case KeyCode.ESCAPE:
                if (s) s.requestMenu();
                break;
            default:
                break;
        }
    }

    /**
     * 把方向写进逻辑层缓冲，并通知渲染层「本步已收到新输入」。
     *
     * 两件重要的事：
     *   1. **立即**写入，不攒到下一帧 —— 攒一帧就多 16ms 延迟，手感上能感知。
     *   2. 只在游戏中接受方向输入。菜单里按方向键不应该让蛇转向。
     */
    private _pushDirection(d: Dir) {
        const s = this._session;
        const v = this._view;
        if (!v) return;

        // 非游戏状态：方向键用来在菜单里做不了什么，直接忽略
        if (s && !s.acceptsDirectionInput) return;

        if (v.core.requestDir(d)) {
            v.notifyDirectionInput();
        }
    }

    // ==================================================================
    // 触屏 / 鼠标滑动
    // ==================================================================
    private _onTouchStart(e: EventTouch) {
        // 首次触摸：解锁音频（浏览器/移动端要求音频必须由用户手势触发）
        this._unlockAudio();

        const p = e.getUILocation();
        this._touchStart.set(p.x, p.y);
        this._touchActive = true;
    }

    private _onTouchEnd(e: EventTouch) {
        if (!this._touchActive) return;
        this._touchActive = false;

        const s = this._session;
        // 只在游戏中响应滑动转向。
        // 否则在菜单里滑动会往缓冲里塞方向，玩家点「开始」的瞬间蛇就自己拐弯了。
        if (s && !s.acceptsDirectionInput) return;

        const p = e.getUILocation();
        const dx = p.x - this._touchStart.x;
        const dy = p.y - this._touchStart.y;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);

        if (Math.max(ax, ay) < this.swipeThreshold) return;   // 位移太小，当点击忽略

        // 取主轴方向 —— 同样立刻生效，不等下一帧
        if (ax > ay) {
            this._pushDirection(dx > 0 ? DIR_RIGHT : DIR_LEFT);
        } else {
            this._pushDirection(dy > 0 ? DIR_UP : DIR_DOWN);
        }
    }
}

// ======================================================================
// 零配置自启动
//
// 【为什么需要它】
//   本组件需要挂在 Canvas 节点上，也就是要在 main.scene 里存一条组件引用。
//   但实践下来这条引用**反复丢失**：编辑器会用内存里的场景覆盖磁盘，
//   把我们在文件里写的内容抹掉。表现出来就是「黑屏 + Console 什么都没有」——
//   因为这个组件根本没实例化，一行日志都不会有。
//
// 【做法】
//   在脚本模块里注册一个「场景启动完成」监听（模块级代码，不依赖任何组件）。
//   Cocos 启动时会执行项目里所有用户脚本（@ccclass 注册就靠这个机制），
//   所以这段代码一定会被执行；用 once 避免多次触发。
//
//   这样即使场景里没有任何引用，游戏也能跑起来。
//   注意：只创建**一个**节点，且必须先确认场景里确实没有手动挂的实例，
//   否则会出现两个游戏实例互相打架。
// ======================================================================
let _autoBootDone = false;

function autoBootScan(scene: any) {
    if (_autoBootDone || !scene) return;

    // 场景里已经有手动挂的 → 尊重它，不重复创建
    const stack: any[] = (scene.children || []).slice();
    let canvasNode: any = null;
    while (stack.length) {
        const n = stack.pop();
        if (!n) continue;
        if (n.getComponent && n.getComponent(SnakeGame)) {
            _autoBootDone = true;
            return;
        }
        if (!canvasNode && n.getComponent && n.getComponent(Canvas)) canvasNode = n;
        if (n.children && n.children.length) stack.push.apply(stack, n.children);
    }
    if (!canvasNode) return;

    const node = new Node('SnakeGame');
    node.layer = canvasNode.layer;      // 继承 UI_2D 层，否则相机看不见
    canvasNode.addChild(node);
    node.setPosition(0, 0, 0);
    node.addComponent(SnakeGame);

    _autoBootDone = true;
    console.log('[AutoBoot] 场景里没有 SnakeGame 组件，已自动创建（无需手动挂载）');
}

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
    autoBootScan(director.getScene());
});

// 兜底：万一模块执行时机晚于场景启动事件（不同版本/平台的启动顺序可能有差异），
// 这一次性定时器仍能补上。scheduleOnce 不带组件也能用（走全局调度器），
// 不受「组件实例是否存在」的影响。重复调用是安全的 —— autoBootScan 有 _autoBootDone 守卫。
director.once(Director.EVENT_BEFORE_UPDATE, () => {
    autoBootScan(director.getScene());
});
