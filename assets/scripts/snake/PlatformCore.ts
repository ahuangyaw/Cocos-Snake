/**
 * 平台探测与降级策略 —— 纯逻辑，零引擎依赖，可单测
 *
 * 【为什么把它从 Platform.ts 里抽出来】
 *   Platform.ts 依赖 `cc` 的 sys 来读取平台信息，因此无法在 Node 里测试。
 *   但真正容易出错的部分并不是"调用 tt.setStorageSync"，
 *   而是**探测优先级**与**失败降级**这两件纯逻辑的事：
 *     - 全局对象嗅探的顺序对不对？
 *     - 平台存储抛异常时，值有没有正确落到内存兜底？
 *     - 同一份数据在 Web 与小游戏上读到的结果是否一致？
 *   把这两件事抽成不依赖引擎的纯函数，就能用 Node 把各种平台组合全跑一遍。
 *
 * 这就是本项目一贯的做法：**把需要判断的逻辑与需要调用的接口分开**。
 */

export enum GamePlatform {
    BYTEDANCE = 'BYTEDANCE',   // 抖音 / 字节小游戏
    WECHAT = 'WECHAT',         // 微信小游戏
    TAOBAO = 'TAOBAO',
    OPPO = 'OPPO',
    VIVO = 'VIVO',
    HUAWEI = 'HUAWEI',
    OTHER_MINI = 'OTHER_MINI',
    WEB = 'WEB',
    NATIVE = 'NATIVE',
    UNKNOWN = 'UNKNOWN',
}

/** 小游戏平台通用的 API 形状（tt / wx / my / qg / hbs 都符合） */
export interface MiniGameAPI {
    getStorageSync?(key: string): any;
    setStorageSync?(key: string, value: any): void;
    removeStorageSync?(key: string): void;
    vibrateShort?(opts?: any): void;
    vibrateLong?(opts?: any): void;
    showShareMenu?(opts?: any): void;
    shareAppMessage?(opts?: any): void;
    getSystemInfoSync?(): any;
    onShow?(cb: () => void): void;
    onHide?(cb: () => void): void;
}

export interface DetectInput {
    /** 引擎 sys.platform 的值（Web 上可能是 EDITOR_PAGE / DESKTOP_BROWSER 等） */
    sysPlatform?: string;
    isNative?: boolean;
    isBrowser?: boolean;
    /** 引擎 sys.Platform 枚举（用于与 sysPlatform 比较） */
    platformEnum?: { [k: string]: string };
    /** 全局对象表：{ tt: {...}, wx: {...} }。测试时可以直接构造 */
    globals: { [name: string]: any };
}

export interface DetectResult {
    kind: GamePlatform;
    api: MiniGameAPI | null;
    apiName: string;
    /** 是靠什么判断出来的，便于排查"为什么识别错了" */
    reason: string;
}

/** 各平台的全局对象名 */
const API_NAME: { [k: string]: string } = {
    [GamePlatform.BYTEDANCE]: 'tt',
    [GamePlatform.WECHAT]: 'wx',
    [GamePlatform.TAOBAO]: 'my',
    [GamePlatform.OPPO]: 'qg',
    [GamePlatform.VIVO]: 'qg',
    [GamePlatform.HUAWEI]: 'hbs',
};

/** 全局对象名 -> 平台（嗅探用，按优先级排列） */
const SNIFF_ORDER: Array<[string, GamePlatform]> = [
    ['tt', GamePlatform.BYTEDANCE],
    ['wx', GamePlatform.WECHAT],
    ['my', GamePlatform.TAOBAO],
    ['qg', GamePlatform.OTHER_MINI],
    ['hbs', GamePlatform.HUAWEI],
];

function isUsableApi(v: any): boolean {
    return !!v && typeof v === 'object' && typeof v.getSystemInfoSync === 'function';
}

/**
 * 探测当前平台。
 *
 * 优先级：**引擎的 sys.platform 优先，全局对象嗅探兜底**。
 * 为什么这样排：
 *   sys.platform 由引擎的 PAL 层在各平台适配代码里设置，是"权威答案"；
 *   而全局对象嗅探只是猜测 —— 但它能覆盖"引擎没识别、但确实在小游戏容器里"的情况
 *   （例如在抖音开发者工具里跑 Web 版调试）。
 */
export function detectPlatform(input: DetectInput): DetectResult {
    const p = input.sysPlatform || '';
    const P = input.platformEnum || {};

    // ---- 1. 引擎平台枚举优先 ----
    const byEnum: Array<[string, GamePlatform]> = [
        [P.BYTEDANCE_MINI_GAME || 'BYTEDANCE_MINI_GAME', GamePlatform.BYTEDANCE],
        [P.WECHAT_GAME || 'WECHAT_GAME', GamePlatform.WECHAT],
        [P.WECHAT_MINI_PROGRAM || 'WECHAT_MINI_PROGRAM', GamePlatform.WECHAT],
        [P.TAOBAO_MINI_GAME || 'TAOBAO_MINI_GAME', GamePlatform.TAOBAO],
        [P.OPPO_MINI_GAME || 'OPPO_MINI_GAME', GamePlatform.OPPO],
        [P.VIVO_MINI_GAME || 'VIVO_MINI_GAME', GamePlatform.VIVO],
        [P.HUAWEI_QUICK_GAME || 'HUAWEI_QUICK_GAME', GamePlatform.HUAWEI],
    ];
    for (const [val, kind] of byEnum) {
        if (p && p === val) {
            const name = API_NAME[kind] || '';
            return {
                kind, api: (name ? input.globals[name] : null) || null,
                apiName: name, reason: `sys.platform=${p}`,
            };
        }
    }

    if (input.isNative) {
        return { kind: GamePlatform.NATIVE, api: null, apiName: '', reason: 'sys.isNative' };
    }

    // ---- 2. 全局对象嗅探（Web 上也适用：可能在抖音工具里跑 Web 调试） ----
    for (const [name, kind] of SNIFF_ORDER) {
        const api = input.globals[name];
        if (isUsableApi(api)) {
            return { kind, api: api as MiniGameAPI, apiName: name, reason: `嗅探全局对象 ${name}` };
        }
    }

    // ---- 3. 浏览器 / 未知 ----
    if (input.isBrowser) {
        return { kind: GamePlatform.WEB, api: null, apiName: '', reason: 'sys.isBrowser' };
    }
    return { kind: GamePlatform.UNKNOWN, api: null, apiName: '', reason: '无法识别' };
}

/** 字符串存储的抽象接口，便于把平台 API / localStorage / 内存 三种实现统一测试 */
export interface StringStore {
    get(key: string): string | null;
    set(key: string, value: string): boolean;
    remove(key: string): void;
}

/**
 * 内存兜底存储。
 *
 * 【它是"永不失败"的最后一道防线】
 *   小游戏平台的存储可能因为隐私模式、配额、平台 bug 而失败。
 *   失败时如果直接抛异常，玩家会看到崩溃；如果直接丢弃，玩家会看到"分数没保存"。
 *   所以在内存里留一份 —— 至少本次运行内数据是一致的，
 *   而且下次写入成功时会一并落盘。
 */
export class MemoryStore implements StringStore {
    private _m: { [k: string]: string } = {};
    public get(key: string): string | null {
        return this._m[key] !== undefined ? this._m[key] : null;
    }
    public set(key: string, value: string): boolean {
        this._m[key] = value;
        return true;
    }
    public remove(key: string): void {
        delete this._m[key];
    }
}

/**
 * 用一个「可能失败」的底层存储 + 内存兜底，构造一个「永不失败」的存储。
 *
 * 行为约定（这也是测试要断言的）：
 *   - 写入：先写内存，再尝试底层；底层失败返回 false，但内存里一定有值
 *   - 读取：先读底层；底层失败或没有时回落到内存；都没有则返回 null
 *   - 删除：两边都删，任一边失败不影响另一边
 */
export class ResilientStore implements StringStore {
    private readonly _backing: StringStore | null;
    private readonly _memory = new MemoryStore();

    constructor(backing: StringStore | null) {
        this._backing = backing;
    }

    public get(key: string): string | null {
        if (this._backing) {
            try {
                const v = this._backing.get(key);
                if (v !== null && v !== undefined && v !== '') return v;
            } catch (e) {
                // 底层读取失败：回落到内存
            }
        }
        return this._memory.get(key);
    }

    public set(key: string, value: string): boolean {
        // 先写内存：保证本次运行内数据一致，即使底层失败
        this._memory.set(key, value);
        if (!this._backing) return false;
        try {
            return this._backing.set(key, value);
        } catch (e) {
            return false;
        }
    }

    public remove(key: string): void {
        this._memory.remove(key);
        if (!this._backing) return;
        try { this._backing.remove(key); } catch (e) { /* 忽略 */ }
    }
}

/** 把数值安全地解析成非负整数（存档解析的统一入口） */
export function parseNonNegativeInt(raw: string | null, fallback: number = 0): number {
    if (raw === null || raw === undefined || raw === '') return fallback;
    const v = parseInt(String(raw), 10);
    if (isNaN(v) || v < 0) return fallback;
    return v;
}
