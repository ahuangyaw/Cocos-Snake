import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, EventKeyboard, Input, input, KeyCode, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * PlayerController —— 玩家操控组件
 *
 * 职责（单一职责原则，改需求时你应该只需要动一个文件）：
 *   1. 监听键盘输入，维护「当前按下了哪些键」的状态
 *   2. 每帧根据 dt 计算位移，做边界钳制
 *   3. 如果子节点不存在，自动创建自己的显示节点（这样场景文件可以极简）
 *
 * 不负责：收集物、计分、UI —— 那些分别由 CollectibleField / GameSession 管。
 */
@ccclass('PlayerController')
export class PlayerController extends Component {

    @property({ tooltip: '移动速度（像素/秒）' })
    public moveSpeed = 320;

    @property({ tooltip: '玩家贴图（留空则只做逻辑、不显示）' })
    public spriteFrame: SpriteFrame | null = null;

    @property({ tooltip: '显示节点尺寸（像素）' })
    public displaySize = 48;

    /** 活动区域半宽/半高，由 GameSession 依据设计分辨率写入 */
    public halfExtentX = 480;
    public halfExtentY = 320;

    @property({ tooltip: '允许在预览里用键盘操控（关掉则只能靠代码驱动）' })
    public enableKeyboard = true;

    private _spriteNode: Node | null = null;
    private readonly _pressed = new Set<number>();
    private readonly _pos = new Vec3();
    private readonly _dir = new Vec3();   // 复用一个向量，避免每帧 new（每帧分配 = 给 GC 添堵）
    private _halfW = 24;
    private _halfH = 24;

    onLoad() {
        // 先把输入接上（这一步不依赖贴图，可以立刻做）
        if (this.enableKeyboard) {
            input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
            input.on(Input.EventType.KEY_UP, this._onKeyUp, this);
        }
        // 贴图可能由 GameBootstrap 在运行时注入，注入时机晚于本 onLoad。
        // 所以显示节点的创建推迟一帧：此时配置一定已经写完 —— 用「晚一帧」换「顺序确定」。
        this.scheduleOnce(() => this._ensureBody(), 0);
    }

    onDestroy() {
        // 必须成对解绑，否则场景切换后回调仍指向已销毁的节点 —— 内存泄漏与空指针的经典来源
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    private _ensureBody() {
        if (!this._spriteNode) {
            this._spriteNode = this.node.getChildByName('Body');
        }
        if (!this._spriteNode) {
            this._spriteNode = this._createBody();
        }
        // 若贴图是后来才注入的，这里补上渲染组件
        if (this.spriteFrame && !this._spriteNode.getComponent(Sprite)) {
            this._applySprite(this._spriteNode);
        }
    }

    private _applySprite(body: Node) {
        const sp = body.addComponent(Sprite);
        sp.spriteFrame = this.spriteFrame;
        // 3.x 必须显式设 CUSTOM 并自己定尺寸，否则尺寸由贴图元数据决定，改动不生效
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const ui = body.getComponent(UITransform);
        if (ui) ui.setContentSize(this.displaySize, this.displaySize);
        this._halfW = this.displaySize / 2;
        this._halfH = this.displaySize / 2;
    }

    /** 创建自己的显示节点。把「搭界面」的细节收敛在这里，场景文件就不必存这堆节点。 */
    private _createBody(): Node {
        const body = new Node('Body');
        body.layer = this.node.layer;          // 必须和父节点同 layer，否则相机看不见（2D 是 UI_2D）
        this.node.addChild(body);

        if (this.spriteFrame) {
            this._applySprite(body);
        }
        return body;
    }

    private _onKeyDown(e: EventKeyboard) {
        this._pressed.add(e.keyCode);
    }

    private _onKeyUp(e: EventKeyboard) {
        this._pressed.delete(e.keyCode);
    }

    /** 把按键状态换算成方向向量：斜向移动要归一化，否则斜着走会快 1.41 倍 */
    private _readDirection(out: Vec3): Vec3 {
        let x = 0;
        let y = 0;
        if (this._pressed.has(KeyCode.KEY_A) || this._pressed.has(KeyCode.ARROW_LEFT)) x -= 1;
        if (this._pressed.has(KeyCode.KEY_D) || this._pressed.has(KeyCode.ARROW_RIGHT)) x += 1;
        if (this._pressed.has(KeyCode.KEY_S) || this._pressed.has(KeyCode.ARROW_DOWN)) y -= 1;
        if (this._pressed.has(KeyCode.KEY_W) || this._pressed.has(KeyCode.ARROW_UP)) y += 1;

        out.set(x, y, 0);
        if (x !== 0 && y !== 0) {
            out.normalize();   // 关键：斜向速度不能比直向快
        }
        return out;
    }

    update(dt: number) {
        const dir = this._readDirection(this._dir);    // 复用缓存向量，零 GC 压力
        this._pos.set(this.node.position);
        this._pos.x += dir.x * this.moveSpeed * dt;    // dt = 帧间隔（秒）-> 帧率无关
        this._pos.y += dir.y * this.moveSpeed * dt;

        const limitX = Math.max(0, this.halfExtentX - this._halfW);
        const limitY = Math.max(0, this.halfExtentY - this._halfH);
        this._pos.x = Math.min(limitX, Math.max(-limitX, this._pos.x));
        this._pos.y = Math.min(limitY, Math.max(-limitY, this._pos.y));
        this.node.setPosition(this._pos);
    }

    /** 供外部（例如收集物判定）读取玩家世界坐标 */
    public get worldPosition(): Readonly<Vec3> {
        return this.node.worldPosition;
    }

    /** 查询某个键当前是否按下。别的组件通过它读取输入，而不是自己去监听一遍键盘。 */
    public isKeyPressed(key: KeyCode): boolean {
        return this._pressed.has(key);
    }
}
