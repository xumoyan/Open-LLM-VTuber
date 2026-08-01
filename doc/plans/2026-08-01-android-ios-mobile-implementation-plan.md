# Android / iOS 移动端实施计划

> 日期：2026-08-01  
> 状态：M0 已完成；M2 私测容器与 M3 原生工程已生成；Android Debug APK 已在 Java 21/SDK 36 环境构建通过，等待真机测试与 Xcode 完整解压
> 前置结果：Qwen Audio Realtime 桌面链路已由用户验证可用  
> 关联计划：[Qwen 实时语音接入计划](./2026-08-01-qwen-realtime-child-english-teacher-plan.md)；[儿童英语产品总计划](./2026-07-31-preschool-online-english-teacher-plan.md)

当前测试标识：App 名称 `AI 外教`、iOS bundle ID/Android application ID `ai.english.tutor`、Android Debug 测试后端 `http://221.216.142.92:18080`。

## 0. 结论

移动端不重写语音链路，也不在手机上运行 Python。最短可维护方案是：

1. 继续复用现有 React/Vite、客户端 VAD、PCM 播放和 Live2D 代码；
2. 先把 Web 构建做成可安装 PWA，用于 iPhone/Android 真机快速联调；
3. 正式 App 使用 Capacitor 8 包装同一份 Web 构建，生成 iOS/Android 原生工程；
4. Python FastAPI/Qwen relay 部署到常在线云服务器，手机只连接 `wss://`；
5. `DASHSCOPE_API_KEY` 永远只存在服务器环境中，不进入前端、IPA、AAB、YAML 或 Git；
6. 第一版只支持前台实时对话。切后台或锁屏立即停麦、停播并断开，不申请后台录音；
7. 继续使用已经跑通的 Qwen Audio Realtime WebSocket，不为了“手机端”改成 Flutter、React Native、LiveKit 或 WebRTC。

这条路线能让 Android、iOS、桌面 Web 和 Electron 共用一套实时协议。只有真机证明 Web Audio 或录音路由不能满足要求时，才补一个最小原生音频桥。

## 1. 目标与边界

### 1.1 本阶段交付

- 手机无需连接开发电脑即可与 Qwen 实时语音对话；
- Android/iOS 共用现有儿童外教和正常沟通 Prompt；
- 支持实时字幕、流式播放、打断、Live2D 口型；
- 首次点击麦克风时才申请权限；
- Wi-Fi/蜂窝切换后可恢复连接，但不会自动恢复录音；
- App 内不含 DashScope Key；
- 私测和公开商店发布分别有明确安全门。

### 1.2 本阶段不做

- 不把 Python、Qwen SDK 或本地大模型打进手机；
- 不做后台常驻麦克风、锁屏对话或 Android 前台服务；
- 不先写 Swift/Kotlin 双份 UI；
- 不做离线语音，因此暂不增加 service worker 缓存；
- 不做推送、广告、第三方分析、摄像头、定位、通讯录或广告 ID；
- 不先上 Redis、Kubernetes、微服务或自建账号系统；
- 不把当前 Mao/示例图标直接视为可商用正式资产。

## 2. 最终架构

```text
┌──────────────── Android / iOS App ────────────────┐
│ Capacitor 原生壳 + 本地 React/Vite 资源            │
│                                                    │
│ 麦克风 → MicVAD → 16 kHz PCM16 ───────────────┐   │
│ Live2D ← 音量/语义表情 ← 24 kHz PCM16 播放     │   │
└────────────────────────────────────────────────┼───┘
                                                 │ WSS
                                   短期会话凭证   │
┌──────────────── 云端 TLS 入口 ─────────────────▼──┐
│ Caddy：HTTPS/WSS、Origin/Host 边界、静态 PWA       │
│   /client-ws → 127.0.0.1:12393                     │
│   /healthz   → 127.0.0.1:12393                     │
└────────────────────────────────────────────────┬───┘
                                                 │
┌──────────────── FastAPI/Qwen Relay ────────────▼──┐
│ 鉴权后才创建 Qwen 会话；限流、时长和费用保护        │
│ 不保存原始音频；首版关闭云端聊天历史                │
└────────────────────────────────────────────────┬───┘
                                                 │ WSS + server-only key
                         ┌───────────────────────▼──┐
                         │ Qwen Audio Realtime      │
                         └──────────────────────────┘
```

### 2.1 两种客户端形态

| 形态 | 用途 | 资源位置 | 后端地址 |
|---|---|---|---|
| PWA | 最快真机验证、受邀内测 | HTTPS 站点 | 同源 `/client-ws` 或 `VITE_BACKEND_URL` |
| Capacitor App | TestFlight、Play 内测和正式发布 | IPA/AAB 包内 | 编译时 `VITE_BACKEND_URL=https://api.<domain>` |

PWA 不是另一套产品。它和原生壳使用同一个 `frontend/dist/web`，因此不维护两套 UI 和语音代码。

## 3. 当前状态

### 3.1 已具备

- 浏览器持续发送 16 kHz PCM16；
- Python 持久连接 Qwen Audio Realtime；
- 24 kHz PCM16 分片到达即播放；
- 用户插话时本地停播并取消 Qwen response；
- Qwen 音频能驱动 Live2D 口型；
- 桌面端已经完成第一轮人工验证。

### 3.2 M0 已实施

本计划开始时已经落地以下最小移动基础：

- WebSocket 地址不再固定为电脑的 `127.0.0.1`：
  - release Web 从页面 origin 自动得到 WS/WSS；
  - Vite dev 使用当前页面 hostname 的 `:12393`；
  - 可用 `VITE_BACKEND_URL` 指向云端；
- 新增 PWA manifest、iOS standalone meta 和应用图标输出；
- 不增加 service worker，避免语音产品被旧缓存卡住；
- 页面使用 `100dvh` 和 iOS safe-area；
- 手机默认收起侧栏，展开为全屏覆盖层；
- 手机侧栏触控区从 24 px 提升到 44 px；
- `npm run build:web` 已通过，manifest 和 596×596 临时图标已进入构建目录。

### 3.3 当前不能直接发布的原因

1. `/client-ws` 无客户端鉴权，连接后会立即创建付费 Qwen 上游；
2. 当前历史记录只按角色配置分目录，不按家庭/儿童隔离；
3. CORS 为 `*`，WebSocket 没有独立 Origin 校验；
4. `/asr`、`/tts-ws`、`/proxy-ws`、history/config/group 等非移动端入口仍可访问；
5. 服务没有单会话时长、并发、音频字节速率和每日费用上限；
6. 启动会检查/拉取 frontend submodule 并同步配置，不适合作为只读生产容器入口；
7. 前端仍需要补移动网络重连、用户手势解锁 AudioContext 和前后台生命周期；
8. 现有示例 Live2D、前端和图标的正式分发许可尚未确认。

因此，当前版本可以本机或私网真机联调，但不得直接把 `12393` 暴露公网。

## 4. 移动端交互和音频生命周期

### 4.1 首次开始

```text
孩子/家长点击大麦克风
  → 在同一个点击回调中 resume AudioContext
  → 请求麦克风权限
  → 权限成功后启动 VAD 和 PCM 上传
  → 服务端收到已鉴权的第一段音频时懒创建 Qwen 会话
```

服务端不再在 WebSocket 建连后自动发 `start-mic`。这既避免 iOS 无用户手势时的权限/静音问题，也符合儿童麦克风应由用户明确启动的预期。

### 4.2 正常对话

- 录音：浏览器/Capacitor WebView 的 `getUserMedia`；
- 回声消除、降噪、自动增益：继续使用现有浏览器约束；
- 输入：16 kHz、16 bit、单声道 PCM；
- 输出：24 kHz、16 bit、单声道 PCM；
- 播放：继续使用现有 Web Audio 分片队列；
- 口型：继续使用实际播放音频的 analyser/RMS；
- 表情：后续只增加少量 `happy/encourage/thinking/goodbye` 语义事件。

### 4.3 打断

用户开始说话时，客户端先同步停止全部已排程音频，再发送取消事件。迟到的旧 response 音频按 response ID 丢弃，不能重新开始播放。

### 4.4 切后台、锁屏和来电

收到 `visibilitychange`、`pagehide` 或原生 pause：

1. 1 秒内停止 VAD 和麦克风 track；
2. 清空 PCM 发送缓冲；
3. 停止当前播放和 Live2D 口型；
4. 取消当前 response 并关闭 WebSocket；
5. 回前台只恢复 UI/网络，不自动开启麦克风；
6. 显示“点一下继续上课”。

首版不声明任何后台音频能力。

### 4.5 断网和切网

- 非主动断开时按 1、2、4、8、10 秒退避重连；
- `online` 后可以立即发起一次重连；
- 同一时刻只允许一个重连计时器和一个 socket；
- 重连成功不自动开麦，避免网络恢复后意外录音；
- 主动退出课堂不重连。

## 5. 分阶段实施

## M0：移动 Web/PWA 基础（已完成）

改动范围：

- `frontend/src/renderer/src/context/websocket-context.tsx`
- `frontend/src/renderer/index.html`
- `frontend/src/renderer/public/manifest.webmanifest`
- `frontend/vite.config.ts`
- `frontend/src/renderer/src/index.css`
- `frontend/src/renderer/src/layout.tsx`
- `frontend/src/renderer/src/App.tsx`
- `frontend/src/renderer/src/components/footer/footer-styles.tsx`
- `frontend/src/renderer/src/components/sidebar/sidebar-styles.tsx`

退出条件：Web 构建通过；同源页面自动使用 WS/WSS；390 px 宽度不再被 440 px 侧栏撑破。

## M1：真机所需的 Web 音频可靠性

实施项：

1. `websocket-service.tsx` 增加单实例指数退避重连；
2. 麦克风点击回调同步创建/恢复 AudioContext；已在移动 build 的第一次点击中执行；
3. 去掉移动 build 的服务端自动 `start-mic`；已实施，桌面行为保持不变；
4. `vad-context.tsx` 监听后台/锁屏并彻底释放录音；
5. 回前台显示显式继续按钮，不自动录音；
6. 权限拒绝显示儿童可理解、家长可操作的恢复提示；
7. 隐藏手机首版不需要的 camera/screen/browser 控件；
8. 只在中端 Android 实测掉帧时，将 Live2D DPR 上限降到 1.5–2。

退出条件：iPhone 和 Android 各一台完成 10 分钟对话；切前后台 10 次无残留麦克风、重复 socket 或重复播放。

## M2：脱离电脑的云端 relay

### M2.1 最短私测

- 单人/单家庭优先使用 Tailscale 私网，不开放公网端口；
- 如必须公网私测，使用服务器环境中的 32-byte 随机 `MOBILE_ACCESS_TOKEN`；
- WebSocket 接受网络连接后只等待 `auth` 首帧，使用 `secrets.compare_digest` 校验；
- 鉴权成功前不得构造 ServiceContext、创建 Qwen 连接或读取历史；
- 临时 token 只适合受邀私测，不作为多家庭账号系统。

已实施：`docker-compose.mobile-test.yml` 以 Docker 启动容器；`--container` 跳过子模块拉取和配置写入；`MOBILE_TEST_MODE=1` 只暴露 `/client-ws`、`/healthz` 和客户端所需的形象静态资源；`MOBILE_ACCESS_TOKEN` 必须先作为 `auth` 第一帧通过，才创建 ServiceContext 或 Qwen 连接。连接建立本身不再启动 Qwen，首次点击麦克风发送 `connect` 后才创建会话。

### M2.2 公网 beta 必做

1. 新增 production/mobile API-only 启动模式：
   - 跳过 Git submodule 检查；
   - 跳过运行时配置升级写入；
   - 关闭 docs/openapi；
   - 只挂载 `/client-ws` 和 `/healthz`；
2. FastAPI 只监听 `127.0.0.1:12393`；
3. Caddy 只开放 80/443，自动提供 HTTPS/WSS；
4. release 只允许正式 HTTPS origin、实测的 Capacitor origin 和有效会话凭证；
5. 有 Origin 时必须命中 allowlist；Origin 只是一层约束，不替代鉴权；
6. Qwen `base_url` 在生产固定为官方 DashScope host，禁止远程切换；
7. 关闭 history/config/group/proxy/legacy ASR/TTS 消息；
8. 首版关闭聊天历史，不保存原始音频或转写；
9. 日志只记录随机 session ID、时延、字节数和错误码；关闭异常局部变量诊断；
10. 设置限制：
    - 每账号 1 个活跃会话；
    - PCM 平均约 64 KiB/s，128 KiB burst；
    - 单次最多 15 分钟；
    - 空闲 60 秒关闭；
    - 每日分钟额度；
    - DashScope 控制台费用告警/预算；
11. 断线必定关闭上游 Qwen；
12. 单进程内 dict/Semaphore 先满足 beta，只有多实例后才引入 Redis。

退出条件：未认证、错误 Origin、第二并发、超速/超大音频均在创建 Qwen 前被拒绝；服务端日志和客户端错误均不含 Key、token、音频或转写。

## M3：Capacitor Android/iOS 原生壳

已生成，产品标识已固定为 App 名称 `AI 外教`、iOS bundle ID/Android application ID `ai.english.tutor`。依赖锁定为 Capacitor 8.5.0；iOS/Android 生成目录位于根目录 `mobile/`，不进入 `frontend` 子模块。

建议根目录新增 `mobile/`，不要把生成的 iOS/Android 工程塞进 `frontend` Git 子模块：

```text
mobile/
├── package.json
├── capacitor.config.ts
├── android/
└── ios/
```

只增加四个同版本依赖：

- `@capacitor/core`
- `@capacitor/cli`
- `@capacitor/android`
- `@capacitor/ios`

配置原则：

- `webDir: '../frontend/dist/web'`；
- release 不设置 `server.url`，只加载包内资源；
- release 不允许 cleartext 或 mixed content；
- 固定并记录 `hostname`、`iosScheme`、`androidScheme`；
- 每次 build 后执行 `cap sync`；
- iOS/Android 生成目录作为源码提交；
- 开发者证书、provisioning profile、keystore 和密码不进入 Git。

Android 已声明 `INTERNET`、`RECORD_AUDIO`；iOS 已声明 `NSMicrophoneUsageDescription` 且固定竖屏。`sync:android-ip-test` 仅在 Android Debug 中允许当前 HTTP/WS IP；iOS 与 release 没有 ATS/cleartext 例外。

退出条件：Xcode/Android Studio 能在真机启动包内页面，且 release 包不依赖远程网页才能显示 UI。

## M4：平台权限和原生边界

### iOS

- `Info.plist` 增加 `NSMicrophoneUsageDescription`：说明“用于孩子与 AI 英语老师实时对话”；
- release 遵守 ATS，只连接 HTTPS/WSS，不加全局例外；
- 局域网调试确实需要时才增加 `NSLocalNetworkUsageDescription`；
- 不启用 Background Audio；
- 首轮继续用 Web Audio；只有静音键、扬声器或蓝牙路由实测失败时，才增加最小 `AVAudioSession` bridge。

### Android

- 只申请 `INTERNET` 和 `RECORD_AUDIO`；
- WebView 仅对可信 origin 的 `RESOURCE_AUDIO_CAPTURE` 授权，不能把权限请求中的全部 resources 一次性 grant；
- release network security config 禁止 cleartext；
- 不申请 Camera、Location、Contacts、Storage、Bluetooth 或 `AD_ID`；
- 不增加后台录音 foreground service。

退出条件：系统权限只在点击麦克风后出现；拒绝后能恢复；锁屏/后台 1 秒内系统麦克风指示消失。

## M5：受邀家庭 beta

多家庭前将临时 token 换为监护人账号/OIDC：

1. refresh token 仅存 iOS Keychain / Android Keystore；
2. WebView JavaScript 不读取 refresh token；
3. App 为每次课堂换一次短期、一次性 WebSocket ticket；
4. ticket 通过 WebSocket 第一帧发送，不放 URL query，避免代理日志泄露；
5. 服务端从认证 principal 得到 guardian/child ownership，不信客户端传来的 owner ID；
6. 首版仍默认不保存历史；若启用，按 `(guardian_account_id, child_profile_id)` 隔离并提供短 TTL 与一键删除；
7. 家长完成明确同意后才允许孩子首次使用麦克风；记录 consent version/time/account；
8. 只保存年龄段，不收孩子全名、完整生日、学校、照片或精确位置。

儿童语音/转写会传给阿里云百炼，隐私说明必须明确供应商、用途、处理地域、保留期限、撤回和删除方式。上线前需要向供应商确认所用 realtime 模型的实际日志保留、地域和儿童场景条款。

## M6：商店发布门

公开上架前必须同时满足：

- Apple App Privacy 和 Google Play Data Safety 与实际抓包一致；
- 家长区、外链、购买、账号和权限变更位于 parental gate 后；
- 无广告、追踪和第三方 analytics SDK；
- 内容安全不能只依赖 Prompt：完成儿童风险测试集、供应商安全能力验收和紧急 kill switch；
- 已确认 Open-LLM-VTuber-Web、VAD/WASM、Live2D runtime/角色、声音、图标和字体的分发/商业许可；
- 当前 Mao 和临时图标若未取得所需权利，替换为自有教师资产；
- 提交准确权限用途、隐私政策、数据删除入口和审核说明；
- TestFlight 与 Google Play Internal Testing 均通过真机回归。

## 6. 儿童主界面设计

移动首版保持简单，避免把桌面设置面板直接交给孩子：

```text
┌─────────────────────────────┐
│  网络/老师状态（很小）       │
│                             │
│                             │
│       虚拟英语老师          │
│       口型 + 轻表情          │
│                             │
│   Teacher: Can you... ?     │
│   你说：小猫                │
│                             │
│   [结束]   [ 大麦克风 ]     │
└─────────────────────────────┘
```

- 默认竖屏；老师占主要视觉区域；
- 主要按钮至少 48 dp，危险操作不贴近麦克风；
- 字幕宽度约 90–95%，最多显示必要内容；
- 连接失败使用“老师在重新连接”，不显示堆栈或供应商错误；
- 设置、后端地址、历史、模型和 Prompt 放家长区；
- camera/screen/browser/config switch 不进入儿童首版；
- Live2D 只增强兴趣，低性能设备可以退化为静态老师图 + CSS 呼吸/说话动画。

## 7. 部署形态

首个云端版本使用一台与 DashScope 所选地域网络良好的小型云主机即可：

```text
Internet :443
    ↓
Caddy
    ├── /                 frontend/dist/web（PWA 私测时）
    ├── /client-ws        reverse_proxy 127.0.0.1:12393
    └── /healthz          reverse_proxy 127.0.0.1:12393

FastAPI 127.0.0.1:12393，单 worker
DASHSCOPE_API_KEY 由服务器 secret/env 注入
```

首版不用 Docker Compose 也可以：systemd 管 Python，Caddy 管 TLS。若采用 Docker，则 production 镜像必须使用不会拉取 submodule、不会修改配置的 API-only entrypoint；镜像中也不能烘焙 Key。

## 8. 构建与联调命令

### 当前 PWA/Web 构建

```bash
cd frontend
npm run build:web
```

同源部署无需额外变量。前后端分域时：

```bash
VITE_BACKEND_URL=https://api.example.com npm run build:web
```

`VITE_BACKEND_URL` 只是公开后端地址，不能放任何 Key 或长期客户端 token。

### 当前原生同步

```bash
cd mobile
corepack pnpm run sync
corepack pnpm run open:ios
corepack pnpm run open:android
```

不要在产品标识未确定前执行/提交 `cap add ios/android`。

## 9. 验收矩阵

### 9.1 功能和体验

| 场景 | 通过标准 |
|---|---|
| 冷启动 | 进入老师画面，无 `/undefined`、模型资源 404 或白屏 |
| 首次权限 | 仅点击麦克风后弹窗；拒绝后可解释并重试 |
| 对话延迟 | 儿童停止说话到首个教师音频 warm P95 ≤ 2.5 秒 |
| 打断 | 开始插话到停止教师播放 P95 ≤ 500 ms |
| 连续对话 | 10 分钟无明显断音、重复播放、WS 死连接或持续内存增长 |
| 前后台 | 后台 1 秒内停麦；回前台必须手动继续 |
| 切网 | Wi-Fi/蜂窝切换可重连，不自动恢复录音 |
| 音频设备 | 扬声器、有线/蓝牙耳机插拔和来电后不崩溃 |
| Live2D | 24 kHz 播放不卡顿，口型同步；中端 Android 目标 ≥24 fps |
| 小屏 | iPhone 390×844、Android 360×800 无溢出，底部避开 Home Indicator |

### 9.2 安全和费用

- 未认证、过期、错误 audience/ticket 在 Qwen 构造前失败；
- 恶意 Origin 被拒；
- 第二并发会话被拒；
- 超大或超速 audio 以策略错误关闭；
- A 家庭无法读取或删除 B 家庭数据；
- mobile mode 拒绝 config/history/group/proxy/legacy 消息；
- 断线后上游 Qwen 一定关闭；
- IPA/AAB/JS bundle 中搜索不到 `DASHSCOPE_API_KEY`、`sk-` 或长期 token；
- 日志、崩溃信息和前端错误中没有 token、音频、转写或完整 Prompt；
- 所有远程流量只走 HTTPS/WSS。

### 9.3 真实设备

最低设备集：

- 当前 iPhone 一台；
- 一台较旧但仍在目标支持范围内的 iPhone；
- 一台主流 Android；
- 一台中端/较旧 Android。

模拟器不能替代麦克风、音频路由、WebView 生命周期、耗电和蜂窝切网测试。

## 10. 并行工作包

各工作包应保持小提交，主仓库与 `frontend` 子模块分别提交，不混入无关修改。

| 工作包 | 文件范围 | 前置 | 结果 |
|---|---|---|---|
| A：Web 音频生命周期 | `frontend/...vad-context`、audio manager、mic hooks | M0 | M1 完成 |
| B：WS 重连 | `frontend/...websocket-service` | M0 | 切网可恢复 |
| C：移动安全入口 | routes/server/websocket handler + 小测试 | 无 | M2 鉴权、限流、消息 allowlist |
| D：云部署 | production entrypoint、Caddy/systemd 示例 | C | 手机脱离电脑 |
| E：Capacitor 壳 | `mobile/` | 第 11 节决策 | iOS/Android 工程 |
| F：真机 QA | 独立测试记录 | A–E | TestFlight/Play 内测门 |
| G：隐私/资产 | 家长同意、政策、许可清单 | beta 前 | 可邀请家庭/上架 |

本轮已经完成 A/B 的架构审计、C/D 的安全审计，实施了 M0、M2 私测入口和 M3 原生壳。下一批代码从 M1 的前后台/重连真机修复开始；M4 只在 Web Audio 真机失败时增加原生音频桥。

## 11. 继续原生实施前需要确定的 5 个值

以下值已经确定并写入原生工程：

1. App 显示名：`AI 外教`；
2. iOS bundle ID：`ai.english.tutor`；
3. Android application ID：`ai.english.tutor`；
4. Android Debug 测试后端：`221.216.142.92:18080`。

仍需确定：分发目标（仅自己安装、受邀家庭、TestFlight/Play 内测或公开商店）和正式 HTTPS/WSS 域名。纯 IP 只能用于 Android Debug 私测，不能作为 iOS 或 release 的实时服务地址。

此外，在受邀家庭前确定：目标年龄段、是否保存转写/历史、数据地域、Apple Developer/Google Play 账号归属和正式教师形象资产。

剩余值不阻塞 M1；会阻塞 iOS 真机实时联调、签名和商店发布。

## 12. 风险和回退

| 风险 | 最小处理 | 回退 |
|---|---|---|
| iOS Web Audio 被自动播放策略阻止 | 在麦克风点击手势中解锁 | 显示“点一下继续”，不后台自动播 |
| WebView 录音/蓝牙路由不稳定 | 先真机量化 | 只为失败平台增加最小原生 audio bridge |
| Live2D 导致掉帧/发热 | 实测后限 DPR | 静态老师图 + CSS 动画 |
| 移动网络频繁断开 | 单 socket 退避重连 | 手动继续课堂，不自动恢复麦克风 |
| 公网被盗刷 | 鉴权前不连 Qwen + 并发/时长/额度 | 立即关闭公网入口/轮换 token |
| 儿童输出安全不足 | 受邀陪同 beta + 测试集 + kill switch | 不进入真实儿童/公开发布 |
| 示例资产许可不足 | 仅内部原型 | 替换为自有静态/Live2D 教师资产 |
| Capacitor 版本/商店要求变化 | 生成原生工程时锁定并重查官方文档 | 保留可工作的 PWA 私测路径 |

## 13. 官方实施依据

- [Capacitor：为现有 Web App 添加原生平台](https://capacitorjs.com/docs/getting-started)
- [Capacitor 8 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor 配置与本地 Web 资源](https://capacitorjs.com/docs/config)
- [Capacitor 安全指南](https://capacitorjs.com/docs/guides/security)
- [Qwen Audio Realtime 官方指南](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-user-guides)
- [Apple 麦克风用途说明](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSMicrophoneUsageDescription)
- [Apple ATS / 安全网络连接](https://developer.apple.com/documentation/security/preventing-insecure-network-connections)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Android WebView PermissionRequest](https://developer.android.com/reference/android/webkit/PermissionRequest)
- [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config)
- [Google Play Families Policy](https://support.google.com/googleplay/android-developer/answer/9893335)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [儿童个人信息网络保护规定](https://www.cac.gov.cn/2019-08/23/c_1124913903.htm)
- [阿里云百炼隐私说明](https://help.aliyun.com/zh/model-studio/privacy-notice)

版本、商店政策和供应商条款会变化。生成原生工程和每次发布前应重新核对锁定版本；本计划不替代目标市场的法律与许可证审核。
