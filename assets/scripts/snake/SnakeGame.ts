import { _decorator, Component, Node, EventKeyboard, EventTouch, Input, input, KeyCode, Vec2, view, director, Director, Canvas } from 'cc';
import { SnakeView } from './SnakeView';
import { DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT, Dir } from './SnakeCore';

const { ccclass, property } = _decorator;

/**
 * SnakeGame —— 输入层与总装配
 *
 * 操作：
 *   W A S D / 方向键  转向
 *   R                 重开
 *   空格              暂停 / 继续
 *   鼠标拖拽 / 触屏滑动  转向（为抖音小游戏准备的触屏方案）
 *
 * 输入设计要点：
 *   1. 键盘按下即记录「待执行方向」，在 update 里交给核心的**输入缓冲队列**，
 *      而不是直接改方向 —— 这样快速连按两次（比如向上时按左再按下）不会丢输入。
 *   2. 触屏用「起点→终点」位移量判定滑动方向，阈值可调。
 *   3. 所有监听在 onDestroy 里成对解绑，避免场景切换后回调指向已销毁节点。
 */
@ccclass('SnakeGame')
export class SnakeGame extends Component {

    @property({ tooltip: '滑动判定的最小位移（像素）' })
    public swipeThreshold = 24;

    private _view: SnakeView | null = null;
    private _pending: Dir | null = null;

    private _touchStart: Vec2 = new Vec2();
    private _touchActive = false;

    onLoad() {
        // 挂到 Canvas 之下，保证处于 2D 渲染根内
        const canvas = this.node.getComponent(Canvas);
        if (!canvas) {
            const parent = this.node.parent;
            if (parent && parent.getComponent(Canvas)) {
                // 已经在一个 Canvas 之下，位置也正确
            } else {
                console.warn('[SnakeGame] 建议把它挂在 Canvas 节点上，否则可能不被渲染');
            }
        }

        this._view = this.node.getComponent(SnakeView);
        if (!this._view) this._view = this.node.addComponent(SnakeView);

        this._view.setDirectionProvider(() => {
            const d = this._pending;
            this._pending = null;      // 取走即清空：每帧最多消费一次
            return d;
        });

        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);

        console.log('[SnakeGame] 已启动 | WASD/方向键 转向 · R 重开 · 空格 暂停 · 触屏滑动也可');
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
    }

    // ------------------------------------------------------------------
    // 键盘
    // ------------------------------------------------------------------
    private _onKeyDown(e: EventKeyboard) {
        // 输入立刻交给逻辑层的缓冲队列 —— 不要攒到下一帧的 update 里再传。
        // 攒一帧就多 16ms 延迟，操作手感上这是能感知的。
        // 队列自带「反向拒绝 / 同向忽略 / 上限 2」的保护，所以立即调用是安全的。
        const v = this._view;
        switch (e.keyCode) {
            case KeyCode.KEY_W:
            case KeyCode.ARROW_UP:
                this._push(DIR_UP); break;
            case KeyCode.KEY_S:
            case KeyCode.ARROW_DOWN:
                this._push(DIR_DOWN); break;
            case KeyCode.KEY_A:
            case KeyCode.ARROW_LEFT:
                this._push(DIR_LEFT); break;
            case KeyCode.KEY_D:
            case KeyCode.ARROW_RIGHT:
                this._push(DIR_RIGHT); break;
            case KeyCode.KEY_R:
                if (v) { v.restart(); console.log('[SnakeGame] 重开'); }
                break;
            case KeyCode.SPACE:
                if (v) {
                    v.setPaused(!v.paused);
                    console.log('[SnakeGame]', v.paused ? '暂停' : '继续');
                }
                break;
            default:
                break;
        }
    }

    /**
     * 把方向写进逻辑层缓冲，并通知渲染层「本步已收到新输入」。
     *
     * 通知渲染层是为了实现「临界点提前转身」：如果玩家在一步的后段才按方向，
     * 立刻结束这一步会让操作显得跟手（详见 SnakeView.notifyDirectionInput）。
     */
    private _push(d: Dir) {
        const v = this._view;
        if (!v || v.paused || !v.core.alive) {
            // 暂停或已死亡时仍然记录，等恢复后不丢操作
            this._pending = d;
            return;
        }
        if (v.core.requestDir(d)) {
            v.notifyDirectionInput();
        }
    }

    // ------------------------------------------------------------------
    // 触屏 / 鼠标滑动
    // ------------------------------------------------------------------
    private _onTouchStart(e: EventTouch) {
        const p = e.getUILocation();
        this._touchStart.set(p.x, p.y);
        this._touchActive = true;

        // 触屏时也支持"点一下即暂停/重开"的兜底：游戏结束状态下点击重开
        const v = this._view;
        if (v && !v.core.alive) {
            v.restart();
            this._touchActive = false;
        }
    }

    private _onTouchEnd(e: EventTouch) {
        if (!this._touchActive) return;
        this._touchActive = false;

        const p = e.getUILocation();
        const dx = p.x - this._touchStart.x;
        const dy = p.y - this._touchStart.y;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);

        if (Math.max(ax, ay) < this.swipeThreshold) return;   // 位移太小，当点击忽略

        // 取主轴方向 —— 同样立刻生效，不等下一帧
        if (ax > ay) {
            this._push(dx > 0 ? DIR_RIGHT : DIR_LEFT);
        } else {
            this._push(dy > 0 ? DIR_UP : DIR_DOWN);
        }
    }
}

// ======================================================================
// 零配置启动：不需要你手动往场景里挂组件
//
// 原理：监听「场景启动完成」事件，自动在 Canvas 下建一个节点并挂上 SnakeGame。
// 对于首次体验/做 demo，这能省掉所有编辑器操作；正式项目里删掉这段即可。
// ======================================================================
let _autoBooted = false;

function autoBoot() {
    if (_autoBooted) return;

    const scene = director.getScene();
    if (!scene) return;

    // 场景里已经手动挂了 SnakeGame？那就尊重手动配置，不重复创建
    let canvas: Node | null = null;
    const stack: Node[] = scene.children.slice();
    while (stack.length) {
        const n = stack.pop()!;
        if (n.getComponent(SnakeGame)) return;
        if (!canvas && n.getComponent(Canvas)) canvas = n;
        if (n.children.length) stack.push(...n.children);
    }
    if (!canvas) return;

    const node = new Node('SnakeGame');
    node.layer = canvas.layer;               // 继承 UI_2D 层
    canvas.addChild(node);
    node.setPosition(0, 0, 0);
    node.addComponent(SnakeGame);

    _autoBooted = true;
    console.log('[AutoBoot] 已在 Canvas 下自动创建 SnakeGame 节点');
}

director.on(Director.EVENT_AFTER_SCENE_LAUNCH, autoBoot);
