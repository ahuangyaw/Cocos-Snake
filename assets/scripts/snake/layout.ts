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

const HUD_BLOCK_H = 78;      // 顶部信息区高度
const HINT_BLOCK_H = 34;     // 底部提示区高度
const SECTION_GAP = 10;      // 区块之间的间距
const SCREEN_MARGIN = 8;     // 棋盘离屏幕左右的最小边距

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
    const top = vh / 2 - insetTop - HUD_BLOCK_H;
    const bottom = -vh / 2 + insetBottom + HINT_BLOCK_H;
    const blockH = Math.max(MIN_BOARD_SIZE, top - bottom - SECTION_GAP * 2);

    // ---- 水平可用宽度 ----
    const availW = Math.max(MIN_BOARD_SIZE, vw - insetLeft - insetRight - SCREEN_MARGIN * 2);

    // ---- 棋盘取「可用宽高的较小值」做成正方形，保证不溢出 ----
    const square = Math.max(MIN_BOARD_SIZE, Math.min(availW, blockH));

    // 格子边长：让正方形被 cols x rows 填满，取较小方向，避免越界
    const rawCell = Math.min(square / cols, square / rows);
    const cell = Math.max(MIN_CELL_SIZE, Math.floor(rawCell * 100) / 100);

    const boardW = cell * cols;
    const boardH = cell * rows;

    // 棋盘在垂直剩余区间里居中
    const boardCy = (top + bottom) / 2;

    return {
        vw, vh, insetTop, insetBottom, insetLeft, insetRight,
        cell, boardW, boardH,
        boardCx: 0,
        boardCy,
        hudTitleY: vh / 2 - insetTop - 18,
        hudScoreY: vh / 2 - insetTop - 46,
        hudSubY: vh / 2 - insetTop - 72,
        hudHintY: -vh / 2 + insetBottom + 16,
        boardTopY: boardCy + boardH / 2,
        boardBottomY: boardCy - boardH / 2,
    };
}
