# 🐍 Cocos Snake

用 **Cocos Creator 3.8.8** 实现的贪吃蛇，目标平台是**抖音小游戏**。

不是教程跟练产物 —— 整个项目按「逻辑 / 渲染 / 输入 / 音频」四层分离的工程方式组织，
逻辑核心带 **51 条自动化单元测试**，音效由**代码合成**（仓库里没有一个音频素材文件）。

---

## 玩法与操作

| 输入 | 作用 |
| --- | --- |
| **屏幕按钮** | 静音 / 暂停 / 菜单（游戏中常驻）；开始 / 再来一局 / 返回主菜单（菜单与结束时） |
| **滑动屏幕** | 转向（触屏方案） |
| `W A S D` / `方向键` | 转向（仅游戏中生效，带输入缓冲） |
| `空格` | 暂停 / 继续 |
| `Esc` | 返回主菜单 |
| `R` | 重开 |
| `M` | 静音切换 |

吃到的食物越多，蛇越快；连续快速进食会**升调播报连击**，分数越吃越值钱。

---

## 架构

```
assets/scripts/snake/
├── SnakeCore.ts      纯逻辑核心 —— 不 import 任何 cc，可脱离引擎单测
├── StateMachine.ts   游戏流程状态机 —— 纯逻辑，拒绝非法切换
├── layout.ts         竖屏布局数学 —— 纯函数，按真实设备尺寸单测
├── PlatformCore.ts   平台探测 + 存储降级 —— 纯逻辑，可按平台组合单测
├── Platform.ts       平台适配层 —— 抖音 tt / 微信 wx / Web 统一接口
├── SnakeView.ts      渲染 + 手感 —— 只读核心状态，只负责画
├── UIFactory.ts      可点击控件工厂 —— 代码生成按钮，不依赖预制体
├── SnakeAudio.ts     音频层 —— 只订阅事件，不问玩法
├── GameSession.ts    流程编排 —— 状态机 + 菜单 + 按钮 + 界面刷新
└── SnakeGame.ts      输入 + 总装配 —— 唯一需要手动挂到 Canvas 的组件
```

### 游戏流程（状态机）

```
BOOT ──▶ MENU ──▶ PLAYING ⇄ PAUSED
                     │
                     ▼
                 GAME_OVER ──▶ PLAYING（再来一局）
                     └──────▶ MENU（返回主菜单）
```

**为什么用状态机而不是几个 bool**：用 `isPlaying` / `isPaused` / `isGameOver`
三个 bool 会有 2³ = 8 种组合，其中只有 4 种合法 —— 另外 4 种是「不可能状态」。
一旦出现就会产生极难复现的 bug（结束后还能暂停、菜单里蛇在动、暂停后无法恢复）。
状态机把合法切换显式写下来，非法切换被拒绝并告警。

### 为什么这样分层

| 层 | 职责 | 收益 |
| --- | --- | --- |
| `SnakeCore` | 规则、格子坐标、固定步长 | **可在 Node 里跑测试**，可移植，确定性 |
| `StateMachine` | 流程合法性 | 流程 bug 基本绝迹 |
| `layout` | 布局数学 | 换设备不用真机验证，单测覆盖 |
| `PlatformCore` | 平台探测 + 存储降级策略 | 平台组合与失败路径可离线验证 |
| `Platform` | 存储 / 震动 / 分享 / 生命周期 | **游戏代码不认识抖音**，一份代码跑全平台 |
| `SnakeView` | 插值渲染、粒子、震屏 | 换美术风格不用动逻辑 |
| `UIFactory` | 可点击控件 | 按钮不用预制体，没有 uuid 失配风险 |
| `SnakeAudio` | 订阅事件决定配什么声音 | 加/换/静音音效不动渲染层 |
| `GameSession` | 状态机 + 界面刷新 | 界面显隐绑定状态，不散落 if 判断 |
| `SnakeGame` | 输入 + 装配 | 唯一知道全局的地方 |

**各层互不知道对方实现细节** —— 这是可维护性的来源，也是能持续加功能不失控的前提。

---

## 平台适配（抖音小游戏）

### 设计：游戏代码不认识平台

平台差异全部收敛在 `Platform` 一个文件里：

```ts
// 游戏代码只写这个 —— 底下走 tt / wx / localStorage 由 Platform 决定
Platform.setInt(STORAGE_KEYS.BEST_SCORE, score);
Platform.vibrateShort();
Platform.share('我拿了 120 分！');
```

**平台识别优先用引擎的 `sys.platform`**（`sys.Platform.BYTEDANCE_MINI_GAME`），
全局对象嗅探（`tt` / `wx` / `my` / `qg` / `hbs`）作为兜底 ——
后者能覆盖「在抖音开发者工具里跑 Web 版调试」这类情况。

### 存储：永不失败

平台存储可能因**隐私模式 / 配额 / 平台 bug** 而失败。策略是三层：

| 层 | 行为 |
| --- | --- |
| 小游戏平台 | `tt.getStorageSync` / `tt.setStorageSync` |
| Web / 原生 | 引擎的 `sys.localStorage` |
| **内存兜底** | 底层失败时保留一份，保证**本次运行内数据一致**，下次写入成功时落盘 |

关键约定：**所有存储 API 永不抛异常**。写入失败返回 `false` 告知调用方「未持久化」，
但玩家不会看到崩溃，也不会看到分数凭空消失。

### 已接入的平台能力

| 能力 | 说明 |
| --- | --- |
| **存储** | 最高分、静音偏好（用户偏好跨启动保留） |
| **震动** | 吃到食物轻震、死亡强震；无马达平台静默跳过 |
| **分享** | 结束界面「晒成绩」按钮，**仅支持分享的平台显示**；失败不影响游戏 |
| **生命周期** | 切后台自动暂停（否则玩家回来会发现蛇已撞死） |

> ⚠️ 抖音对「诱导分享」有限制，且分享成功回调不可靠。
> 所以分享只作为可选加成，**不作为游戏进度的必要条件**。

### 需要的构建扩展

Cocos Creator **3.8.8 默认不包含抖音构建目标**。自带的平台扩展是：
`wechatgame` / `taobao-mini-game` / `oppo-mini-game` / `vivo-mini-game` / `huawei-quick-game`。

抖音支持需要单独安装，见 [docs/03-抖音小游戏适配指南.md](docs/03-抖音小游戏适配指南.md)。

---

## 核心技术点

| 技术 | 说明 |
| --- | --- |
| **固定时间步长** | 逻辑以 0.16s → 0.062s 的固定间隔推进，与渲染帧率解耦 |
| **插值渲染** | 在两次逻辑步之间做线性插值，格子游戏也有连续顺滑运动 |
| **输入缓冲队列** | 最多缓存 2 个转向；反向判定基于**队列尾**而非当前方向 |
| **临界点提前转身** | 玩家在一步的后 32% 按方向时立刻结算这一步，把最坏响应延迟从 ~176ms 压到 ~51ms |
| **对象池思路** | 粒子复用、颜色带预计算，避免每帧分配 |
| **确定性随机** | 内置 xorshift32，相同种子 + 相同输入 = 相同结果（可回放 / 可复现 bug） |
| **食物可达性** | 用 BFS 洪水填充确保食物不生成在被蛇身围出的死区里 |
| **程序化渲染** | 全部用 `Graphics` 绘制，零贴图依赖 |
| **程序化音效** | 加减法合成 WAV（振荡器 + 包络 + 扫频），零音频素材 |
| **存档** | `sys.localStorage`，Web 与抖音小游戏同一份代码 |

---

## 把工程跑起来

1. 用 **Cocos Creator 3.8.8** 打开本工程，等待编译完成
2. 打开 `assets/main.scene`
3. 层级管理器里选中 **`Canvas`** → 属性检查器「添加组件」→ **`SnakeGame`**
4. 点 ▶ 预览

> 只有第 3 步需要手动操作。其余组件（`SnakeView` / `SnakeAudio`）由 `SnakeGame` 在运行时自动挂载，
> 所以**场景文件里不存任何自定义脚本的引用** —— 也就不会出现 `Missing Script`。

### 屏幕适配（竖屏）

- **设计分辨率 720×1280 + `FIXED_WIDTH` 策略**：宽度永远铺满屏幕，高度按设备比例自适应。
  长屏手机（20:9 / 21:9）多出的纵向空间自然分配为上下留白。
- **安全区适配**：用 `sys.getSafeAreaRect()` 读取刘海 / 灵动岛 / 圆角的内边距，
  HUD 与棋盘都排布在安全区之内。引擎已支持 Android / iOS / 微信 / 字节（抖音）小游戏。
- **布局是纯函数**（`assets/scripts/snake/layout.ts`），不依赖任何引擎 API，
  因此可以用真实设备尺寸做单元测试：

```bash
node tools/test_layout.js temp/core-js/layout.js
```

覆盖 iPhone SE / iPhone X 刘海屏 / iPhone 14 Pro 灵动岛 / 各类安卓长屏 / iPad / 极端 1:1 共 11 种尺寸，
断言「棋盘不溢出」「不压 HUD」「格子不小于可点面积下限」「格子严格正方形」。

### 可调手感参数

在 `Canvas` 的 `SnakeGame` / `SnakeView` 组件上直接拖：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `Base Step Interval` | 0.16 | 蛇的基础速度（秒/格），改小变快 |
| `Min Step Interval` | 0.062 | 最快时的速度 |
| `Early Turn At` | 0.32 | **越大越跟手**；0.15 很跟手但转身略突兀，0.60 接近"老实等一步" |
| `Cell Size` | 26 | 格子边长（像素） |
| `Volume` | 0.85 | 主音量 |

---

## 开发工具链

工程自带一套纯标准库的验证脚本（不需要装任何依赖）：

```bash
# 逻辑核心单元测试（55 条，不需要 Cocos 编辑器）
node tools/test_snake_core.js temp/core-js/SnakeCore.js

# 流程状态机测试（35 条，含 20 组状态切换穷举）
node tools/test_state_machine.js temp/core-js/StateMachine.js

# 竖屏布局测试（19 条，覆盖 11 种设备尺寸 + 控件重叠检测）
node tools/test_layout.js temp/core-js/layout.js

# 平台探测与存储降级测试（40 条，覆盖各平台组合与失败路径）
node tools/test_platform.js temp/core-js/PlatformCore.js

# 重新合成音效 + 校验（无削波 / 无直流偏移 / 无爆音 / 包络正确衰减）
node tools/make_audio.js
python tools/verify_audio.py

# 场景/预制体文件完整性校验（引用 / 父子关系 / 组件双向登记）
python tools/validate_scene.py assets/main.scene

# 编码卫生检查（BOM / 换行符 / 解码失败）
python tools/check_encoding.py

# 预览 .gitignore 会放过哪些文件（避免把 library/ temp/ 提交进去）
python tools/preview_gitignore.py

# 生成 2D 贴图（纯标准库手写 PNG 编码器）
python tools/make_art.py
```

**共 149 条自动化测试**（55 逻辑 + 35 状态机 + 19 布局 + 40 平台），全部可在无编辑器环境下运行。

---

## 目录说明

```
assets/
├── main.scene              场景（只有 Canvas + Camera 需要存在）
├── scripts/snake/          四个脚本，见上「架构」
├── resources/audio/        程序化合成的 11 个音效（resources/ 下才能按路径加载）
└── textures/               程序化生成的占位贴图
docs/                       开发过程记录与交付说明
tools/                      验证与生成脚本
```

**注意**：`library/` `temp/` `profiles/` `build/` 是编辑器可再生的派生数据，已被 `.gitignore` 排除。
但 `assets/**/*.meta` **必须提交** —— 它记录了每个资源的 uuid，丢失会导致所有引用失联。

---

## 待办（面向抖音小游戏上线）

- [x] 核心玩法与手感
- [x] 音效（程序化合成）
- [x] 最高分持久化
- [ ] **屏幕适配**：改竖屏，`view.setDesignResolutionSize` + `FitHeight`
- [ ] **真机性能实测**：`Graphics` 每帧重建网格在低端机上的表现
- [ ] **平台 SDK 封装层**：`tt.` 命名空间、录屏分享、排行榜
- [ ] **首包体积控制**：抖音小游戏对首包有大小限制
- [ ] **分包 / 远程资源策略**

---

## 许可

个人学习项目。代码可自由参考。
