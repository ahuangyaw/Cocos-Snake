import { Node, Label, Graphics, UITransform, Button, Color, HorizontalTextAlignment, VerticalTextAlignment, UIOpacity } from 'cc';

/**
 * UI 控件工厂 —— 用代码构建可交互控件，不依赖任何预制体
 *
 * 【为什么不做成预制体（prefab）】
 *   预制体需要在编辑器里创建并保存 uuid 引用，一旦场景/预制体文件被覆盖
 *   或 uuid 失配，就是经典的 Missing Script / 空引用。
 *   本项目已经吃过这个亏，所以 UI 全部代码生成：
 *   改样式只改代码、不碰序列化文件，也不会有编辑器与文件互相覆盖的问题。
 *
 *   代价：美术无法在编辑器里微调。真实项目的折中是
 *   「结构用代码立骨架，视觉细节用预制体交给美术」。
 */

/** UI 配色（与 SnakeView 的 PALETTE 保持一致的色系） */
export const UI = {
    btnBg: new Color(38, 48, 70, 235),
    btnBorder: new Color(74, 92, 128, 255),
    btnText: new Color(214, 226, 248, 255),
    btnBgOn: new Color(28, 62, 46, 235),
    btnTextOn: new Color(126, 231, 135, 255),

    // 「主要操作」按钮样式（例如主菜单的「开始游戏」）
    btnPrimaryBg: new Color(38, 132, 74, 245),
    btnPrimaryBorder: new Color(96, 220, 130, 255),
    btnPrimaryText: new Color(238, 255, 242, 255),

    menuTitle: new Color(126, 231, 135, 255),
    menuSub: new Color(150, 168, 200, 255),
    menuScore: new Color(255, 224, 130, 255),
    menuRecord: new Color(255, 196, 61, 255),
    dim: new Color(110, 126, 158, 255),
};

/** 按钮样式 */
export interface ButtonStyle {
    bg: Color;
    border: Color;
    text: Color;
}

export const STYLE_DEFAULT: ButtonStyle = {
    bg: UI.btnBg, border: UI.btnBorder, text: UI.btnText,
};

export const STYLE_PRIMARY: ButtonStyle = {
    bg: UI.btnPrimaryBg, border: UI.btnPrimaryBorder, text: UI.btnPrimaryText,
};

export interface ButtonHandle {
    /** 按钮节点（用于定位） */
    node: Node;
    /** 视觉节点（缩放反馈作用在它上面） */
    visual: Node;
    /** 按钮组件 */
    button: Button;
    /** 设置文字 */
    setText(text: string): void;
    /** 设置文字颜色 */
    setTextColor(c: Color): void;
    /** 切换「选中/开启」外观（例如静音按钮） */
    setOn(on: boolean): void;
    /** 整体透明度（禁用态视觉） */
    setOpacity(v: number): void;
}

/**
 * 创建一个纯文字标签。
 */
export function makeLabel(
    name: string,
    parent: Node,
    x: number,
    y: number,
    fontSize: number,
    color: Color,
    align: HorizontalTextAlignment = HorizontalTextAlignment.CENTER,
    width = 360,
): Label {
    const node = new Node(name);
    node.layer = parent.layer;
    parent.addChild(node);
    node.setPosition(x, y, 0);

    const label = node.addComponent(Label);
    label.string = '';
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 6;
    label.color = color;
    label.horizontalAlign = align;
    label.verticalAlign = VerticalTextAlignment.CENTER;

    const ui = node.getComponent(UITransform);
    if (ui) ui.setContentSize(width, fontSize + 12);
    return label;
}

/**
 * 创建一个按钮。
 *
 * 节点结构（很重要，别随意改）：
 *     ButtonNode          <- 位置在这里，**不做缩放**，承载 UITransform 用于点击命中
 *     └── Visual          <- 背景与文字在这里，缩放反馈作用在这一层
 *
 * 为什么拆两层：
 *   如果直接在 ButtonNode 上做 SCALE 过渡，节点位置一样会被缩放影响，
 *   多按几次就会看到按钮慢慢"漂移"或尺寸失控。
 *   把「定位」和「缩放反馈」分到两层，两个问题互不干扰。
 *
 * 为什么用 SCALE 而不是 COLOR 过渡：
 *   Button 的 COLOR 过渡需要目标上有 Sprite / Label 等渲染组件才能着色，
 *   而我们的背景是 Graphics（程序化绘制），拿不到统一的可着色目标。
 *   所以选 SCALE —— 它只改节点缩放，对 Graphics 一样有效。
 */
export function makeButton(
    name: string,
    parent: Node,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    fontSize: number,
    onClick: () => void,
    style: ButtonStyle = STYLE_DEFAULT,
): ButtonHandle {
    // ---- 外层：定位 + 命中区域 ----
    const node = new Node(name);
    node.layer = parent.layer;
    parent.addChild(node);
    node.setPosition(x, y, 0);

    const hitUI = node.addComponent(UITransform);
    hitUI.setAnchorPoint(0.5, 0.5);
    hitUI.setContentSize(width, height);

    // ---- 内层：视觉 + 缩放反馈 ----
    const visual = new Node('Visual');
    visual.layer = node.layer;
    node.addChild(visual);
    visual.setPosition(0, 0, 0);
    const visUI = visual.addComponent(UITransform);
    visUI.setAnchorPoint(0.5, 0.5);
    visUI.setContentSize(width, height);

    const g = visual.addComponent(Graphics);
    drawButtonBg(g, width, height, style.bg, style.border);

    const label = makeLabel('Text', visual, 0, 0, fontSize, style.text,
        HorizontalTextAlignment.CENTER, width - 16);
    label.string = text;

    const opacity = visual.addComponent(UIOpacity);
    opacity.opacity = 255;

    // ---- 按钮组件 ----
    const button = node.addComponent(Button);
    button.target = visual;
    button.transition = Button.Transition.SCALE;
    /**
     * 缩放反馈：**必须放大，不能缩小**。
     *
     * 引擎文档里有一条明确警告：
     *   "Setting zoomScale less than 1 is not adviced, which could fire the
     *    touchCancel event"（不建议 zoomScale 小于 1，缩放后触摸点若落在
     *    触摸区域外会触发 touchCancel）
     *
     * 说人话：按下时缩小，手指可能落到命中区之外，CLICK 就不会触发 ——
     * 表现为「按钮点了没反应」，而且很难查（因为看起来按钮明明有反馈）。
     * 所以按下改为放大到 1.06，命中区只会变大，绝不会丢事件。
     */
    button.zoomScale = 1.06;
    button.duration = 0.06;           // 60ms，够快才跟手
    node.on(Button.EventType.CLICK, onClick);

    let isOn = false;

    const handle: ButtonHandle = {
        node,
        visual,
        button,
        setText(t: string) { label.string = t; },
        setTextColor(c: Color) { label.color = c; },
        setOn(on: boolean) {
            isOn = on;
            drawButtonBg(g, width, height, on ? UI.btnBgOn : style.bg,
                on ? UI.btnBorder : style.border);
            label.color = on ? UI.btnTextOn : style.text;
        },
        setOpacity(v: number) {
            opacity.opacity = Math.max(0, Math.min(255, Math.round(v)));
        },
    };
    return handle;
}

/** 重绘按钮背景（先 clear 再画，支持状态切换） */
function drawButtonBg(g: Graphics, w: number, h: number, bg: Color, border: Color = UI.btnBorder) {
    g.clear();
    const r = Math.min(h / 2, 14);      // 圆角取高度一半与 14 的较小值

    // 底色
    g.fillColor = bg;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();

    // 描边：让按钮在深色背景上有清晰边界
    g.lineWidth = 2;
    g.strokeColor = border;
    g.roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, r);
    g.stroke();
}

/**
 * 创建一个半透明遮罩（用于菜单/暂停/结束时的背景压暗）。
 */
export function makeDimOverlay(name: string, parent: Node, vw: number, vh: number, alpha = 205): Graphics {
    const node = new Node(name);
    node.layer = parent.layer;
    parent.addChild(node);
    node.setPosition(0, 0, 0);
    const ui = node.addComponent(UITransform);
    ui.setAnchorPoint(0.5, 0.5);
    ui.setContentSize(vw * 2, vh * 2);

    const g = node.addComponent(Graphics);
    g.fillColor = new Color(6, 10, 18, alpha);
    g.rect(-vw, -vh, vw * 2, vh * 2);
    g.fill();
    return g;
}
