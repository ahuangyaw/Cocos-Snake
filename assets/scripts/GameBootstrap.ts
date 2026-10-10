import { _decorator, Component, Node, SpriteFrame } from 'cc';
import { PlayerController } from './PlayerController';
import { CollectibleField } from './CollectibleField';
import { GameSession } from './GameSession';

const { ccclass, property } = _decorator;

/**
 * GameBootstrap —— 唯一的「接线口」
 *
 * 为什么需要它：
 *   场景文件里引用自定义脚本组件时，用的是**压缩 uuid**（形如 "6569bodnFtH5KEmu8MJz2TG"）。
 *   手写这个格式极易出错，一旦错位就是 "Missing Script"。
 *   所以这里改成：**场景里不引用任何自定义脚本**，由这个唯一的入口在运行时
 *   用类名把需要的组件挂上去。
 *
 * 你要做的只有一件事：把本脚本挂到 Canvas 上（然后就不需要再管场景了）。
 *
 * 工程意义：
 *   「场景装配」与「逻辑实现」解耦。以后改游戏结构只改代码，不动场景文件，
 *   也就不会再有场景冲突、不会再有 Missing Script。
 */
@ccclass('GameBootstrap')
export class GameBootstrap extends Component {

    @property({ tooltip: '玩家贴图（可留空，运行时会自己去找 player 图片）' })
    public playerSprite: SpriteFrame | null = null;

    @property({ tooltip: '宝石贴图（可留空，运行时会自己去找 dot 图片）' })
    public dotSprite: SpriteFrame | null = null;

    @property({ tooltip: '单局时长（秒）' })
    public roundSeconds = 60;

    @property({ tooltip: '自动构建游戏（关掉则只保留接线，方便你自己在编辑器里搭）' })
    public autoBuild = true;

    onLoad() {
        if (!this.autoBuild) return;

        // ---------- ① 检查贴图配置 ----------
        if (!this.playerSprite) {
            console.warn('[GameBootstrap] 未指定玩家贴图：游戏照常运行，但看不到菱形。' +
                '把 assets/textures/player.png 拖到本组件的 Player Sprite 槽即可。');
        }
        if (!this.dotSprite) {
            console.warn('[GameBootstrap] 未指定宝石贴图：宝石不可见（碰撞判定仍然有效）。' +
                '把 assets/textures/dot.png 拖到本组件的 Dot Sprite 槽即可。');
        }

        // ---------- ② 找到 / 创建 GameRoot ----------
        // GameRoot 必须挂在 Canvas 之下，否则 2D 渲染找不到渲染根（可能完全不显示）
        let root = this.node.getChildByName('GameRoot');
        if (!root) {
            root = new Node('GameRoot');
            root.layer = this.node.layer;      // 继承 Canvas 的 UI_2D 层
            this.node.addChild(root);
            root.setPosition(0, 0, 0);
        }

        // ---------- ③ 用类名挂组件（绕开场景里的 uuid 引用） ----------
        // 注意顺序：先 Player，再 Field，最后 Session。
        // 因为 GameSession 会在自己的初始化里用 getComponent 找前两个，先挂上它才能找到。
        // 若已存在就复用，避免重复挂载（例如反复重载场景）
        let player = root.getComponent('PlayerController') as PlayerController | null;
        if (!player) player = root.addComponent('PlayerController') as PlayerController;

        let field = root.getComponent('CollectibleField') as CollectibleField | null;
        if (!field) field = root.addComponent('CollectibleField') as CollectibleField;

        let session = root.getComponent('GameSession') as GameSession | null;
        if (!session) session = root.addComponent('GameSession') as GameSession;

        // ---------- ④ 注入配置 ----------
        // 顺序问题是这样解决的：
        //   这三个组件的初始化都安排在**下一帧**（scheduleOnce(0)），
        //   而这里的赋值是同步完成的，所以等到它们初始化时，配置一定就绪。
        //   —— 用「晚一帧」换「顺序确定」，比依赖 onLoad 的调用次序可靠得多。
        player.spriteFrame = this.playerSprite;
        field.dotSpriteFrame = this.dotSprite;
        session.playerSprite = this.playerSprite;
        session.dotSprite = this.dotSprite;
        session.roundSeconds = this.roundSeconds;

        console.log('[GameBootstrap] 装配完成：GameRoot 下已挂载 PlayerController / CollectibleField / GameSession');
    }
}
