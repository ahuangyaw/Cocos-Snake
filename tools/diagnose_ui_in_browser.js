/**
 * 浏览器 DevTools 诊断脚本 —— 一次性把 UI 节点树与所有 Label 的真实状态打印出来
 *
 * 【怎么用】
 *   1. 预览页面里按 F12 打开 DevTools
 *   2. 切到 Console 标签
 *   3. 整段复制本文件内容，粘贴到 Console，回车
 *   4. 把输出（从 === 开始到 === 结束）整段贴回来
 *
 * 【为什么需要它】
 *   连续几轮我都在"看截图猜原因"，效率很低。
 *   直接把节点树、Label 的 string/fontSize/color/enabled、以及每个节点的
 *   active / layer / position / 尺寸 打出来，一眼就能定位。
 */
(function diagnoseSnakeUI() {
    const cc = window.cc;
    if (!cc) {
        console.error('找不到 window.cc —— 请确认页面已加载完成（或换用 legacyCC）');
        return;
    }

    // Cocos 3.x 的 director 可能挂在 cc 上
    const director = cc.director;
    const scene = director && director.getScene();
    if (!scene) {
        console.error('拿不到当前场景');
        return;
    }

    const LAYER_UI_2D = 1 << 25;   // 33554432

    function layerName(l) {
        if (l === LAYER_UI_2D) return 'UI_2D';
        if (l === (1 << 30)) return 'DEFAULT';
        return String(l);
    }

    const lines = [];
    const push = (s) => lines.push(s);

    push('=================== SNAKE UI 诊断 ===================');
    push('场景: ' + scene.name);

    let labelCount = 0;
    let nodeCount = 0;

    function walk(node, depth) {
        nodeCount++;
        const pad = '  '.repeat(depth);
        const comps = node.components.map(c => c.constructor.name || '?');

        // 收集这个节点上的 Label 信息
        let labelInfo = '';
        for (const c of node.components) {
            if (c.constructor.name === 'Label' || (c.string !== undefined && c.fontSize !== undefined)) {
                labelCount++;
                const ui = node.getComponent(cc.UITransform);
                labelInfo = ` [Label string="${c.string}" size=${c.fontSize} ` +
                    `enabled=${c.enabled} color=(${c.color ? [c.color.r, c.color.g, c.color.b, c.color.a].join(',') : '?'}) ` +
                    `ui=${ui ? ui.width.toFixed(0) + 'x' + ui.height.toFixed(0) : 'none'}]`;
            }
        }

        const ui = node.getComponent(cc.UITransform);
        const pos = node.position;
        push(`${pad}${node.name} active=${node.active} layer=${layerName(node.layer)} ` +
            `pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)}) ` +
            `scale=(${node.scale.x.toFixed(2)}) ` +
            `ui=${ui ? ui.width.toFixed(0) + 'x' + ui.height.toFixed(0) : '-'} ` +
            `comps=[${comps.join(',')}]${labelInfo}`);

        for (const ch of node.children) walk(ch, depth + 1);
    }

    walk(scene, 0);

    push('');
    push(`节点总数: ${nodeCount}   Label 总数: ${labelCount}`);
    push('=================== 诊断结束 ===================');
    console.log(lines.join('\n'));

    // 额外：把 GameSession / SnakeView 的关键状态打出来
    try {
        const canvas = scene.getChildByName('Canvas');
        const gameNode = canvas ? canvas.getChildByName('SnakeGame') : null;
        if (gameNode) {
            const gs = gameNode.getComponent('GameSession');
            const sv = gameNode.getComponent('SnakeView');
            console.log('[状态] SnakeGame 节点存在, 子节点数=' + gameNode.children.length);
            if (gs) {
                console.log('[状态] GameSession.state =', gs.state);
                console.log('[状态] GameSession 字段:', {
                    _vw: gs._vw, _vh: gs._vh,
                    overlayActive: gs._overlayRoot ? gs._overlayRoot.active : 'null',
                    menuTitle: gs._menuTitle ? gs._menuTitle.string : 'null',
                    menuSub: gs._menuSub ? gs._menuSub.string : 'null',
                    menuBtn: gs._menuBtn ? gs._menuBtn.node.active : 'null',
                    menuBtn2: gs._menuBtn2 ? gs._menuBtn2.node.active : 'null',
                });
            } else {
                console.warn('[状态] SnakeGame 节点上没有 GameSession 组件');
            }
            if (sv) {
                console.log('[状态] SnakeView.layout =', JSON.stringify(sv.layout, null, 1));
            } else {
                console.warn('[状态] SnakeGame 节点上没有 SnakeView 组件');
            }
        } else {
            console.warn('[状态] 找不到 Canvas/SnakeGame 节点');
        }
    } catch (e) {
        console.warn('[状态] 读取组件状态失败:', e);
    }
})();
