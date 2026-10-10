/**
 * 游戏状态机 —— 纯逻辑，零引擎依赖，可单测
 *
 * 【为什么状态机值得单独写一个文件，而不是用几个 bool 变量凑合】
 *   用 `isPlaying` / `isPaused` / `isGameOver` 三个 bool 表示状态，
 *   会有 2^3 = 8 种组合，其中只有 4 种是合法的 —— 另外 4 种是「不可能状态」。
 *   一旦出现（比如同时 isPlaying 和 isGameOver），就会产生极难复现的 bug：
 *   蛇在结束后还能动、按钮点了没反应、暂停后无法恢复……
 *
 *   状态机把「哪些状态合法」和「能怎么切换」显式写下来，
 *   非法切换会被拒绝并告警，而不是默默进入一个诡异状态。
 *   这是所有有流程的游戏都该做的一件事。
 */

export enum GameState {
    /** 启动中，还没进入菜单 */
    BOOT = 'BOOT',
    /** 主菜单：等待玩家点「开始」 */
    MENU = 'MENU',
    /** 游戏中 */
    PLAYING = 'PLAYING',
    /** 暂停中 */
    PAUSED = 'PAUSED',
    /** 本局结束，展示成绩 */
    GAME_OVER = 'GAME_OVER',
}

/**
 * 合法的状态切换表。
 *
 * 注意 GAME_OVER 有两条出口：重开（PLAYING）和回菜单（MENU）。
 * 菜单只通向 PLAYING —— 不允许从 MENU 直接跳到 GAME_OVER，
 * 那种切换说明逻辑写错了，应该被拒绝。
 */
const TRANSITIONS: { [k: string]: GameState[] } = {
    [GameState.BOOT]: [GameState.MENU, GameState.PLAYING],
    [GameState.MENU]: [GameState.PLAYING],
    [GameState.PLAYING]: [GameState.PAUSED, GameState.GAME_OVER, GameState.MENU],
    [GameState.PAUSED]: [GameState.PLAYING, GameState.MENU, GameState.GAME_OVER],
    [GameState.GAME_OVER]: [GameState.PLAYING, GameState.MENU],
};

export class StateMachine {

    private _state: GameState;
    private _prev: GameState | null = null;
    private _elapsed = 0;
    /** 状态变化回调：(新状态, 旧状态) */
    public onChange: ((next: GameState, prev: GameState) => void) | null = null;
    /** 非法切换回调，便于开发期发现问题 */
    public onIllegal: ((from: GameState, to: GameState) => void) | null = null;

    constructor(initial: GameState = GameState.BOOT) {
        this._state = initial;
    }

    public get state(): GameState {
        return this._state;
    }

    public get previous(): GameState | null {
        return this._prev;
    }

    /** 进入当前状态后经过的秒数（供某些状态做超时判断） */
    public get elapsed(): number {
        return this._elapsed;
    }

    /** 0 表示第一次进入该状态 */
    public get isFresh(): boolean {
        return this._elapsed === 0;
    }

    public is(s: GameState): boolean {
        return this._state === s;
    }

    public canGo(to: GameState): boolean {
        const allowed = TRANSITIONS[this._state];
        return !!allowed && allowed.indexOf(to) >= 0;
    }

    /**
     * 请求切换到目标状态。
     * 返回是否成功 —— 调用方应当检查返回值，而不是假定一定成功。
     */
    public go(to: GameState): boolean {
        if (to === this._state) return false;
        if (!this.canGo(to)) {
            if (this.onIllegal) this.onIllegal(this._state, to);
            return false;
        }
        const from = this._state;
        this._prev = from;
        this._state = to;
        this._elapsed = 0;
        if (this.onChange) this.onChange(to, from);
        return true;
    }

    public update(dt: number) {
        this._elapsed += dt;
    }
}
