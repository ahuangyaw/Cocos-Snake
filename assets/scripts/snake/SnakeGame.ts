import { _decorator, Component, EventKeyboard, EventTouch, Input, input, KeyCode, Vec2, view, sys, Canvas, ResolutionPolicy } from 'cc';
import { SnakeView } from './SnakeView';
import { SnakeAudio } from './SnakeAudio';
import { GameSession } from './GameSession';
import { DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT, Dir } from './SnakeCore';

const { ccclass, property } = _decorator;

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
 * 【组件挂载顺序是刻意设计的】
 *   本组件按 GameSession -> SnakeAudio -> SnakeView 的顺序 addComponent。
 *   Cocos 按 _components 数组顺序调用 onLoad，所以：
 *     - GameSession 最先 onLoad，可以安全地先建好界面
 *     - SnakeView 最后 onLoad，此时它的引用与界面都已就绪
 *   最后由本组件调用 session.bind() 正式启动状态机。
 *
 *   这个顺序不是巧合 —— 引擎里「谁先初始化」是最常见的隐性 bug 来源，
 *   所以把它显式化，而不是听天由命。
 */
@ccclass('SnakeGame')
export class SnakeGame extends Component {

    @property({ tooltip: '滑动判定的最小位移（像素）' })
    public swipeThreshold = 24;

    @property({ tooltip: '是否启用音效' })
    public enableAudio = true;

    /**
     * 竖屏设计分辨率。
     * FIXED_WIDTH：宽度永远铺满屏幕，高度按设备比例自适应。
     */
    @property({ tooltip: '强制竖屏设计分辨率（抖音小游戏需要）' })
    public forcePortrait = true;

    @property({ tooltip: '跳过主菜单直接开始（调试用）' })
    public skipMenu = false;

    private _view: SnakeView | null = null;
    private _audio: SnakeAudio | null = null;
    private _session: GameSession | null = null;

    private _touchStart: Vec2 = new Vec2();
    private _touchActive = false;

    onLoad() {
        // ---------- ① 屏幕适配（必须在构建界面之前） ----------
        if (this.forcePortrait) {
            view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
        }
        this._logSafeArea();

        // ---------- ② 校验挂载位置 ----------
        const canvas = this.node.getComponent(Canvas);
        if (!canvas) {
            const parent = this.node.parent;
            if (!(parent && parent.getComponent(Canvas))) {
                console.warn('[SnakeGame] 建议把它挂在 Canvas 节点上，否则可能不被渲染');
            }
        }

        // ---------- ③ 装配（顺序见类注释） ----------
        this._session = this.node.getComponent(GameSession);
        if (!this._session) this._session = this.node.addComponent(GameSession);
        this._session.skipMenu = this.skipMenu;

        if (this.enableAudio) {
            this._audio = this.node.getComponent(SnakeAudio);
            if (!this._audio) this._audio = this.node.addComponent(SnakeAudio);
        }

        this._view = this.node.getComponent(SnakeView);
        if (!this._view) this._view = this.node.addComponent(SnakeView);

        // 音频订阅渲染层的事件（音频层不知道玩法，渲染层不知道声音）
        if (this._audio) this._audio.bind(this._view);

        // ---------- ④ 启动状态机（所有组件已就绪） ----------
        this._session.bind();

        // ---------- ⑤ 输入监听 ----------
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);

        console.log('[SnakeGame] 已启动 | 触摸或键盘操作');
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
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
