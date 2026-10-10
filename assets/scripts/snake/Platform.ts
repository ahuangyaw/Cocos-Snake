/**
 * Platform —— 平台适配层（智能适配版）
 *
 * 【文件命名里的"智能适配"是什么意思】
 *   本文件在运行时**先尝试加载 `cc`**：
 *     - 在 Cocos 环境里：用引擎的 sys.platform / sys.localStorage
 *     - 在纯 Node 环境里（单元测试）：自动退化为「只有全局对象嗅探 + 内存存储」
 *   这样同一份文件既能被游戏使用，又能被 Node 测试直接 import，
 *   不需要为测试单独维护一份实现。
 *
 *   为什么不用静态 `import { sys } from 'cc'`：
 *     那会让 Node 直接加载失败（找不到 cc 模块），测试就跑不起来。
 *
 * 【职责边界】
 *   本文件只做「接口调用」；所有「怎么判断、怎么降级」的逻辑在 PlatformCore.ts，
 *   那边是纯函数，有完整单测覆盖。
 */

import {
    GamePlatform, MiniGameAPI, StringStore, ResilientStore, MemoryStore,
    detectPlatform, parseNonNegativeInt,
} from './PlatformCore';

export { GamePlatform } from './PlatformCore';

// ======================================================================
// 尽力而为地拿到 cc 的 sys —— 拿不到就退化为 Node 模式
// ======================================================================
interface CCSystem {
    platform?: string;
    Platform?: { [k: string]: string };
    isNative?: boolean;
    isBrowser?: boolean;
    localStorage?: {
        getItem(k: string): string | null;
        setItem(k: string, v: string): void;
        removeItem(k: string): void;
    };
}

let _sys: CCSystem | null = null;
try {
    // 用运行时 require 而不是静态 import：Node 下 require('cc') 会抛错，try/catch 能接住；
    // 静态 import 则在模块解析阶段就失败，测试根本跑不起来。
    // 类型上 CCSystem 已经描述了我们用到的全部字段，所以先断言为 any 再取。
    const req: any = (typeof globalThis !== 'undefined')
        ? (globalThis as any).require
        : undefined;
    if (typeof req === 'function') {
        const cc: any = req('cc');
        if (cc && cc.sys) _sys = cc.sys as CCSystem;
    }
} catch (e) {
    // 纯 Node 环境（单元测试）：没有引擎，走嗅探 + 内存存储
    _sys = null;
}

/** 当前是否运行在 Cocos 引擎里 */
export const HAS_ENGINE = _sys !== null;

// ======================================================================
// 全局对象访问
// ======================================================================
function globalObject(): any {
    try {
        // globalThis 在 ES2020 标准化，这里用 typeof 守卫，兼容旧目标
        if (typeof globalThis !== 'undefined') return globalThis as any;
        if (typeof window !== 'undefined') return window as any;
        return null;
    } catch (e) {
        return null;
    }
}

function readGlobals(): { [name: string]: any } {
    const out: { [name: string]: any } = {};
    const g = globalObject();
    if (!g) return out;
    for (const name of ['tt', 'wx', 'my', 'qg', 'hbs']) {
        try { out[name] = g[name]; } catch (e) { out[name] = undefined; }
    }
    return out;
}

// ======================================================================
// 底层存储适配（平台 API / localStorage / 无）
// ======================================================================
class EngineLocalStorageStore implements StringStore {
    public get(k: string): string | null {
        const ls = _sys && _sys.localStorage;
        if (!ls) throw new Error('no localStorage');
        return ls.getItem(k);
    }
    public set(k: string, v: string): boolean {
        const ls = _sys && _sys.localStorage;
        if (!ls) throw new Error('no localStorage');
        ls.setItem(k, v);
        return true;
    }
    public remove(k: string): void {
        const ls = _sys && _sys.localStorage;
        if (ls) ls.removeItem(k);
    }
}

class MiniApiStore implements StringStore {
    constructor(private readonly _api: MiniGameAPI) { }
    public get(k: string): string | null {
        if (typeof this._api.getStorageSync !== 'function') throw new Error('no getStorageSync');
        const v = this._api.getStorageSync(k);
        if (v === undefined || v === null || v === '') return null;
        return typeof v === 'string' ? v : String(v);
    }
    public set(k: string, v: string): boolean {
        if (typeof this._api.setStorageSync !== 'function') throw new Error('no setStorageSync');
        this._api.setStorageSync(k, v);
        return true;
    }
    public remove(k: string): void {
        if (typeof this._api.removeStorageSync === 'function') this._api.removeStorageSync(k);
    }
}

// ======================================================================
// Platform 单例
// ======================================================================
class PlatformImpl {

    public readonly kind: GamePlatform;
    public readonly apiName: string;
    public readonly reason: string;
    /** 探测到的平台全局对象（tt / wx …），无则为 null */
    public readonly api: MiniGameAPI | null;
    /** 存储入口：底层失败会自动降级到内存 */
    private readonly _store: ResilientStore;

    private readonly _showCbs: Array<() => void> = [];
    private readonly _hideCbs: Array<() => void> = [];
    private _lifecycleBound = false;

    constructor() {
        const detected = detectPlatform({
            sysPlatform: _sys ? _sys.platform : undefined,
            platformEnum: _sys ? (_sys.Platform as any) : undefined,
            isNative: _sys ? !!_sys.isNative : false,
            isBrowser: _sys ? !!_sys.isBrowser : false,
            globals: readGlobals(),
        });

        this.kind = detected.kind;
        this.api = detected.api;
        this.apiName = detected.apiName;
        this.reason = detected.reason;

        // 存储后端的优先级：小游戏 API > 引擎 localStorage > 纯内存
        let backing: StringStore | null = null;
        if (this.api && typeof this.api.getStorageSync === 'function'
            && typeof this.api.setStorageSync === 'function') {
            backing = new MiniApiStore(this.api);
        } else if (_sys && _sys.localStorage) {
            backing = new EngineLocalStorageStore();
        }
        this._store = new ResilientStore(backing);
    }

    // ---------------- 存储 ----------------
    public getString(key: string, fallback: string = ''): string {
        const v = this._store.get(key);
        return (v === null || v === undefined) ? fallback : v;
    }

    public setString(key: string, value: string): boolean {
        return this._store.set(key, value);
    }

    public getInt(key: string, fallback: number = 0): number {
        return parseNonNegativeInt(this._store.get(key), fallback);
    }

    public setInt(key: string, value: number): boolean {
        return this._store.set(key, String(Math.floor(value)));
    }

    public remove(key: string) {
        this._store.remove(key);
    }

    // ---------------- 震动 ----------------
    public vibrateShort() {
        if (!this.api || typeof this.api.vibrateShort !== 'function') return;
        try {
            this.api.vibrateShort({ type: 'light', fail: () => { /* 无马达时忽略 */ } });
        } catch (e) { /* 忽略 */ }
    }

    public vibrateLong() {
        if (!this.api || typeof this.api.vibrateLong !== 'function') return;
        try { this.api.vibrateLong({}); } catch (e) { /* 忽略 */ }
    }

    // ---------------- 分享 ----------------
    public get canShare(): boolean {
        if (!this.api) return false;
        return typeof this.api.shareAppMessage === 'function'
            || typeof this.api.showShareMenu === 'function';
    }

    /**
     * 触发分享。
     *
     * ⚠️ 抖音对「诱导分享」有限制，且分享结果回调并不可靠。
     *    所以分享只能作为可选加成，**不能作为游戏进度的必要条件**。
     */
    public share(title: string, desc?: string, query?: string): boolean {
        if (!this.api) return false;

        const payload: any = {
            title,
            desc: desc || '',
            query: query || '',
            success: () => console.log('[Platform] 分享成功'),
            fail: (e: any) => console.log('[Platform] 分享失败/取消:',
                e && e.errMsg ? e.errMsg : e),
        };

        if (typeof this.api.shareAppMessage === 'function') {
            try { this.api.shareAppMessage(payload); return true; } catch (e) {
                console.warn('[Platform] shareAppMessage 调用失败:', e);
            }
        }
        if (typeof this.api.showShareMenu === 'function') {
            try { this.api.showShareMenu({ withShareTicket: false }); return true; } catch (e) {
                console.warn('[Platform] showShareMenu 调用失败:', e);
            }
        }
        return false;
    }

    // ---------------- 生命周期 ----------------
    /**
     * 注册前后台切换回调。
     *
     * 为什么必须处理：小游戏切到后台时如果继续跑逻辑，
     * 玩家回来会发现蛇已经撞死了。这是产品体验问题，不只是技术问题。
     */
    public onShow(cb: () => void) { this._showCbs.push(cb); this._bindLifecycle(); }
    public onHide(cb: () => void) { this._hideCbs.push(cb); this._bindLifecycle(); }

    private _bindLifecycle() {
        if (this._lifecycleBound) return;

        if (this.api && typeof this.api.onShow === 'function'
            && typeof this.api.onHide === 'function') {
            try {
                this.api.onShow(() => this._emit(this._showCbs));
                this.api.onHide(() => this._emit(this._hideCbs));
                this._lifecycleBound = true;
                return;
            } catch (e) {
                console.warn('[Platform] 绑定小游戏生命周期失败:', e);
            }
        }
        // Web / 原生：标准的 visibilitychange
        try {
            const doc: any = (typeof document !== 'undefined') ? document : null;
            if (doc && doc.addEventListener) {
                doc.addEventListener('visibilitychange', () => {
                    this._emit(doc.hidden ? this._hideCbs : this._showCbs);
                });
                this._lifecycleBound = true;
            }
        } catch (e) { /* 忽略 */ }
    }

    private _emit(list: Array<() => void>) {
        for (const cb of list) {
            try { cb(); } catch (e) { /* 单个回调出错不影响其它 */ }
        }
    }

    // ---------------- 诊断 ----------------
    /**
     * 一行描述当前平台。
     * 这是排查「到底跑在 Web 还是抖音」的第一手依据 —— 先确认平台，再谈别的。
     */
    public describe(): string {
        let sysInfo = '';
        if (this.api && typeof this.api.getSystemInfoSync === 'function') {
            try {
                const s = this.api.getSystemInfoSync();
                sysInfo = ` | ${s.platform || '?'} ${s.system || ''} ` +
                    `窗口${s.windowWidth || '?'}x${s.windowHeight || '?'} ` +
                    `DPR${s.pixelRatio || '?'}` +
                    (s.SDKVersion ? ` SDK${s.SDKVersion}` : '');
            } catch (e) { /* 忽略 */ }
        }
        const engine = HAS_ENGINE
            ? `sys.platform=${_sys!.platform} isBrowser=${_sys!.isBrowser} isNative=${_sys!.isNative}`
            : '无引擎（纯 Node 环境）';
        return `平台=${this.kind}(${this.reason}) 全局对象=${this.apiName || '无'} ` +
            `${engine}${sysInfo}`;
    }

    /** 是否具备平台存储能力（false 表示只能存在内存里） */
    public get hasPersistentStorage(): boolean {
        if (this.api) return typeof this.api.setStorageSync === 'function';
        return HAS_ENGINE && !!(_sys && _sys.localStorage);
    }
}

/** 全局单例 —— 平台信息在进程内不会变，没必要重复探测 */
export const Platform = new PlatformImpl();

/**
 * 存储键名集中管理。
 * 改动键名等于"用户的旧存档失效"，所以集中在这里，改动时一眼能看见影响面。
 */
export const STORAGE_KEYS = {
    /** 历史最高分 */
    BEST_SCORE: 'snake.best.v1',
    /** 是否静音（用户偏好，应跨局、跨启动保留） */
    MUTED: 'snake.muted.v1',
};
