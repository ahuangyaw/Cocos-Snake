import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, Vec3, randomRange } from 'cc';
import { PlayerController } from './PlayerController';

const { ccclass, property } = _decorator;

/**
 * CollectibleField —— 收集物系统
 *
 * 职责：
 *   1. 按固定间隔生成「宝石」节点（从对象池复用，不频繁 new/destroy）
 *   2. 每帧让宝石下落
 *   3. 用「距离平方」做碰撞判定
 *   4. 命中后回调 GameSession 加分
 *
 * 这里有一个必须掌握的性能常识：
 *   频繁 new Node / destroy Node 会造成内存抖动和帧率尖刺。
 *   正确做法是「对象池」——用完不销毁，回收起来下次复用。
 */
@ccclass('CollectibleField')
export class CollectibleField extends Component {

    @property({ tooltip: '宝石贴图' })
    public dotSpriteFrame: SpriteFrame | null = null;

    @property({ tooltip: '生成间隔（秒）' })
    public spawnInterval = 0.55;

    @property({ tooltip: '下落速度（像素/秒）' })
    public fallSpeed = 130;

    @property({ tooltip: '宝石显示尺寸（像素）' })
    public dotSize = 34;

    @property({ tooltip: '与玩家的命中半径（像素）' })
    public hitRadius = 34;

    /** 由 GameSession 在 start 时注入，避免组件之间硬编码查找 */
    public player: PlayerController | null = null;
    public onCollected: ((score: number) => void) | null = null;

    private _container: Node | null = null;
    private readonly _active: Node[] = [];
    private readonly _pool: Node[] = [];
    private _timer = 0;
    private _running = false;
    private _spawnHalfX = 440;
    private _spawnTopY = 360;
    private _spawnBottomY = -380;

    onLoad() {
        this._container = this.node.getChildByName('Dots');
        if (!this._container) {
            this._container = new Node('Dots');
            this._container.layer = this.node.layer;
            this.node.addChild(this._container);
        }
    }

    /** 由 GameSession 调用：设定活动范围并开始生成 */
    public begin(halfX: number, topY: number, bottomY: number) {
        this._resolvePlayer();
        this._spawnHalfX = halfX;
        this._spawnTopY = topY;
        this._spawnBottomY = bottomY;
        this._running = true;
        this._timer = 0;
    }

    /**
     * 惰性解析玩家引用。
     *
     * 为什么不用「谁先初始化」来约定：
     *   本组件可能由 GameBootstrap 在运行时 addComponent 挂上，
     *   那时外部还没机会给 player 赋值。与其依赖初始化顺序（脆弱、难查），
     *   不如在自己真正需要时去取 —— 这叫「惰性解析」，是消除顺序耦合的常用手段。
     */
    private _resolvePlayer() {
        if (this.player) return;
        const parent = this.node.parent;
        if (parent) {
            this.player = parent.getComponent(PlayerController);
        }
        if (!this.player) {
            console.warn('[CollectibleField] 没有找到 PlayerController，' +
                '碰撞判定会以坐标原点为中心进行');
        }
    }

    public halt() {
        this._running = false;
    }

    /** 从池里取一个节点；池空了才创建新的 */
    private _obtain(): Node {
        const recycled = this._pool.pop();
        if (recycled) {
            recycled.active = true;
            this._ensureDotSprite(recycled);   // 贴图可能是后注入的，这里补渲染组件
            return recycled;
        }
        const dot = new Node('Dot');
        dot.layer = this.node.layer;
        if (this._container) this._container.addChild(dot);
        this._ensureDotSprite(dot);
        return dot;
    }

    /** 幂等地给宝石节点补上 Sprite（贴图由 GameBootstrap 注入，可能晚于本组件的 onLoad） */
    private _ensureDotSprite(dot: Node) {
        if (!this.dotSpriteFrame || dot.getComponent(Sprite)) return;
        const sp = dot.addComponent(Sprite);
        sp.spriteFrame = this.dotSpriteFrame;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const ui = dot.getComponent(UITransform);
        if (ui) ui.setContentSize(this.dotSize, this.dotSize);
    }

    private _spawn() {
        const dot = this._obtain();
        dot.setPosition(randomRange(-this._spawnHalfX, this._spawnHalfX), this._spawnTopY, 0);
        this._active.push(dot);
    }

    /** 回收：移出活动列表 + 放回池子（不销毁） */
    private _recycle(index: number) {
        const dot = this._active[index];
        this._active.splice(index, 1);
        dot.active = false;
        this._pool.push(dot);
    }

    update(dt: number) {
        if (!this._running) return;

        // ---- 生成 ----
        this._timer += dt;
        while (this._timer >= this.spawnInterval) {
            this._timer -= this.spawnInterval;   // 用减法而不是清零：低帧率下不会丢生成
            this._spawn();
        }

        // ---- 移动 + 碰撞（倒序遍历，因为循环里会 splice 删除元素）----
        this._resolvePlayer();          // 已解析时立即返回，开销可忽略
        const player = this.player;
        const px = player ? player.node.position.x : 0;
        const py = player ? player.node.position.y : 0;
        const hitSq = this.hitRadius * this.hitRadius;

        for (let i = this._active.length - 1; i >= 0; i--) {
            const dot = this._active[i];
            const dx = dot.position.x - px;
            const dy = dot.position.y - py;

            // 开方很贵，只比较平方值：性能优化里最常用的一招
            if (dx * dx + dy * dy <= hitSq) {
                this._recycle(i);
                if (this.onCollected) this.onCollected(1);
                continue;
            }

            const nextY = dot.position.y - this.fallSpeed * dt;
            if (nextY < this._spawnBottomY) {
                this._recycle(i);
                continue;
            }
            dot.setPosition(dot.position.x, nextY, 0);
        }
    }

    /** 便于调试：当前活动宝石数量与池大小 */
    public get stats(): { active: number; pooled: number } {
        return { active: this._active.length, pooled: this._pool.length };
    }
}
