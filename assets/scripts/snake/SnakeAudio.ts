import { _decorator, Component, resources, AudioClip, AudioSource } from 'cc';
import { SnakeView } from './SnakeView';

const { ccclass, property } = _decorator;

/**
 * SnakeAudio —— 音频层
 *
 * 【设计原则：它只听事件，不问玩法】
 *   本组件订阅 SnakeView 的事件（onEat / onDeath / onTurn ...），
 *   自己决定"这件事该配什么声音"。
 *   SnakeView 完全不知道音频层存在 —— 加音效、换音效、静音，
 *   都不需要动渲染层一行代码。
 *
 * 【为什么用 resources 动态加载而不是在编辑器里拖引用】
 *   编辑器里拖引用需要在场景/预制体里存下 AudioClip 的 uuid，
 *   而我们已经吃过"手写场景 uuid"的亏。用 `resources.load` 按路径加载，
 *   整个装配过程留在代码里，零编辑器操作、零序列化风险。
 *   代价：音频必须放在 assets/resources/ 目录下（这是引擎的约定）。
 */
@ccclass('SnakeAudio')
export class SnakeAudio extends Component {

    @property({ tooltip: '主音量 0~1' })
    public volume = 0.85;

    @property({ tooltip: '是否静音（可在运行时用 M 键切换）' })
    public muted = false;

    /** 吃食物音效按连击升调用的 6 个变体（文件名前缀 eat_0..eat_5） */
    private readonly EAT_COUNT = 6;
    private readonly AUDIO_DIR = 'audio';

    private _clips: { [name: string]: AudioClip } = {};
    /** 短音效统一用一个 AudioSource 播放 —— 避免频繁切换 source 的开销 */
    private _sfx: AudioSource | null = null;
    private _loaded = false;

    private _view: SnakeView | null = null;

    // ==================================================================
    // 加载
    // ==================================================================
    onLoad() {
        this._sfx = this.node.addComponent(AudioSource);
        this._sfx.loop = false;
        this._sfx.playOnAwake = false;
        this._sfx.volume = this.muted ? 0 : this.volume;

        this._loadAll();
    }

    private _loadAll() {
        const names: string[] = [];
        for (let i = 0; i < this.EAT_COUNT; i++) names.push('eat_' + i);
        names.push('turn', 'death', 'gameover', 'start', 'record');

        let pending = names.length;
        let got = 0;

        const done = () => {
            pending--;
            if (pending <= 0) {
                this._loaded = true;
                console.log(`[SnakeAudio] 音效加载完成：${got}/${names.length} 个`);
                if (got === 0) {
                    console.warn('[SnakeAudio] 一个音效都没加载到。请确认 wav 文件在 ' +
                        'assets/resources/audio/ 目录下，并且编辑器已完成导入。');
                }
            }
        };

        for (const n of names) {
            // 逐个加载：某个文件缺失只影响它自己，不会让整批失败
            resources.load(`${this.AUDIO_DIR}/${n}`, AudioClip, (err, clip) => {
                if (err || !clip) {
                    console.warn(`[SnakeAudio] 加载失败 ${n}: ${err ? err.message : '空资源'}`);
                } else {
                    this._clips[n] = clip;
                    got++;
                }
                done();
            });
        }
    }

    // ==================================================================
    // 播放
    // ==================================================================
    /** 播放一个音效。带轻微随机音量/音高，避免连续播放听感机械 */
    private _play(name: string, volumeScale = 1) {
        if (this.muted || !this._loaded) return;
        const clip = this._clips[name];
        if (!clip || !this._sfx) return;

        this._sfx.stop();
        this._sfx.clip = clip;
        // 每次播放微调音量（±6%），听感上更自然
        this._sfx.volume = Math.max(0, Math.min(1, this.volume * volumeScale * (0.94 + Math.random() * 0.12)));
        this._sfx.play();
    }

    // ==================================================================
    // 绑定到游戏事件
    // ==================================================================
    /**
     * 由 SnakeGame 调用一次，把音频接到游戏事件上。
     *
     * 注意这里的分工：
     *   SnakeGame 负责「接线」，SnakeAudio 负责「怎么响」，SnakeView 负责「发生什么」。
     *   三者互不知道对方的实现细节 —— 这是可维护性的来源。
     */
    public bind(view: SnakeView) {
        this._view = view;

        view.onEat = (comboLevel: number) => {
            // 连击越高，音调越高 —— 最廉价也最有效的正反馈
            const idx = Math.max(0, Math.min(this.EAT_COUNT - 1, comboLevel));
            this._play('eat_' + idx, 1.0);
        };

        view.onDirectionTurn = () => {
            this._play('turn', 0.5);      // 转向音要轻，不能盖过主反馈
        };

        view.onDeath = () => {
            this._play('death', 1.0);
            // 死亡音之后接结束音：用 scheduleOnce 错开，形成"撞击 + 收尾"的层次
            this.scheduleOnce(() => this._play('gameover', 0.9), 0.35);
        };

        view.onNewRecord = () => {
            this.scheduleOnce(() => this._play('record', 1.0), 0.9);
        };

        view.onRestart = () => {
            this.unscheduleAllCallbacks();
            this._play('start', 0.9);
        };

        // 首次进入也给一个开局音
        this.scheduleOnce(() => this._play('start', 0.8), 0.5);
    }

    // ==================================================================
    // 静音切换
    // ==================================================================
    public toggleMute(): boolean {
        this.muted = !this.muted;
        if (this._sfx) this._sfx.volume = this.muted ? 0 : this.volume;
        console.log('[SnakeAudio]', this.muted ? '已静音' : '已开启声音');
        return this.muted;
    }

    onDestroy() {
        this.unscheduleAllCallbacks();
        this._clips = {};
    }
}
