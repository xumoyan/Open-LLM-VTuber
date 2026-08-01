# AI 外教移动端 UI 重构计划

> 日期：2026-08-01  
> 状态：待实施  
> 实施对象：Android / iOS Capacitor App  
> 产品标识：`AI 外教` / `ai.english.tutor`  
> 关联计划：[Android / iOS 移动端实施计划](./2026-08-01-android-ios-mobile-implementation-plan.md)  
> 交接说明：本文件用于其他 AI 模型直接实施；本阶段只重构移动端呈现层，不改 Qwen 实时语音协议、后端或桌面 UI。

## 0. 最终结论

当前移动端的问题不是尺寸不够，而是把桌面端的侧栏、历史面板、底部工具栏和多个状态层原样压进了手机屏幕。继续调小字号或按钮只会让信息更难看清。

移动端改为一张沉浸式“直播课堂”页面：

1. 虚拟老师占据上方和中部，是页面视觉主体；
2. 对话记录覆盖在老师下方，使用小型半透明气泡，像直播评论区一样自动跟随最新消息；
3. 底部固定语音与文字输入，是唯一高频操作区；
4. 右上角只保留设置入口，低频功能进入移动端设置面板；
5. 不再显示桌面侧栏、侧栏折叠条、底栏折叠条、附件、群组、历史抽屉、窗口模式、摄像头、屏幕分享、浏览器工具和 ASR/TTS 技术配置；
6. 使用现有 React、Chakra UI、React Icons 和所有 Context/Hook，不增加 UI 框架、动画库、字体包或原生页面。

直播类 App 只作为信息层级参考：全屏内容为主、评论轻量覆盖、输入靠近拇指、低频操作收进右上角。不要复制抖音的品牌、图标、动效、礼物、点赞、在线人数或商业功能。

## 1. 当前问题与根因

### 1.1 代码现状

- `App.tsx` 只用 `768px` 判断侧栏默认是否展开，但移动端仍挂载完整桌面结构；
- `Sidebar` 在手机上仍是 `100vw` 全屏面板，并保留一条 44px 宽的折叠控制区；
- 聊天记录只存在于侧栏，收起侧栏后孩子看不到上下文；
- `Footer` 同时放状态、麦克风、举手/打断、附件和 80px 文本框，手机宽度不足；
- WebSocket 状态、AI 状态、实时字幕、聊天记录各自占一层，内容重复并互相遮挡；
- Live2D、背景、侧栏和底栏采用桌面 z-index 与绝对定位，安全区和键盘出现后容易裁切；
- 桌面设置包含 General、Live2D、ASR、TTS、Agent、About 六组标签，不适合儿童课堂主界面；
- 功能图标和中文必须在 WKWebView/Android WebView 单独验收，不能接受 `?`、空白按钮或 `/undefined/undefined.model3.json`。

### 1.2 根因修复策略

不要继续给桌面组件追加手机断点。使用 `VITE_MOBILE_APP === '1'` 明确选择移动端呈现层，移动端只复用数据、动作和 Live2D，不复用桌面信息架构。

```text
现有 Provider / WebSocket / Qwen / VAD / Audio / Live2D
                         │ 全部复用
              ┌──────────┴──────────┐
              │                     │
       DesktopLayout         MobileClassroom
       保持现状不动           新的直播课堂布局
```

## 2. 目标页面

### 2.1 竖屏正常状态

```text
┌────────────────────────────────┐
│  ● 已连接 · 小动物课       ⚙   │  顶部透明状态栏
│                                │
│                                │
│          虚拟外教老师           │
│       口型、表情、肢体动作        │  上方/中部为视觉主体
│                                │
│       ┈┈ 顶部渐隐 ┈┈            │
│  老师  Today we meet a cat!    │
│                 我  A cat!     │  小型半透明对话气泡
│  老师  Great! Can you meow?    │
│  正在说：Great! Can you...      │  可选流式字幕行
│                                │
│ ┌──────────────────┐  ┌─────┐ │
│ │ 和老师说点什么…   发送│  │  🎤  │ │  底部输入区
│ └──────────────────┘  └─────┘ │
└────────────────────────────────┘
```

### 2.2 键盘弹出状态

```text
┌────────────────────────────────┐
│  ● 已连接 · 小动物课       ⚙   │
│          虚拟老师上移/裁切       │
│                                │
│  老师  Can you find a dog?     │
│                 我  小狗。      │
│ ┌───────────────────────┐ 发送 │
│ │ 我看到一只 dog         │      │
│ └───────────────────────┘      │
├────────────────────────────────┤
│            系统键盘             │
└────────────────────────────────┘
```

键盘出现时只压缩虚拟形象区域，聊天与输入框必须保持可见；页面本身不能整体滚动，也不能把输入框压到键盘下方。

## 3. 移动端设计标准

### 3.1 层级与尺寸

| 区域 | 规格 | 说明 |
|---|---|---|
| 根容器 | `100dvh × 100vw` | 全屏、固定、无横向滚动；包含 iOS/Android safe area |
| 顶部栏 | `52px + safe-area-top` | 透明/渐变；左侧课堂状态，右侧设置 |
| 设置按钮 | 可视图标 24px，点击区最少 48×48px | 同时满足 iOS 44pt 与 Android 48dp 的习惯 |
| Live2D 舞台 | 页面约 60%–72% 的视觉面积 | 允许延伸到底部，但脸和上半身不能被聊天区长期遮挡 |
| 对话覆盖区 | 最大高度 `34dvh`，最小 160px | 位于输入区上方，顶部渐隐，不做整屏聊天页 |
| 消息气泡 | 最大宽度 82%，正文 15–17px | 老师左、孩子右；不显示头像、时间和技术字段 |
| 底部输入区 | 最少 `68px + safe-area-bottom` | 半透明深色底；始终固定在拇指可达区 |
| 文本输入 | 最少 48px 高，最多 3 行 | 默认一行；输入增长时不能挤掉发送与麦克风 |
| 麦克风 | 56×56px | 页面唯一强主按钮；状态不能只用颜色表达 |

具体设备不能靠固定比例硬撑。小屏优先保住顶部状态、最后两条消息和底部输入；大屏再展示更多老师身体与历史消息。

### 3.2 颜色与可读性

- 背景允许由课程图片或 Live2D 场景决定，所有文字层必须有稳定的深色半透明衬底；
- 老师气泡使用 `rgba(15, 18, 25, 0.58)`，孩子气泡使用品牌色半透明底；
- 支持 `backdrop-filter: blur(...)` 时可使用轻量毛玻璃，不支持时退化为更不透明的纯色；
- 正文与背景对比度目标至少 4.5:1，较大的状态文字至少 3:1；
- 不用浅灰小字承载关键状态；不把“已连接/断线”“开麦/静音”只做成红绿颜色；
- 功能图标一律使用已有 `react-icons` SVG，并提供 `aria-label`，不使用 emoji 作为唯一图标；
- 第一版使用系统字体栈。只有真机确认中文缺字时才引入字体文件，不能因为模拟器截图异常直接增加大字体包。

### 3.3 触控与动效

- iOS 点击区域至少 44×44pt；Android 至少 48×48dp；本项目 WebView 统一按最少 48×48 CSS px 实施；
- 相邻按钮至少留 8px 间距；输入、发送和麦克风不能共享模糊点击边界；
- 每个按钮必须有按下态、禁用态和可读标签；
- 监听状态可用轻微呼吸环，时间 1.2–1.6 秒；尊重 `prefers-reduced-motion`；
- 禁止持续飘心、礼物、粒子雨和大幅位移动画，避免分散孩子注意力并拖慢 Live2D；
- 孩子说话或老师说话时，口型和表情是主要反馈，UI 动效只做状态补充。

### 3.4 平台安全区

- 顶部栏内容放在 `env(safe-area-inset-top)` 之下；
- 输入区内容放在 `env(safe-area-inset-bottom)` 之上；
- Android 15+ edge-to-edge 下必须处理状态栏、导航栏和 cutout；
- 不把设置、关闭、发送等可交互控件贴在系统返回手势边缘；
- 继续固定竖屏。平板与横屏本轮不设计，只保证页面不崩坏。

参考标准：

- [Apple HIG：Layout / Safe Area](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple HIG：Buttons，常规点击区域至少 44×44pt](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Android：Edge-to-edge 与 Window Insets](https://developer.android.com/develop/ui/compose/system/setup-e2e)
- [Android：交互元素推荐至少 48×48dp](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views)
- [WCAG 2.2：Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [抖音 App Store 页面](https://apps.apple.com/cn/app/%E6%8A%96%E9%9F%B3/id1142110895)（只参考直播产品的信息优先级，不做视觉复制）

## 4. 各区域详细设计

### 4.1 顶部课堂栏

只显示两类信息：

1. 左侧：小圆点 + 当前状态 + 当前课程名；
2. 右侧：设置按钮。

状态文案使用现有状态，不增加新协议：

| 数据状态 | 移动端文案 | 操作 |
|---|---|---|
| WebSocket 未连接 | `网络断开 · 点此重连` | 整个状态胶囊可点，调用 `reconnect()` |
| WebSocket 连接中 | `正在连接老师…` | 禁止重复点击 |
| `loading` | `老师准备中…` | 麦克风暂不可用 |
| `idle` | `可以开始啦` | 麦克风可用 |
| `listening` | `我在听` | 显示麦克风监听态 |
| `thinking-speaking` | `老师正在回答` | 第一版不强行区分 thinking/speaking |
| `waiting` | `正在输入` | 保持轻量提示 |
| `interrupted` | `已打断` | 很快回到可说话状态 |

不要同时再显示现有的大型 `WebSocketStatus` 和 `AIStateIndicator`；移动端由顶部一枚状态胶囊统一承载。

### 4.2 Live2D 虚拟老师

- 复用现有 `<Live2D />`、模型加载、口型和表情，不重写渲染器；
- 移动端舞台固定全屏，背景在最底层，Live2D 在其上，所有 UI 再覆盖其上；
- 默认保证头部与眼睛位于屏幕上半区中央，聊天区可遮挡腰部但不能遮挡脸；
- 输入键盘出现后允许老师上移和适当缩小，不能重新创建模型或重新连接 WebSocket；
- `modelInfo.url` 未准备好时显示柔和占位图/渐变和“老师准备中”，禁止请求 `undefined/undefined.model3.json`；
- 模型加载失败时仍允许看到错误提示、设置和重试，不能留下纯空白页；
- 中低端 Android 掉帧时先降低 Live2D DPR，再考虑减少 UI 模糊，不新增原生渲染方案。

建议统一层级：

```text
z0  背景
z1  Live2D
z10 顶部课堂栏
z20 对话覆盖区
z30 底部输入区
z40 设置面板 / 权限提示
z50 Toast
```

### 4.3 半透明对话区

数据复用 `useChatHistory().messages`：

- 只展示 `type === 'text'` 且有内容的老师/孩子消息；
- `tool_call_status`、工具名、耗时、模型名和调试信息不展示给孩子；
- 老师消息靠左，孩子消息靠右；
- 去掉头像、时间、`Me`、长角色名等桌面聊天元素；
- 新消息自动滚到最后；孩子手动上滑后暂停自动跟随，并显示一个小型“回到最新”按钮；
- 课堂消息通常较短，第一版使用普通滚动列表，不引入虚拟列表依赖；超过约 100 条并实测掉帧后再优化；
- 顶部使用 CSS 渐隐遮罩，使聊天自然融入 Live2D 舞台；
- 当没有历史时不显示“暂无消息”大面板，只显示一条轻量引导：`点一下麦克风，和老师打招呼吧`。

实时字幕复用 `useSubtitle().subtitleText`：

- `transcript.delta` 作为对话列表末尾的临时行实时更新；
- `transcript.final` 已进入 `messages` 后移除对应临时行；
- 若临时字幕与最后一条正式消息相同，不重复显示；
- 移动端不再额外挂载当前居中的 `<Subtitle />`，避免同一句话出现两次；
- 设置中关闭字幕时，隐藏临时字幕，但已完成的聊天记录仍保留。

### 4.4 底部输入区

底部只保留：文本输入、发送、麦克风。

- 删除附件按钮：移动端第一版不传图片、屏幕或摄像头；
- 删除底栏折叠按钮：输入是核心功能，不能隐藏；
- 删除常驻“举手”按钮：用户直接说话即可打断；老师回答时可在麦克风按钮旁临时显示一个 48px 的“停止回答”按钮，复用 `handleInterrupt()`；
- 麦克风首次点击才申请权限，并在同一个用户手势中恢复 AudioContext；
- 麦克风关闭：图标 + `开始说话` 的辅助标签；
- 正在监听：外圈轻微呼吸，图标 + `正在听`；
- 权限拒绝：输入区上方显示可操作提示 `没有麦克风权限，请到系统设置开启`，不要只弹两秒 Toast；
- 文本输入为空时只显示麦克风；有文本时显示明确发送按钮，同时保留麦克风；
- Enter 发送、Shift+Enter 换行，中文输入法 composition 期间不能误发送；
- 发送后清空文本并保持对话区跟随最新消息；
- 网络未连接或老师仍在加载时，语音/发送禁用并展示原因。

### 4.5 右上角设置

不要在移动端挂载完整桌面 `SettingUI`。右上角打开从底部升起的移动端设置面板；内容超过一屏时面板内部滚动。

第一版只保留：

1. 当前课程/老师配置选择；
2. `显示实时字幕` 开关；
3. `开始新课堂`，二次确认后调用现有 `create-new-history`；
4. 连接状态与 `重新连接`；
5. App 版本、隐私说明入口。

以下内容不出现在普通移动设置：

- WebSocket URL、Base URL、Access Token；
- ASR、TTS、Agent、MCP 技术参数；
- Live2D 缩放和位置调试参数；
- 群组、聊天历史文件、摄像头背景、屏幕分享、浏览器；
- Window/Pet 模式。

私测阶段网络地址继续由构建环境注入；诊断信息留在开发日志，不为此增加隐藏入口或正式产品页面。

正式进入儿童商店分类前，课程切换、外链、隐私和权限恢复等家长操作放到 parental gate 后；本轮 UI 私测不因尚未实现家长账户而停工。

## 5. 现有数据与动作映射

实施模型不得另建一套移动状态管理。

| 移动 UI | 直接复用 |
|---|---|
| 连接状态/重连 | `useWebSocket().wsState` / `reconnect()` |
| 当前课程/老师名 | `useConfig().confName` / `configFiles` |
| 老师状态 | `useAiState().aiState` |
| 正式对话记录 | `useChatHistory().messages` |
| 流式字幕 | `useSubtitle().subtitleText` |
| 字幕开关 | `useSubtitle().showSubtitle/setShowSubtitle` |
| 麦克风开关 | `useFooter().handleMicToggle/micOn` 或现有 `useMicToggle()` |
| 文本输入/发送 | 复用 `useTextInput()` 或 `useFooter()`，不要重写 WebSocket 消息 |
| 打断老师 | `useFooter().handleInterrupt()` |
| 新课堂 | 复用 `useSidebar().createNewHistory()` 的现有逻辑，必要时提取为共享 hook |
| Live2D/口型 | 现有 `<Live2D />` 与音频播放链路 |

只有当共享 hook 强依赖桌面 UI 时才做最小提取；禁止复制发送、打断、开麦或新建历史逻辑到第二份实现。

## 6. 最小代码实施方案

### 6.1 文件范围

首选改动控制在以下范围：

```text
frontend/src/renderer/src/App.tsx
frontend/src/renderer/src/index.css
frontend/src/renderer/src/components/mobile/mobile-classroom.tsx      # 新增
frontend/src/renderer/src/components/mobile/mobile-settings-sheet.tsx # 新增，设置足够小时可并入上一文件
frontend/src/renderer/src/locales/zh/translation.json
frontend/src/renderer/src/locales/en/translation.json
```

视根因允许小改：

```text
frontend/src/renderer/src/components/canvas/live2d.tsx
frontend/src/renderer/src/hooks/canvas/use-live2d-model.ts
```

不要修改：

```text
src/open_llm_vtuber/**
docker-compose.mobile-test.yml
mobile/android/**
mobile/ios/**
Qwen realtime protocol / PCM formats / VAD / audio-manager
```

如 safe area 或键盘问题必须改原生壳，先提供真机复现证据，再单独处理；不提前增加 Capacitor Keyboard 插件。

### 6.2 页面分支

在 `App.tsx` 使用构建标记，不用 User-Agent：

```ts
const isMobileApp = import.meta.env.VITE_MOBILE_APP === '1';
```

- `isMobileApp` 为真：渲染全屏 Live2D + `MobileClassroom`；
- 否则：继续渲染当前 Sidebar/Footer 桌面布局；
- 所有 Provider 和 `WebSocketHandler` 保持共用；
- 不把桌面组件改成大量 `base/md` 条件分支；
- PWA 以后需要相同 UI 时，再由构建参数开启，不在本轮自动套用所有窄屏浏览器。

### 6.3 样式策略

- 组件局部样式继续用 Chakra props；
- 只把 `dvh`、safe area、渐隐 mask、`prefers-reduced-motion` 和 WebView 全局规则放进 `index.css`；
- 不建立新的主题系统、token 包或 CSS-in-JS 封装；
- 使用 `clamp()`、`min()`、`max()`，避免为每一台手机增加媒体查询；
- 先用 CSS `100dvh` 和安全区处理键盘；只有 iOS 真机仍遮挡时，再增加一个最小 `visualViewport` 高度变量监听；
- 毛玻璃必须有纯色 fallback，不能让不支持 blur 的 Android WebView 出现透明文字。

## 7. 实施阶段

## P0：建立可见性基线

任务：

- 在 iPhone 小屏、主流 iPhone、360px Android、412px Android 各保留一张当前截图；
- 确认文字缺失是 DOM 内容、字体、图标、层级还是颜色问题；
- 修复 `undefined.model3.json` 的无效请求或提供加载占位；
- 确认中文、英文、数字和现有 SVG 图标在 iOS/Android 真机正常显示；
- 记录键盘、刘海、安全区与导航栏实际遮挡。

退出条件：能分清“数据没来”和“内容被 UI 遮住”，不接受用随机 padding 掩盖根因。

## P1：移动端页面骨架

任务：

- 新增移动端构建分支；
- 移除移动端 Sidebar/Footer/Subtitle 的挂载；
- 建立背景、Live2D、顶部栏、对话区、输入区五层结构；
- 处理 `100dvh`、safe area 和基础 z-index；
- 保证桌面端像素和交互不变。

退出条件：375×667 到 440×956 均无横向滚动、空白边、侧栏把手和底栏把手；虚拟老师脸部可见。

## P2：直播式对话与输入

任务：

- 用简单 Chakra/DOM 列表渲染现有消息，不复用桌面 chatscope 外观；
- 合并正式历史与临时流式字幕；
- 完成自动跟随、手动回看和“回到最新”；
- 完成文本发送、麦克风状态和回答打断；
- 添加空状态与持久权限提示；
- 键盘弹出时保持当前消息和输入可见。

退出条件：完成 20 轮语音 + 5 轮文本对话，无重复消息、看不见的最后一条消息、误发送或控件遮挡。

## P3：移动设置与异常状态

任务：

- 右上角增加 48px 设置入口；
- 增加移动设置面板，只保留课程、字幕、新课堂、重连、版本/隐私；
- 加载、断线、重连、权限拒绝、模型失败均有页面内反馈；
- 所有按钮补齐 `aria-label`、按下态、禁用态和键盘焦点；
- 支持系统“减少动态效果”。

退出条件：孩子不会看到服务器地址、模型参数或工具日志；断线和拒绝权限后家长能在页面内找到恢复动作。

## P4：真机视觉验收

最少设备/视口：

| 平台 | 视口/设备 | 必测 |
|---|---|---|
| iOS 小屏 | 375×667 级别 | 两条聊天 + 输入仍可见 |
| iOS 刘海/Dynamic Island | 当前 Xcode iPhone 17 Pro 模拟器 + 一台真机 | 顶部状态不被遮挡 |
| iOS 大屏 | 430px 以上宽度 | Live2D 不过度放大，聊天不过宽 |
| Android 小屏 | 360×800 | 48px 触控区、系统导航栏 |
| Android 主流 | 412×915 | 键盘、麦克风权限、后台恢复 |
| Android 低端/中端 | 一台真机 | Live2D + blur 无明显卡顿 |

每台执行：

1. 冷启动；
2. 首次开麦并允许权限；
3. 拒绝权限后恢复；
4. 连续语音 10 分钟；
5. 老师说话时插话和按钮打断；
6. 中文/英文键盘输入；
7. 键盘开关 10 次；
8. Wi-Fi/蜂窝切换或断网重连；
9. 前后台切换；
10. 打开设置、切换字幕、新建课堂并返回。

退出条件：所有阻断项通过，才重新 `cap sync` 并构建 Android Debug APK / iOS Debug App。

## 8. 验收清单

### 8.1 视觉

- [ ] 首屏一眼能看出“虚拟老师 + 对话 + 说话按钮”；
- [ ] 虚拟老师是视觉主体，聊天不会长期遮住脸；
- [ ] 对话区半透明、紧凑、可读，不像桌面聊天窗口；
- [ ] 顶部只有课堂状态和右上角设置；
- [ ] 没有侧栏、折叠条、附件、举手、群组、历史、窗口模式等桌面控件；
- [ ] 中文、英文和图标无 `?`、方框、空白或截断；
- [ ] 断线、开麦、监听和老师回答不只靠颜色区分；
- [ ] 刘海、Dynamic Island、状态栏、Home Indicator、Android 导航栏均不遮挡控件。

### 8.2 交互

- [ ] 设置、发送、麦克风、停止回答的点击区域均至少 48×48px；
- [ ] 点击麦克风才申请权限；
- [ ] 最后一条正式消息和流式字幕始终可见且不重复；
- [ ] 输入法组合文字不会被 Enter 提前发送；
- [ ] 键盘出现后输入框与最后消息仍可见；
- [ ] 设置可以关闭并返回原课堂，Live2D/Qwen 不重连；
- [ ] 断线可重连，加载失败可重试，权限拒绝有恢复说明；
- [ ] VoiceOver/TalkBack 能按顶部状态 → 对话 → 输入 → 麦克风 → 设置的合理顺序读取。

### 8.3 回归

- [ ] `npm run build:web` 通过；
- [ ] `VITE_MOBILE_APP=1` 构建展示新 UI；
- [ ] 普通 Web/Electron 构建继续展示原桌面 UI；
- [ ] `corepack pnpm run sync:android-ip-test` 通过；
- [ ] `corepack pnpm run sync` 通过；
- [ ] Android Debug APK 构建通过；
- [ ] iOS Simulator Debug 构建通过；
- [ ] Qwen 音频输入/输出、打断、口型和表情没有回归；
- [ ] 移动 UI 改动未触碰后端 Key、Token 或协议。

## 9. 明确不做

- 不重写为 Flutter、React Native、SwiftUI 或 Compose；
- 不增加另一套 WebSocket、消息存储或移动状态管理；
- 不复制抖音 UI、图标或动画；
- 不做礼物、点赞、关注、在线人数、排行榜或直播间用户聊天；
- 不做横屏、平板多栏、分屏和画中画；
- 不做复杂课程大厅、成就系统、付费页面或家长数据看板；
- 不增加字体包、动画库、虚拟列表库或 Capacitor Keyboard 插件，除非真机测试证明现有能力不够；
- 不在主界面展示模型、ASR、TTS、服务器和 Token 配置。

本轮完成标准只有一个：孩子打开 App 后，可以自然地看到老师、看懂当前对话，并通过底部一个明显的麦克风或文字框开始交流。
