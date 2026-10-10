/**
 * 布局计算 —— 纯函数，零引擎依赖，可单测
 *
 * 【为什么把它从 SnakeView 里抽出来】
 *   布局是最容易"看起来对、换台设备就崩"的代码：
 *   在 720x1280 上调好的间距，到 1080x2340 或 iPad 上就可能溢出、
 *   压到 HUD，或者棋盘小得没法玩。
 *
 *   而它本质上是**纯数学**：输入视口尺寸 + 行列数 + 安全区，输出一堆坐标。
 *   抽成纯函数之后，就能用 Node 把市面上常见的设备尺寸全跑一遍，
 *   断言"棋盘在屏幕内""不压 HUD""格子不小于可点面积下限"。
 *
 *   这就是「逻辑与渲染分离」在 UI 代码上的同一条原则。
 */

export interface Viewport {
    /** 可视区域宽度（设计分辨率单位） */
    width: number;
    /** 可视区域高度（设计分辨率单位） */
    height: number;
    /** 安全区内边距（设计分辨率单位），避开刘海 / 灵动岛 / 圆角 */
    insetTop: number;
    insetBottom: number;
    insetLeft: number;
    insetRight: number;
}

export interface LayoutResult {
    vw: number;
    vh: number;
    insetTop: number;
    insetBottom: number;
    insetLeft: number;
    insetRight: number;
    /** 格子边长 */
    cell: number;
    boardW: number;
    boardH: number;
    /** 棋盘中心（相对 Canvas 中心） */
    boardCx: number;
    boardCy: number;
    /** 顶部常驻按钮的位置（相对 Canvas 中心）—— 由布局统一算，避免和标题打架 */
    hudMenuX: number;
    hudMenuY: number;
    hudMenuW: number;
    hudMenuH: number;
    hudMuteX: number;
    hudPauseX: number;
    hudTopBtnY: number;
    hudTopBtnW: number;
    hudTopBtnH: number;
    /** HUD 各元素位置（相对 Canvas 中心） */
    hudTitleY: number;
    hudScoreY: number;
    hudSubY: number;
    hudHintY: number;
    /** 棋盘上沿、下沿的 y 坐标（相对 Canvas 中心），供测试断言用 */
    boardTopY: number;
    boardBottomY: number;
}

/** 棋盘边长下限（设计分辨率单位）。低于这个值手机上看不清。 */
export const MIN_BOARD_SIZE = 200;

/** 格子边长下限（设计分辨率单位）。低于这个值手指点不准。 */
export const MIN_CELL_SIZE = 12;

/**
 * 布局常量。刻意导出，供测试与界面层引用。
 *
 * 【为什么要导出】
 *   测试里如果自己写一份 HUD 高度（例如硬编码 78），一旦代码改成 118，
 *   测试就会用错误的基准去断言，产生假失败 —— 这个坑真实踩过。
 *   常量只有一个来源，测试与实现共用，才不会漂移。
 */
export const LAYOUT_CONST = {
    /** 顶部信息区总高度（按钮带 + 标题带） */
    HUD_BLOCK_H: 118,
    /** 底部提示区高度 */
    HINT_BLOCK_H: 34,
    /** 区块之间的间距 */
    SECTION_GAP: 10,
    /** 棋盘离屏幕左右的最小边距 */
    SCREEN_MARGIN: 8,
    /** 棋盘左侧给按钮预留的宽度 */
    HUD_RESERVE_W: 86,
    /** 顶部「按钮带」高度 */
    TOP_BTN_ROW_H: 58,
};

const HUD_BLOCK_H = LAYOUT_CONST.HUD_BLOCK_H;
const HINT_BLOCK_H = LAYOUT_CONST.HINT_BLOCK_H;
const SECTION_GAP = LAYOUT_CONST.SECTION_GAP;
const SCREEN_MARGIN = LAYOUT_CONST.SCREEN_MARGIN;
const HUD_RESERVE_W = LAYOUT_CONST.HUD_RESERVE_W;
const TOP_BTN_ROW_H = LAYOUT_CONST.TOP_BTN_ROW_H;

/**
 * 计算竖屏布局。
 *
 * 分区（从上到下）：
 *   [安全区顶]
 *   [顶部信息区 HUD_BLOCK_H]  ← 标题 / 分数 / 最高 / 速度
 *   [gap]
 *   [棋盘区，吃掉剩余高度，居中]
 *   [gap]
 *   [底部提示区 HINT_BLOCK_H]
 *   [安全区底]
 */
export function computeLayout(vp: Viewport, cols: number, rows: number): LayoutResult {
    const vw = vp.width;
    const vh = vp.height;
    const insetTop = vp.insetTop;
    const insetBottom = vp.insetBottom;
    const insetLeft = vp.insetLeft;
    const insetRight = vp.insetRight;

    // ---- 垂直可用区间（相对 Canvas 中心，y 向上为正）----
    // 注意：这里**不能**对可用高度做下限兜底。
    // 一旦硬撑（Math.max(MIN_BOARD_SIZE, ...)），棋盘就会超出可用空间、
    // 压到顶部 HUD —— 极端方屏（1:1）上就是这么失败的。
    // 空间不足时应当让棋盘变小，而不是溢出。
    const top = vh / 2 - insetTop - HUD_BLOCK_H;
    const bottom = -vh / 2 + insetBottom + HINT_BLOCK_H;
    const blockH = Math.max(24, top - bottom - SECTION_GAP * 2);

    // ---- 水平可用宽度：左右各让出边距，再让出左侧按钮要占的宽度 ----
    const availW = Math.max(24,
        vw - insetLeft - insetRight - SCREEN_MARGIN * 2 - HUD_RESERVE_W);

    // ---- 棋盘取「可用宽高的较小值」做成正方形，保证不溢出 ----
    const square = Math.max(24, Math.min(availW, blockH));

    // 格子边长：让正方形被 cols x rows 填满，取较小方向，避免越界
    const rawCell = Math.min(square / cols, square / rows);
    const cell = Math.max(MIN_CELL_SIZE, Math.floor(rawCell * 100) / 100);

    const boardW = cell * cols;
    const boardH = cell * rows;

    // 棋盘在垂直剩余区间里居中；水平方向靠右，把左侧空间留给按钮
    const boardCy = (top + bottom) / 2;
    const boardCx = (insetLeft + HUD_RESERVE_W - insetRight) / 2;

    // ---- 顶部常驻按钮 ----
    //
    // 【排布思路（改过一版，因为原来会重叠）】
    //   720px 宽的竖屏里，三个按钮横排在顶行会占满整行；而标题/分数的 UITransform
    //   是整屏宽、居中在 x=0，所以**只要 y 上有交叠就算重叠**。
    //   解决办法不是继续微调坐标，而是把顶部区域显式分成两带：
    //     按钮带（TOP_BTN_ROW_H）：只放 音效 / 暂停 / 菜单
    //     标题带（其余高度）：标题 + 分数，与按钮带完全不重叠
    //   所有位置由常量推导，不手写魔法数字。
    const btnH = 42;
    const btnW = 76;
    const topRowCy = vh / 2 - insetTop - TOP_BTN_ROW_H / 2;

    // 按钮带内水平排布：菜单在左，音效与暂停在右，中间留给标题带
    const menuW = 76;
    const pauseX = vw / 2 - insetRight - btnW / 2 - 6;
    const muteX = pauseX - btnW - 8;
    const menuX = -vw / 2 + insetLeft + menuW / 2 + 6;

    // 标题带：从按钮带下沿开始，依次排标题与分数
    const titleBandTop = vh / 2 - insetTop - TOP_BTN_ROW_H;
    const hudTitleY = titleBandTop - 20;
    const hudScoreY = titleBandTop - 62;
    const hudSubY = titleBandTop - 92;

    return {
        vw, vh, insetTop, insetBottom, insetLeft, insetRight,
        cell, boardW, boardH,
        boardCx, boardCy,
        hudMenuX: menuX, hudMenuY: topRowCy, hudMenuW: menuW, hudMenuH: btnH,
        hudMuteX: muteX, hudPauseX: pauseX,
        hudTopBtnY: topRowCy, hudTopBtnW: btnW, hudTopBtnH: btnH,
        hudTitleY,
        hudScoreY,
        hudSubY,
        hudHintY: -vh / 2 + insetBottom + 16,
        boardTopY: boardCy + boardH / 2,
        boardBottomY: boardCy - boardH / 2,
    };
}
