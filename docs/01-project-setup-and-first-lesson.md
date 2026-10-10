# HelloWorld（2D 收集小游戏）—— 第一版交付说明

交付人：DSH（本会话担任你的主程）
工程：Cocos Creator **3.8.8**，2D 模板
交付日期：本会话

---

## 一、我做了什么

我没有让你一步步手点编辑器，而是**直接把可运行的工程状态写进了文件**：

| 文件 | 我做的事 |
| --- | --- |
| `assets/main.scene` | **手写序列化场景**：完整的 Canvas / 正交相机 / GameRoot 及三个脚本组件，并注入了两张贴图的引用 |
| `assets/scripts/PlayerController.ts` | 玩家输入与移动（新增） |
| `assets/scripts/CollectibleField.ts` | 收集物生成 / 下落 / 碰撞 / 对象池（新增，含写死的 `.meta` 固定 uuid） |
| `assets/scripts/GameSession.ts` | 计分 / 连击 / 倒计时 / HUD / 重开（新增，含写死的 `.meta`） |
| `assets/textures/player.png` `dot.png` | 用脚本生成的贴图（见下方"我为什么能生成贴图"） |
| `tools/*.py` | 我用来干活的工具链（校验器、修复器、贴图生成器） |

### 我为什么能生成贴图，而不是找图

`tools/make_art.py` 用纯标准库（zlib + struct）手写 PNG 编码器生成两张图：
`player.png` 是带朝向尖角的菱形（这样旋转/转向一眼能看出来对不对），`dot.png` 是圆形宝石。
好处：不依赖外部资源、无版权问题、**透明像素干净**（半透明脏边是 2D 素材导入的经典坑）。

---

## 二、怎么跑起来

1. 打开 Cocos Creator（工程已被编辑器打开过，它会检测到文件变化）
2. 等右下角编译完成，打开 **Console** 面板，点扫帚图标清空
3. 双击 `assets/main.scene` 打开场景
4. 点 ▶ 预览

**操作**：`W A S D` 或 `方向键` 移动菱形；金色圆点从上方落下，碰到即得分；`60 秒`后结束，按 `R` 重开。

**你应该在 Console 看到**：

```
[GameSession] 开局：60 秒，WASD/方向键 移动，吃宝石得分
[GameSession] 本局结束，分数 = ..., | 对象池状态 active = 0  pooled = N
```

---

## 三、场景结构（为什么这么设计）

```
Scene "scene-2d"
└── Canvas              (cc.UITransform + cc.Canvas, 960×640, layer=UI_2D)
    ├── Camera          (cc.Camera: 正交投影, near 0, far 2000)
    └── GameRoot        (layer=UI_2D, 只有脚本组件)
        ├── PlayerController
        ├── CollectibleField
        └── GameSession
```

> **为什么 `GameRoot` 必须放在 `Canvas` 之下**（这是我改过一次的地方）：
> Creator 的 2D/UI 渲染由「渲染根」驱动，`cc.Canvas` 本身就是一个 `RenderRoot2D`。
> 节点挂在场景根下、即使 layer 是 UI_2D，也**可能因为没有所属渲染根而完全不显示**。
> 我第一版把 `GameRoot` 挂在场景根下 —— 这是个真实存在的坑，已修正（见 `tools/move_gameroot_under_canvas.py`）。

`GameRoot` 与 `Canvas` 的局部位置都是 (0,0)，所以 `GameRoot` 下子节点的坐标空间是**以屏幕中心为原点**，
活动范围 ±480 × ±320（由 `view.getVisibleSize()` 在运行时读取设计分辨率得到，不写死）。

**三个刻意的设计决定，每一个都能直接用到真实项目里：**

### 1. 场景里几乎没有节点，节点在运行时创建

`GameRoot` 下**没有** Player、Dots、Label 节点。这些都由脚本在 `onLoad` 里创建。

- 好处：场景文件从"几百行 JSON"降到 20 个对象，**场景冲突（git merge conflict）几乎不会发生**
- 代价：美术无法在编辑器里直接调位置 —— 所以真实项目里是"**结构用代码立骨架，表现用预制体交给美术**"，两边取平衡

### 2. 组件之间不互相搜索，由编排者注入引用

`GameSession.onLoad` 里把 `player`、`onCollected` 回调塞给 `CollectibleField`；
`CollectibleField` **从不**自己去 `find('Player')`。

- 依赖关系一眼看清，改一个组件不会牵动全身
- 用 `find(名字)` 硬编码路径是新手最常见的耦合源：改个节点名，游戏就崩

### 3. 执行顺序被显式依赖

`GameSession` 排在组件列表第一个 → 它的 `onLoad` 最先执行 → 它写入的 `spriteFrame`、
`player` 引用，后面两个组件的 `onLoad` 一定能读到。

> **这不是巧合，是有意利用的引擎行为。** 引擎按 `_components` 数组顺序调用 `onLoad`。
> 反过来，如果你的初始化顺序错了，会拿到 `null` 而报"莫名其妙"的错 ——
> **"谁先初始化"是引擎里最常见的隐性 bug 来源。**

---

## 四、代码里藏着的工程课（每一条都请你回看对应代码）

| 位置 | 知识点 | 为什么重要 |
| --- | --- | --- |
| `PlayerController.update` | `dt` 帧率无关 | 用 `/60` 硬编码，换台机器游戏速度就变 |
| `PlayerController._readDirection` | 斜向要 `normalize()` | 否则斜着走快 1.41 倍（√2） |
| `PlayerController._dir` | 缓存向量，不每帧 `new` | 每帧 new 对象 = 持续 GC 压力 |
| `PlayerController.onDestroy` | `input.off` 成对解绑 | 不解绑 → 悬空回调 → 内存泄漏 + 空指针 |
| `CollectibleField._obtain/_recycle` | **对象池** | 频繁 new/destroy 节点会造成帧率尖刺 |
| `CollectibleField` 碰撞 | 比较**距离平方** | 开方很贵；只比较平方值，性能优化最常用的一招 |
| `CollectibleField.update` | `while` + 减法累计 | 帧率掉到 20 时不会"少生成"宝石 |
| `CollectibleField` 倒序遍历 | 边遍历边 `splice` | 正序遍历删除会跳过元素（经典 bug） |
| `GameSession._refreshHud` | 值变化才更新 UI | 每帧拼字符串 = 每帧产生垃圾 |
| `GameSession._onDotCollected` | 连击窗口计时 | 游戏手感的来源：奖励"连续操作" |
| `GameSession._restart` | 状态重置 | 忘了重置某个字段 = 重开后行为诡异 |

---

## 五、我诚实交代的三件事

### 1. 我的代码没有在引擎里跑过（我没有 Cocos 编辑器）

我做了这些**能做的验证**：
- `tools/validate_scene.py`：场景文件 29 处引用全部合法、父子关系双向一致、组件双向登记一致 ✅
- 所有 API（`Input.EventType.KEY_DOWN`、`Sprite.SizeMode.CUSTOM`、`view.getVisibleSize()`、
  `Label.string/horizontalAlign/fontSize`、`KeyCode.KEY_W`…）**逐个从你本机的引擎类型声明文件里核对过**，
  不是凭记忆写的
- 序列化字段的取值范围（`_projection: 0`=ORTHO、`_clearFlags: 7`=ALL、`layer` 33554432=UI_2D）

**但我无法验证运行时行为。** 第一次预览就是真正的测试。

### 2. 一个我明确标注的残余风险

场景里引用自定义脚本组件是这样写的：

```json
{ "__type__": "6569ba1d-9c5b-47e4-a126-bbc309cf64c6", ... }
```

**这是完整 uuid，不是编辑器惯用的压缩形式**（如 `b2bd1+njXxJxaFY3ymm06WU`）。

我读了引擎源码确认：
- `decodeUuid()` 只对**长度恰好 22** 的字符串做解码，其他长度**原样返回**；
- 反序列化时 `classFinder(type)` 是**直接查表**（`_idToClass[classId]`），不做解压；
- 而脚本注册用的就是 `.meta` 里的完整 uuid（`js._setClassId(frame.uuid, cls)`）。

所以完整 uuid 应当能被查到。**如果预览时报 `Missing Script` / 组件变成 `cc.MissingScript`，
请立刻告诉我** —— 那我就改用压缩 uuid，这在编辑器保存一次场景后会自然变成标准形式。

### 3. 手写场景文件我犯过一个错，被抓出来了

第一版我把 `GameRoot` 的下标算错了一位，整个引用链错位。这是**手写序列化文件的典型失败模式**。

我的处理方式（这才是值得你学的部分）：
1. 先写**校验器**（`tools/validate_scene.py`）——让机器检查不变量，而不是用眼睛看 JSON；
2. 校验器报错后，写**修复器**（`tools/fix_scene_indices.py`）按语义重排下标；
3. 修复器**带前置校验，不满足就拒绝执行**（它真的拒绝了我两次，逼我把逻辑想清楚）；
4. 修完再跑校验器 → 全部通过。

> **"不要用眼睛看序列化文件，写工具读它"** —— 这是本次交付里最值钱的一句话。

---

## 六、你的作业

现在轮到你动手了。按难度递增，**做几个算几个，做完贴 Console 输出给我**：

1. **改数值**：把 `GameRoot` 的 `CollectibleField` 组件里 `fallSpeed` 从 130 改成 40，观察难度变化。
   （这一步是让你体会"参数暴露给编辑器"的价值）

2. **加机制**：宝石分两种——金色 +1 分、红色 +3 分但下落速度更快。
   提示：`CollectibleField` 需要第二个 `SpriteFrame` 属性，并且要在 `_obtain` 时决定类型。

3. **修一个我埋下的隐患**：`CollectibleField` 的对象池**没有上限**。
   如果玩家一直不吃，池子会一直涨吗？（先想清楚 `_recycle` 什么时候发生）
   如果我想加"最多同时存在 20 个宝石"的限制，该改哪里？**这是设计题，不一定要写代码。**

4. **挑战题**：现在游戏结束后按 `R` 重开。改成"按 R 重开，按 Esc 退出到初始状态"，
   并且**重开后分数、连击、池状态全部干净**。你要自己判断"干净"的标准是什么。

---

## 附：文件清单

```
assets/
├── main.scene                      ← 场景（最终方案里只用到 Canvas + Camera，见「方案变更」）
├── main.scene.meta
├── scripts/
│   ├── GameBootstrap.ts            ← ★ 唯一接线口：挂到 Canvas 上即可跑起来
│   ├── PlayerController.ts         ← 输入 + 移动 + 边界
│   ├── CollectibleField.ts         ← 生成 + 下落 + 碰撞 + 对象池
│   ├── GameSession.ts              ← 计分 + 连击 + 倒计时 + HUD + 重开
│   └── Orbit.ts                    ← 上一轮教程的残留文件，现已无人使用（可删）
├── textures/
│   ├── player.png  dot.png         ← 我用脚本生成的贴图
tools/
├── make_art.py                     ← PNG 生成器（纯标准库）
├── check_syntax.js                 ← 用编辑器的 TypeScript 做语法检查
├── validate_scene.py               ← 场景完整性校验器（引用/父子/组件双向登记）
├── fix_scene_indices.py            ← 场景下标修复器（带拒绝执行的前置校验）
├── move_gameroot_under_canvas.py   ← 层级修正脚本（结构性改动也用工具做）
└── uuid_codec.py                   ← uuid 编解码（含对引擎真实数据的验证）
temp/
├── main.scene.backup-before-ai-edit.json      ← 我动手前的原始场景备份
├── main.scene.before-reserialize.json         ← 重排下标前的备份
├── main.scene.before-move-gameroot.json       ← 移动层级前的备份
└── tsconfig.ai-check.json                     ← 我用来跑类型检查的配置
```

---

# 方案变更说明（重要，请读）

## 为什么改了装配方式

**原方案**：我把三个脚本组件直接写进 `main.scene`，用完整 uuid 作为 `__type__`。
**失败原因**：往编辑器正在打开的场景文件里写入，会被编辑器用内存里的旧场景**回写覆盖**
（证据：`23:34:13` 那次写入把我的 8074 字节场景换成了你原来的 10474 字节版本）。
同时我读到引擎源码确认：场景里引用自定义组件用的是**压缩 uuid**（形如 `6569bodnFtH5KEmu8MJz2TG`），
手写这个格式风险很高。

**新方案**：**场景文件里不再引用任何自定义脚本**。

```
Canvas                          ← 你只需要把 GameBootstrap 挂在这里（挂一次，永久有效）
├── Camera
└── GameRoot                    ← 运行时由 GameBootstrap 创建
    ├── PlayerController        ← 运行时用 addComponent('PlayerController') 挂上
    ├── CollectibleField
    └── GameSession
```

GameBootstrap 用**类名字符串**挂组件，完全绕开 uuid 序列化问题。

## 顺带解决的一个真实工程难题：初始化顺序

`addComponent` 是同步返回的，但组件之间互相需要对方的引用时，**谁先初始化**就成了隐性 bug 来源。

我的处理：**三个组件的初始化全部推迟一帧**（`scheduleOnce(cb, 0)`），
而配置注入是同步完成的 —— 于是"配置一定早于初始化"变成结构性保证，而不是靠调用次序碰运气。

> 这是今天最值钱的一条工程技巧：**用「晚一帧」换「顺序确定」。**

`CollectibleField` 找玩家也用了同样思路：不靠别人注入，而是自己**惰性解析**（`_resolvePlayer()`），
第一次需要时去父节点取一次，取到就缓存。**消除顺序耦合，比记住顺序更可靠。**

## 我做的验证（比上次严格）

| 验证 | 工具 | 结果 |
| --- | --- | --- |
| 语法检查（4 个脚本） | `tools/check_syntax.js`（用编辑器的 TS 5.8.2） | ✅ 全部通过 |
| **全类型检查**（对着引擎 `cc.d.ts`） | `tsc -p temp/tsconfig.ai-check.json` | ✅ **零错误** |
| API 存在性 | 逐个 grep 引擎类型声明文件 | ✅ 已核对 |

**仍未验证的**：运行时行为。我没有 Cocos 编辑器，第一次预览仍是真测试。

