# Qwen 实时语音的数字人渲染接入评估与实施计划

> 日期：2026-08-03（个人使用版，替换原多设备/待授权版本）
> 状态：可交给实现模型执行
> 目标仓库：`Open-LLM-VTuber` 及 `frontend`
> 前置方案：`2026-08-01-qwen-realtime-child-english-teacher-plan.md`
> 核心原则：语音实时性优先，数字人失败时必须自动回退到现有 Live2D

## 0. 最终结论（个人使用前提）

**使用场景已锁定**：仅自己使用，无对外用户；后端跑在自己的 Mac mini M4 基础版上；客户端主要是 iOS（Capacitor App），Android 不是必须。**目标效果是"像在跟真人视频聊天"**——真人形象 + 音画同步口型 + 随对话情绪变化的表情/状态，而不是当前的二次元 Live2D 观感。优先级是免费和能跑起来，不是画质极致或多设备兼容。

在这个前提下，原计划里两个最重的门槛直接消失：

- **授权门**：不发布、不分发、不商用。只要用**自己录的素材**（自己出镜的口播视频/照片）做数字人形象，就没有第三方授权问题——这也是成本最低的做法，不用去纠结 DH_live 示例素材的 License 边界。
- **设备矩阵**：不用测多台新旧 iPhone/Android，只要在自己那台 iPhone 上跑起来、体验过得去即可。

保留不变的是协议层面的硬约束（这些跟"个人使用"无关，是接入本身的技术门槛）：

```text
麦克风
  ⇄ 当前 /client-ws（跑在 Mac mini 上）
  ⇄ Qwen Audio Realtime
  → 24 kHz PCM16 audio.delta
  → Web Audio 立即排程播放
  → AnalyserNode 实际播放 RMS
  → 数字人口型渲染（客户端）
```

技术选型结论：

1. **渲染继续放在 iOS 客户端（DH_live mini，WASM+WebGL，跑在 Capacitor 的 WKWebView 里）。** 这是免费方案里工程量最小的一条——Mac mini 上不需要新增任何 GPU 推理、视频编码或 WebRTC，后端角色不变，只做音频中转。
2. **"情绪"用一个便宜的技巧实现，不训练情绪模型**：复用当前项目已有的 `[emotion]` 关键词提取模式（`live2d_model.py` 的 `extract_emotion`/`remove_emotion_keywords`，配合 `model_dict.json` 里的 `emotionMap`），让 Qwen 的实时文本转写里带一个情绪标签，前端据此切换几段自己录制的"待机/情绪基础视频"（平静、开心、思考、惊讶），DH_live 只负责在当前这段基础视频上叠加口型。不做表情迁移/表情驱动模型。
3. **如果 iPhone 上 WKWebView 跑 WASM+WebGL 效果不理想（掉帧、卡顿、内存吃紧），退路是把渲染挪到 Mac mini 上做**（同一个 DH_live 模型用 Python/onnxruntime 跑，编码成视频流经局域网推给手机）。Mac mini 的 CPU/GPU 算力比手机高不少，跑这个量级模型完全不需要 NVIDIA/CUDA，依然免费，只是后端工程量变大——**先不做，等 Phase 1 验证不过再启动**。
4. **不引入 OpenTalking/Fay/LiveTalking/MuseTalk 这类完整数字人框架**：它们要么需要 NVIDIA GPU（Mac mini 没有独显），要么是重复现有会话/角色/字幕系统的大迁移，跟"免费、个人用、最小改动"的目标不匹配。
5. **FeatherTalk（自训练轻量模型）不作为首选**：训练成本对个人项目不划算，DH_live 用现成模型即可满足"真人形象"的核心诉求。

## 1. 推荐目标架构

### 1.1 端侧渲染，Mac mini 只做音频中转

```text
                         ┌──────────────────────────────┐
Qwen audio.delta 24k PCM │ 现有 AudioManager             │
────────────────────────→│ 解码、cursor 排程、立即播放    │
  (Mac mini 转发)         │ 打断/clear/后台恢复的唯一 owner │
                         └───────────┬──────────────────┘
                                     │ 同一份已解码 PCM + responseId
                    ┌────────────────┴────────────────┐
                    │                                 │
          现有 Live2D RMS                     DH_live 渲染（iPhone 本地）
          失败时的回退                        24k→16k 重采样
                                             → 短 WAV 块喂 WASM
                                             → 按情绪标签切基础视频
                                             → WASM + WebGL Canvas
```

硬约束（跟原计划一致，不因为"个人用"而放松）：

- Qwen 音频播放永远走现有 `AudioManager`，数字人模块不得重复播放声音。
- 数字人只是同一份 PCM 的观察者；推理慢、初始化失败、掉帧时不得反压 WebSocket 或音频。
- 不为了音画同步延迟声音；本地渲染跟不上就回退 Live2D，不能牺牲语音响应速度。
- `responseId` 是画面与声音的代次标识；打断、清除、切角色、重连后，旧 response 的迟到数据必须丢弃。
- 首期不引入 WebRTC。只有"视频改成在 Mac mini 上生成"（Phase 5 备选）时，才需要考虑视频传输协议。

### 1.2 情绪层：复用已有的关键词标签机制

现有 Live2D 链路已经有一套现成模式可以直接照搬到 Qwen Realtime 上，不用新造轮子：

- `live2d_model.py` 里 `extract_emotion()` 从 LLM 文本里找 `[joy]` `[sadness]` 这类方括号关键词，`emo_map` 来自 `model_dict.json` 里每个模型的 `emotionMap`（典型集合：`neutral / joy / sadness / anger / surprise` 等）。
- Qwen Realtime 目前没有这层——但它会持续通过 `response.audio_transcript.delta/done` 事件把老师说的话转写成文字（见 `realtime/qwen_realtime.py` 的 `_on_assistant_transcript`）。
- 做法：在 `build_qwen_instructions()` 拼给 Qwen 的 persona 里加一句"每句话开头用方括号给一个情绪标签，如 [neutral]/[joy]/[thinking]/[surprise]"，复用与 Live2D 完全相同的标签词表；转写文本到达前端前，用与 `remove_emotion_keywords` 同样的正则策略剥离标签、只留给渲染层用，不展示给用户或影响字幕。
- 前端收到标签后只做一件事：切换 DH_live 当前使用的基础视频（idle/happy/thinking/surprise 中的一段），不做表情驱动模型、不做实时表情迁移。基础视频就是自己出镜录的几段几秒钟循环素材。

这样情绪表现的"真实感"来自于真人视频本身的表情，而不是算法生成的表情——对个人项目来说这是性价比最高的做法。

### 1.3 素材与配置

```yaml
avatar_renderer:
  mode: live2d       # live2d | dh_live
  asset_id: my_avatar_v1
```

- 默认 `mode: live2d`，旧角色文件不用改。
- `asset_id` 只是本地素材包的标识符，不接收任意 URL/路径。
- 素材（自己录的视频 + DH_live 的 `combined_data`）放在：

```text
frontend/src/renderer/public/digital-human/my_avatar_v1/
  manifest.json
  idle.mp4        # 平静待机
  joy.mp4         # 开心
  thinking.mp4    # 思考
  surprise.mp4    # 惊讶
  combined_data.json.gz
```

```text
frontend/src/renderer/public/digital-human/runtime/dh-live/   # WASM/JS 运行时
```

Web 版由现有 FastAPI 静态站点提供，Capacitor App 用本地 bundle 打包，Mac mini 上不需要额外的素材服务器或 CDN。

## 2. 分阶段实施任务

### Phase 1：DH_live 隔离 POC（在自己的 iPhone 上验证可行性）

- [ ] 录制自己的几段素材：一段中性待机循环（10-20 秒）、口播一段清晰朗读视频（用于 DH_live mini 训练/生成 `combined_data`）。
- [ ] 在独立 POC 页面加载官方 WASM、自己的素材，不接当前 React 页面。
- [ ] 先喂完整 16 kHz 单声道 WAV，确认最小路径能正常动嘴。
- [ ] 把同一段音频切成 100/200/400/800 ms 的块，测出能连续驱动、不明显卡顿或跳变的最小块长。
- [ ] 确认 WASM 只做推理不自行出声（若会播放要能静音），否则会和 `AudioManager` 打架。
- [ ] 实现无依赖的 24k→16k PCM 重采样 + 最小 WAV header 封装（几十行代码，不引入 FFmpeg/WASM 音频库）。
- [ ] 测试 `clear`：打断后嘴部应在 150 ms 内停止，不能把上一轮缓存的口型带到下一轮。
- [ ] 在自己的 iPhone 上跑一遍：初始化是否稳定、10 分钟会话有没有明显内存增长、帧率是否能稳定在 18fps 以上。

#### 必留检查

- 重采样/WAV 封装加一个最小单测（无框架）：1 秒 24kHz 正弦波应输出约 16000 个样本；WAV header 的采样率/声道/位深/data 长度要对。

#### Go / No-Go

满足以下条件进入 Phase 2：

- 自己的 iPhone 上能稳定初始化，10 分钟会话没有持续内存增长或崩溃；
- 口型相对声音的延迟主观感觉自然（不强求 P95 指标，个人体验过关即可）；
- 语音本身的首包延迟没有肉眼可感知的变化。

不满足：先不接 DH_live，继续用 Live2D，转 Phase 4（Mac mini 端渲染备选）评估是否值得投入。

### Phase 2：接入当前前端，默认关闭

#### 后端

- `src/open_llm_vtuber/config_manager/character.py`：新增最小 `AvatarRendererConfig`（`mode` + `asset_id`），默认 `live2d`。
- `src/open_llm_vtuber/realtime/qwen_realtime.py`：`build_qwen_instructions()` 追加情绪标签指令；转写事件转发前剥离 `[tag]`。
- `src/open_llm_vtuber/websocket_handler.py` / `service_context.py`：连接与角色切换时把 `avatar_renderer` 配置和情绪标签一起下发。

#### 前端

- `frontend/src/renderer/src/context/character-config-context.tsx`：保存 `avatarRenderer`，默认 `{mode: 'live2d'}`。
- `frontend/src/renderer/src/utils/audio-manager.ts`：解码/排程后增加一个可选 PCM 观察回调；`clearRealtime()` 同步通知清空。
- 新增 `frontend/src/renderer/src/components/canvas/dh-live-avatar.tsx`：加载素材、WASM/WebGL、接收 PCM、按情绪标签切基础视频、销毁资源；加载失败或掉帧时上报回退，不自己重连 WebSocket。
- `frontend/src/renderer/src/App.tsx`：`dh_live` 模式且组件 ready 时显示数字人 Canvas，否则继续 `<Live2D />`。

#### 明确不改

- 不改 Qwen 上游协议本身。
- 不新增视频 frame WebSocket 事件。
- 不让 Mac mini 端做视频渲染（除非进入 Phase 4）。
- 不引入 OpenTalking/Fay/WebRTC 依赖。

### Phase 3：打断、切角色与前后台生命周期

| 事件 | 数字人动作 |
| --- | --- |
| `response.started` | 建立新 `responseId` 代次，清除不属于它的积压 |
| `audio.delta` | AudioManager 排程声音后，旁路同一 PCM 给当前代次 |
| 情绪标签到达 | 切换当前基础视频（若目标视频未加载完成，先维持原视频） |
| `playback.clear` / `response.interrupted` | 立即清 PCM/帧缓存并回 idle 视频 |
| 角色切换 | 销毁旧 WASM/视频/WebGL 资源，加载新角色；加载期间显示 Live2D |
| WebSocket 重连 | 不复用旧 `responseId`，数字人保持 idle |
| App 进入后台 | 停渲染循环和 idle video |
| App 回到前台 | 恢复 WebGL 后再接受新 PCM；失败则回退 Live2D |

以下错误只影响画面，不能中断语音会话：WebCodecs/WASM/WebGL 不支持、素材加载失败、WASM 初始化异常、WebGL context lost、连续掉帧。回退时只记录不含音频内容的结构化原因，自动切回 Live2D，不需要用户手动操作。

### Phase 4（备选，仅在 Phase 1 效果不理想时启动）：渲染挪到 Mac mini

思路：把同一个 DH_live 模型换成本地 Python/onnxruntime 推理（CPU 即可，M4 算力足够这个量级的模型），生成的画面通过局域网用轻量视频流（比如简单的 MJPEG-over-WebSocket，不必上 WebRTC）推给手机，iOS 端只负责解码播放，绕开 WKWebView 里跑 WASM+WebGL 的不确定性。

代价：Mac mini 端要新增一个推理+编码服务；只有在 Phase 1 证明手机本地渲染确实撑不住时才值得做，先不预先投入。

## 3. 实现顺序与提交边界

1. `spike: validate dh-live pcm streaming on iphone`
   Phase 1 隔离 POC、重采样/WAV 检查、自己手机上的实测记录。
2. `feat: add opt-in dh-live renderer with live2d fallback`
   配置、情绪标签、前端组件、素材加载；默认关闭。
3. `fix: synchronize renderer interruption and app lifecycle`
   打断、切角色、后台/前台、WebGL 丢失和自动回退。

每个提交同步更新 `frontend` 指针；不要直接改 `frontend/dist` 产物。

## 4. 完成定义

- Qwen 语音质量、首包延迟、打断体验没有退化；
- 自己的 iPhone 上能稳定播放，连续对话、切角色、前后台切换不出现无响应、双声或旧口型复活；
- 情绪标签能让基础视频跟着对话情绪切换，主观上有"在跟真人聊天"的感觉；
- 数字人任何失败都能自动回退 Live2D，语音始终可用；
- 素材全部是自己录制的，没有第三方授权问题。

在此之前，Live2D + Qwen PCM 口型是产品基线，不删除、不降级。
