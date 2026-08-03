# Qwen 实时语音的数字人渲染接入评估与实施计划

> 日期：2026-08-03
> 状态：可交给实现模型执行；先做可行性门，不直接替换现有链路
> 目标仓库：`Open-LLM-VTuber` 及 `frontend` 子模块
> 前置方案：`2026-08-01-qwen-realtime-child-english-teacher-plan.md`
> 核心原则：语音实时性优先，数字人失败时必须自动回退到现有 Live2D

## 0. 最终结论

数字人可以接入，但不能把“Qwen Audio Realtime”和“Talking Head 模型”当成可以直接互连的同一种 WebSocket 服务。

当前项目已经具备一条低延迟、可打断的实时链路：

```text
麦克风
  ⇄ 当前 /client-ws
  ⇄ Qwen Audio Realtime
  → 24 kHz PCM16 audio.delta
  → Web Audio 立即排程播放
  → AnalyserNode 实际播放 RMS
  → Live2D ParamMouthOpenY / LipSync 参数
```

因此当前缺少的不是“口型功能”，而是“真人或 2.5D 老师画面”。现有 Live2D 口型几乎不增加额外延迟，应继续作为稳定默认值和故障回退，不得删除。

本计划采用以下顺序：

1. **首选实验：在当前前端内验证 DH_live mini 的 Web 本地渲染。**它的数字人部分运行在浏览器/WebView，本阶段无需新增 GPU 服务、WebRTC、Redis、Worker 或第二套会话框架。
2. **只有 DH_live 的协议、真机性能和授权同时通过，才接入当前产品。**Qwen 音频仍由当前 `AudioManager` 立即播放，同一份 PCM 旁路给数字人；数字人不得阻塞或延迟声音。
3. **DH_live 不通过时保留 Live2D。**若后续确实要求更真人的效果，再用带 NVIDIA GPU 的独立机器评估 OpenTalking/LiveTalking，不在当前 CPU Docker 服务里硬塞重模型。
4. **FeatherTalk 是旧 Ultralight-Digital-Human 的更合适后继实验路线。**它适合后续做自有、可训练的端侧模型，但目前仍偏研究，不能作为第一期产品依赖。
5. **OpenTalking 值得参考，但不建议现在替换当前项目。**它是完整编排框架，不是一个可以直接插入的口型 SDK；其 `direct_ws` 连接的是数字人模型服务，而不是 Qwen 音频对话服务。

## 1. 对补充信息的核验

### 1.1 OpenTalking：项目真实，但“直接指向 Qwen”不成立

OpenTalking 的定位确实与数字人产品接近：它已经包含 WebUI、会话、STT、LLM、TTS、字幕事件、打断、WebRTC、模型状态以及本地/远端数字人后端。官方也明确把它描述为“数字人产品与模型服务之间的编排层”。[OpenTalking 官方仓库](https://github.com/datascale-ai/opentalking) / [官方文档](https://datascale-ai.github.io/opentalking/latest/)

但是必须区分两条完全不同的协议：

```text
Qwen Audio Realtime WebSocket
  输入：孩子的 PCM 音频
  输出：老师的 PCM 音频 + 字幕 + 回合事件

OpenTalking direct_ws
  输入：OpenTalking 已经生成的老师音频 + Avatar 资料
  输出：数字人视频帧/媒体
```

OpenTalking 的支持矩阵将 `direct_ws` 定义为“model-specific remote service”，典型对象是 FlashHead 或自定义单模型数字人服务；它不是通用的语音模型入口。[OpenTalking 支持矩阵](https://datascale-ai.github.io/opentalking/latest/en/deployment/support-matrix/)

更重要的是，官方 `Direct WebSocket` 页面截至本计划日期，协议边界、请求/响应契约和验证章节仍然全部是 `TODO`。不能把“存在 backend 名称”误认为已经有一个稳定、文档完整、能直连任意 WebSocket 的协议。[OpenTalking Direct WebSocket](https://datascale-ai.github.io/opentalking/latest/en/model-support/runtime-backends/direct-websocket/)

所以不能执行下面这种配置：

```text
OPENTALKING_*_WEBSOCKET_URL = wss://dashscope.../realtime
```

Qwen 不会返回 OpenTalking 需要的视频帧，OpenTalking 也不会把 DashScope 事件自动翻译成数字人模型事件。若采用 OpenTalking，只有两条真实路线：

- 把当前产品整体迁移到 OpenTalking，并为 Qwen Audio Realtime 新增一条“外部音频输入/跳过 STT、LLM、TTS”的编排路径；这是大迁移。
- 保留当前产品，只复用 OpenTalking 的某个数字人后端服务；此时仍需自己写音频到视频的适配器，OpenTalking 的 UI、会话、角色、字幕和语音层大部分都不会被使用。

当前项目已经有儿童 Prompt、角色切换、手机 UI、WebSocket 认证、Qwen 回合和打断、字幕、音频播放及生命周期恢复。为了数字人画面替换整套编排，改动和回归风险大于收益。

### 1.2 OpenTalking Mock：适合评估它自己，不验证本项目接入

Mock 模式能验证 OpenTalking 自己的 API、LLM、TTS、字幕、WebRTC 和静态画面，官方也这样定义它。[OpenTalking Quick Start](https://datascale-ai.github.io/opentalking/latest/en/quick-start/)

它不能证明以下关键问题：

- 当前 Qwen 的 24 kHz 原始 PCM 能否无缝驱动某个 THG；
- 现有 iOS/Android 客户端是否能稳定解码并播放生成画面；
- 当前打断、切角色、后台恢复能否同步停止数字人；
- 额外视频链路会给语音首包增加多少延迟。

因此 Mock 只作为可选的产品体验参考，不是本计划的第一开发步骤。

### 1.3 Fay：成熟完整，但同样位于错误的层

Fay 是面向 2.5D、3D、移动端、PC、网页和业务系统的完整 Agent/数字人连接框架，适合从零搭建企业数字人应用。[Fay 官方仓库](https://github.com/xszyou/Fay)

当前项目并不缺 Agent 控制器、业务连接或完整会话壳，只缺音频后的画面渲染。除非产品决定整体迁移，否则引入 Fay 仍会产生两套会话、模型配置、音频状态和前端，首期不采用。

### 1.4 Linly-Talker：原有“不支持实时”结论已经过时

截至 2026-02，Linly-Talker 已发布独立的 Linly-Talker-Stream，官方说明它使用 WebRTC、支持全双工和打断。因此不能再以“明确不支持实时”为由排除它。[Linly-Talker 官方仓库](https://github.com/Kedreamix/Linly-Talker)

它仍然是另一套完整 ASR/LLM/TTS/Avatar 流水线，并没有比保留当前 Qwen 链路更小的接入面，所以本期仍不选，但理由是“重复现有系统”，不是“没有实时能力”。

## 2. 候选技术结论

| 候选 | 实际层级 | 实时与硬件 | 与当前项目匹配度 | 本计划决策 |
| --- | --- | --- | --- | --- |
| 现有 Live2D | 前端参数动画 | 真机本地，额外延迟接近零 | 已接好 Qwen PCM、打断和生命周期 | 保留默认与回退 |
| DH_live mini | Web/WebView 本地 2.5D 渲染 | 官方目标是无 GPU、Web 本地 | 接入面最小，但要验证 PCM 分片、真机与授权 | 第一实验候选 |
| FeatherTalk | 可训练的轻量音频驱动模型 | 移动友好 ONNX；仍偏研究，需要为人物训练 | 自主可控，但训练和端侧运行时工作量较大 | 第二实验候选 |
| OpenTalking | 完整产品编排层 + THG 后端 | 本地/远端 GPU、WebRTC | 大量重复现有 UI、Qwen、角色和会话 | 不替换；GPU 阶段参考 |
| Fay | 完整 Agent/数字人业务框架 | 依具体数字人后端而定 | 不是渲染器 SDK，重复现有系统 | 不接入 |
| LiveTalking | 完整实时数字人/WebRTC 框架 | Wav2Lip/MuseTalk 通常需 NVIDIA GPU | 有成熟实时视频经验，但部署和网络更重 | GPU 阶段对照组 |
| MuseTalk | THG 模型引擎 | 高质量，实时通常依赖较强 GPU 和外部流式封装 | 当前 CPU 服务和手机端不适合 | 暂不接 |
| LivePortrait | 图像/视频驱动肖像动画 | 不是独立的流式音频口型入口 | 仍需音频驱动和实时服务胶水 | 暂不接 |

### 2.1 DH_live 为什么只做“受控实验”

官方仓库要求模型输入为 16 kHz 单声道 WAV；Web demo 的部署结构则明确把数字人放在 Web 本地，使用 `DHLiveMini.wasm`、人物视频与 `combined_data`，并要求 WebCodecs 运行于 HTTPS 或 localhost 安全上下文。[DH_live 官方仓库](https://github.com/kleinlee/DH_live) / [DH_live Web demo](https://github.com/kleinlee/DH_live/blob/main/web_demo/README.md)

这与当前 Capacitor WebView 很接近，但存在三个发布前阻断项：

1. Qwen 返回的是 24 kHz PCM16 delta，不是完整 16 kHz WAV。必须实测该 WASM 能否连续接收短音频块，以及最小无断裂块长，不能只看 demo 宣传。
2. README 写 MIT，但仓库页面没有独立 `LICENSE` 文件；Web 形象资源去 logo/商业应用又要求额外授权。提交 WASM、人物包或发布 App 前，必须取得清晰的代码、二进制和形象授权说明。[DH_live 授权说明所在 README](https://github.com/kleinlee/DH_live)
3. iOS WKWebView、Android System WebView 对 WebCodecs/WebGL/WASM 的支持和内存表现必须用真机测。桌面 Chrome 跑通不算完成。

### 2.2 FeatherTalk 为什么替代旧 Ultralight 作为后续候选

FeatherTalk 是 Ultralight-Digital-Human 作者整理后的轻量后继方案，增加了约 3.36M 参数的 FeatherHuBERT、MobileOne 风格 UNet、ONNX 导出和流式推理；官方建议移动端从重参数化 ONNX + FP16 开始。[FeatherTalk 官方仓库](https://github.com/anliyuan/FeatherTalk)

但它仍有明显工程门槛：

- 需要用清晰口播视频训练具体人物；
- 需要自己完成 iOS/Android/WebView 推理运行时和渲染集成；
- C++ 示例目前是独立离线推理，仓库也明确标注为研究型；
- 大型 checkpoint、训练结果和预训练二进制不随仓库分发。

它适合“DH_live 授权或黑盒 WASM 不可接受、且愿意训练自有形象”时进入第二阶段，不适合为了第一张会动的老师画面立刻引入。

## 3. 推荐目标架构

### 3.1 第一阶段：端侧旁路渲染，不改语音主链路

```text
                         ┌──────────────────────────────┐
Qwen audio.delta 24k PCM │ 现有 AudioManager            │
────────────────────────→│ 解码、cursor 排程、立即播放   │
                         │ 打断/clear/后台恢复的唯一 owner│
                         └───────────┬──────────────────┘
                                     │ 同一份已解码 PCM + responseId
                    ┌────────────────┴────────────────┐
                    │                                 │
          现有 Live2D RMS                     DH_live 实验桥
          默认/自动回退                       24k→16k 连续重采样
                                              → 短 WAV 块/实测协议
                                              → WASM + WebGL Canvas
```

硬约束：

- Qwen 音频播放永远走现有 `AudioManager`，不让数字人模块再次播放声音，避免双声和回声。
- 数字人只是同一份 PCM 的观察者；推理慢、初始化失败或画面掉帧时不得反压 WebSocket 或音频。
- 第一阶段不为了音画同步延迟声音。若本地渲染跟不上，应回退 Live2D，而不是牺牲老师回复速度。
- `responseId` 是画面与声音的代次标识；清除、打断、切角色或重连后，旧 response 的迟到数据必须丢弃。
- 首期不新增 WebRTC。只有“视频在服务器生成”后，WebRTC 才比现有 JSON WebSocket 更合理。

### 3.2 配置只增加实际需要的两个字段

在 `character_config` 中增加：

```yaml
avatar_renderer:
  mode: live2d       # live2d | dh_live
  asset_id: sunny_teacher_v1
```

规则：

- 默认 `mode: live2d`，旧角色文件无需修改即可继续工作。
- 第一阶段只实现 `live2d` 与 `dh_live`，不建立通用 provider factory。
- `asset_id` 只能是受控标识符，不能接收任意 URL 或本地路径。
- 只有一个已授权教师素材进入产品时，只提交一个素材包，不提前建设 Avatar CMS。
- DH_live 的分片时长允许保留一个真机校准值；其余采样率和格式是协议常量，不做设置 UI。

### 3.3 素材路径

POC 通过后，将已授权的最小人物包放入前端静态资源：

```text
frontend/src/renderer/public/digital-human/sunny_teacher_v1/
  manifest.json
  idle.mp4
  combined_data.json.gz
```

WASM/JS 运行时放在：

```text
frontend/src/renderer/public/digital-human/runtime/dh-live/
```

这样 Web 版由当前 FastAPI 静态站点提供，Capacitor App 由本地 bundle 提供，不新增素材服务器。人物多到 App 体积不可接受后，再设计按需下载、哈希校验和缓存；首期不做。

未经授权确认，不允许把 DH_live 的 WASM、示例人物视频、`combined_data` 或 logo 去除后的资源提交到仓库。

## 4. 分阶段实施任务

### Phase 0：冻结基线与授权门（不改产品代码）

#### 任务

- [ ] 用当前 Sunny 老师录制一组 Qwen 输出样本：连续短句、长句、快速打断、连续两回合、切后台再回来。
- [ ] 保存原始 `audio.delta` 拼接后的 24 kHz PCM 和 `responseId` 时间线，仅使用无隐私测试语料。
- [ ] 记录现有 Live2D 的语音首包、口型停止、CPU、内存和 10 分钟稳定性，作为不得退化的基线。
- [ ] 确认 DH_live 源码、`DHLiveMini.wasm`、示例人物包、去 logo 与商业 App 的授权边界；没有书面或明确许可证时只做本地评估，不进入主分支和安装包。
- [ ] 确认教师参考视频/图像、声音与最终衍生形象拥有移动 App 商用和儿童产品展示权利。

#### 通过标准

- 能用同一组离线音频重复比较不同渲染器。
- 授权清单分别覆盖代码、WASM/模型、人物素材和品牌/logo；任何一项不清楚，发布状态标记为阻塞。

### Phase 1：DH_live 隔离 POC

#### 任务

- [ ] 在独立 POC 页面加载官方 WASM、一个有权测试的人物包和 idle 视频，不接当前 React 页面。
- [ ] 先喂完整的 16 kHz 单声道 WAV，确认官方最小路径能动嘴。
- [ ] 将同一音频切成 100、200、400、800 ms WAV 块，测出能连续驱动、无明显重启或嘴部跳变的最小块长。
- [ ] 验证 WASM 是否只消费音频做推理而不自行输出声音；若会播放，必须找到官方静音入口，否则判定不适合旁路接入。
- [ ] 在浏览器实现无依赖、保持相位连续的 24 kHz→16 kHz PCM 重采样与最小 WAV header 封装；不得引入 FFmpeg/WASM 音频库完成几十行可解决的转换。
- [ ] 测试 `clear`：输入中途停止后，嘴部在 150 ms 内停止，旧缓存不能在下一回合继续播放。
- [ ] 在一台 iOS 真机和一台 Android 真机验证 WebCodecs、WASM、WebGL、后台恢复、屏幕旋转和内存。

#### 必留检查

- 为重采样/WAV 封装增加一个无测试框架的最小单元测试：1 秒 24 kHz 正弦波应输出约 16000 个样本；WAV header 的采样率、声道、位深和 data 长度正确。

#### Go / No-Go

只有同时满足以下条件才进入 Phase 2：

- iOS 和 Android 真机均能稳定初始化；
- 10 分钟会话没有持续内存增长或 WebView 崩溃；
- 数字人口型相对实际声音的 P95 延迟不高于 250 ms；
- 画面稳定达到 24 fps 左右，交互线程没有持续长任务；
- 语音首包相对现有版本增加不超过 50 ms；
- 打断后嘴部停止 P95 不高于 150 ms；
- 授权门通过。

任一关键项失败：停止 DH_live 产品接入，保留 Live2D，转 Phase 5 评估。

### Phase 2：接入当前前端，保持默认关闭

#### 后端文件

- `src/open_llm_vtuber/config_manager/character.py`
  - 新增最小 `AvatarRendererConfig`，只含 `mode` 与受控 `asset_id`。
  - 默认值为 `live2d`，兼容所有旧 YAML。
- `src/open_llm_vtuber/websocket_handler.py`
  - 初次连接和角色切换的 `set-model-and-conf` 增加 `avatar_renderer`。
- `src/open_llm_vtuber/service_context.py`
  - 角色切换事件发送同样的渲染配置；Live2D 仍正常初始化，供失败回退。
- `characters/en_child_english_teacher.yaml`
  - 仅在素材授权和 POC 通过后，将 Sunny 设置为 `dh_live`。

#### 前端文件

- `frontend/src/renderer/src/context/character-config-context.tsx`
  - 保存当前 `avatarRenderer`，默认 `{mode: 'live2d'}`。
- `frontend/src/renderer/src/services/websocket-handler.tsx`
  - 从 `set-model-and-conf` 更新渲染模式；角色切换先清理旧数字人实例。
- `frontend/src/renderer/src/utils/audio-manager.ts`
  - 在已经完成 Base64→Float32 解码、计算 `startAt` 后，增加一个可选 PCM 观察回调。
  - `clearRealtime()` 同时通知观察回调清空，但音频逻辑仍是唯一播放 owner。
- 新增 `frontend/src/renderer/src/components/canvas/dh-live-avatar.tsx`
  - 只负责加载人物素材、WASM/WebGL、接收 PCM 和销毁资源。
  - 加载失败、帧率不足或 WebGL context lost 时通知回退，不自行重连 WebSocket。
- `frontend/src/renderer/src/App.tsx`
  - 当前角色为 `dh_live` 且组件 ready 时显示数字人 Canvas；其他情况继续显示现有 `<Live2D />`。

#### 明确不改

- 不修改 `src/open_llm_vtuber/realtime/qwen_realtime.py` 的 Qwen 上游协议。
- 不新增视频 frame WebSocket 事件。
- 不让 Python 服务器重采样或处理视频。
- 不替换当前字幕、聊天历史、角色选择、麦克风、打断和移动端布局。
- 不加入 OpenTalking/Fay 依赖。

### Phase 3：打断、切角色与移动生命周期

#### 状态规则

| 事件 | 数字人动作 |
| --- | --- |
| `response.started` | 建立新 `responseId` 代次，清除不属于它的积压 |
| `audio.delta` | AudioManager 排程声音后，旁路同一 PCM 给当前代次 |
| `audio.done` | 标记输入结束；等待本地视觉缓存消费完 |
| `playback.clear` / `response.interrupted` | 立即清 PCM/WAV/帧缓存并回 idle |
| 角色切换 | 销毁旧 WASM/视频/WebGL 资源，再加载新角色；加载期间显示 Live2D |
| WebSocket 重连 | 不复用旧 `responseId`；数字人保持 idle |
| App 进入后台 | 停渲染循环和 idle video，清回答缓存 |
| App 回到前台 | 恢复 WebGL 后再接受新 PCM；失败则 Live2D 回退 |

#### 错误回退

以下错误只影响画面，不能中断语音会话：

- WebCodecs、WebAssembly 或 WebGL 不支持；
- 人物素材 404、清单不匹配或解压失败；
- WASM 初始化异常；
- WebGL context lost；
- 连续 3 秒低于 18 fps；
- 内存保护或系统回收导致 renderer 失效。

回退时只记录不含音频内容的结构化原因，并显示现有 Live2D。用户无需手工重连。

### Phase 4：验收与灰度

#### 设备矩阵

- [ ] 当前开发 iPhone 真机；
- [ ] 一台较老但仍受支持的 iPhone；
- [ ] 一台中端 Android；
- [ ] 一台低端 Android；
- [ ] 桌面 Safari/Chrome 作为 Web 回归；
- [ ] Docker 服务仍使用现有 `18081` 外部端口，无新增公网端口。

#### 场景

- [ ] 孩子只说一个短词 `dog`，老师立即回答，嘴部不漏掉短音频。
- [ ] 连续 20 个一词跟读回合，不积累上一回合的口型。
- [ ] 老师长句中途打断；允许打断和禁止打断两个角色设置都正确。
- [ ] 切到后台 30 秒后回来继续对话。
- [ ] 断网、恢复网络、WebSocket 重连后继续语音。
- [ ] Sunny 与普通英文陪伴角色来回切换 10 次。
- [ ] 10 分钟和 30 分钟持续会话。
- [ ] 蓝牙耳机、扬声器、静音开关和音频路由变化。

#### 指标

| 指标 | 目标 |
| --- | --- |
| Qwen 音频首包附加延迟 | P95 ≤ 50 ms |
| 口型相对实际播放声音 | P95 ≤ 250 ms |
| 打断到嘴停 | P95 ≤ 150 ms |
| 稳态帧率 | 约 24–25 fps，不持续低于 18 fps |
| 后台/前台循环 | 10 次后可继续对话，无重复声音 |
| 30 分钟资源表现 | 无持续增长、崩溃、黑屏或 WebGL context leak |

灰度先只对 Sunny 角色和内部测试开启；其他角色继续 Live2D。达到指标后再考虑作为默认形象。

### Phase 5：只有端侧路线失败或需要更高真实度时，才评估 GPU 视频服务

#### 5.1 推荐评估方式

不要立刻迁移 App。先在独立 GPU 环境做同一组录音的 A/B：

1. OpenTalking + QuickTalk；
2. OpenTalking/LiveTalking + MuseTalk；
3. 需要自有轻量模型时的 FeatherTalk。

比较画质、首帧、持续帧率、显存、并发、打断清理、人物训练成本和授权。OpenTalking 官方给出的 QuickTalk 参考是 RTX 3090 上约 35 fps、约 3.8 GiB 显存；MuseTalk 官方路径通常要求更高显存，不能按当前 CPU Docker 预算估算。[OpenTalking 模型与部署参考](https://github.com/datascale-ai/opentalking)

#### 5.2 若最终选择服务器生成视频

届时目标链路才调整为：

```text
Qwen audio.delta
  → 独立 THG GPU 服务（按 session/responseId 输入）
  → 音视频带时间戳
  → WebRTC
  → iOS/Android/Web 客户端
```

需要新增的真实能力包括：

- 独立 THG 容器和 GPU 调度；
- session 创建、人物预热、输入音频、清除/打断、销毁和健康检查协议；
- WebRTC 信令、ICE/STUN/TURN 与弱网恢复；
- 服务端音画时间戳、jitter buffer 和迟到帧丢弃；
- 并发与显存隔离；
- 合成内容标识、水印和第三方模型许可证检查。

这是一项新的部署工程，不应伪装成给当前 WebSocket 多加几个消息类型。

#### 5.3 OpenTalking 的合理使用方式

OpenTalking 进入候选的条件是：

- 已有 Linux + NVIDIA GPU；
- 决定由服务器生成真人数字人视频；
- 愿意采用或迁移到它的 WebRTC/session/worker 体系；
- 实测模型和协议，而不是依赖尚未完成的 `direct_ws` 文档。

采用前做一次二选一决策，不允许长期维持两套编排：

- **整体迁移**：OpenTalking 成为会话和媒体 owner，当前项目前端只做产品 UI；需要正式迁移 Qwen Realtime、角色、Prompt、认证和移动生命周期。
- **独立渲染服务**：当前项目继续做会话 owner，只调用一个明确的 audio-to-video 服务；若 OpenTalking 无法以这个窄接口运行，则直接使用其底层模型服务，不保留无用的编排层。

## 5. 实现顺序与提交边界

其他实现模型应按以下独立提交执行，前一门未通过不得提前实现后一阶段：

1. `docs: add digital-human feasibility results`
   - Phase 0 基线、授权结论、录音样本说明；不含第三方二进制。
2. `spike: validate dh-live pcm streaming on ios and android`
   - 隔离 POC、重采样/WAV 检查、真机数据；POC 不默认进入产品构建。
3. `feat: add opt-in dh-live renderer with live2d fallback`
   - 配置、角色事件、前端组件和素材加载；默认关闭。
4. `fix: synchronize renderer interruption and app lifecycle`
   - 打断、切角色、后台/前台、WebGL 丢失和自动回退。
5. `test: add mobile digital-human acceptance evidence`
   - 设备矩阵、指标和已知限制。

每个提交都必须同时更新主仓库与 `frontend` 子模块指针；不得直接修改 `frontend/dist` 压缩产物。

## 6. 完成定义

第一阶段“完成”不是“看到嘴动了一次”，而是：

- Qwen 语音质量、首包和打断不退化；
- iOS/Android 真机连续短词和多回合都能稳定驱动；
- 后台、重连和角色切换不会导致无响应、双声或旧口型复活；
- 数字人失败自动回退 Live2D，语音仍然可用；
- 第三方代码、WASM、模型、人物素材和 logo 的授权可追溯；
- 只有通过量化门后，Sunny 角色才默认启用数字人。

在此之前，现有 Live2D + Qwen PCM 口型就是产品基线，不删除、不降级，也不引入 OpenTalking/Fay/WebRTC 增加系统复杂度。
