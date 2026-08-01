# AI 外教移动端测试

原生工程使用 Capacitor 8，应用标识为 `ai.english.tutor`。Web 页面打进 App；Qwen Key 只在 Docker 容器中。

## 本机开发环境

- Android：已验证 Java 21、Android SDK Platform 36 和 Build Tools 35。终端构建前设置：`export JAVA_HOME=/usr/local/opt/openjdk@21`。
- iOS：需要将已下载的 `Xcode_26.2_Apple_silicon.xip` 完整解压为 `Xcode.app`（建议拖入“应用程序”）后再打开 iOS 工程。

## 启动测试后端

在服务器仓库根目录创建 `.env`，填入 `DASHSCOPE_API_KEY` 和随机测试口令：

```bash
cp mobile/.env.test.example .env
openssl rand -hex 32
docker compose -f docker-compose.mobile-test.yml up -d --build
docker compose -f docker-compose.mobile-test.yml logs -f
```

Docker 公开 `221.216.142.92:18081`，但只有先发送 `MOBILE_ACCESS_TOKEN` 的客户端才能创建 Qwen 会话。该口令只适用于单设备私测，不能用于商店发布。

## Android 真机 IP 测试

```bash
export MOBILE_ACCESS_TOKEN='与服务器 .env 相同的值'
cd mobile
corepack pnpm run sync:android-ip-test
corepack pnpm run open:android
```

`sync:android-ip-test` 只为 Debug 允许 `http/ws://221.216.142.92:18081`。不要用它构建 release。

构建调试 APK：

```bash
export JAVA_HOME=/usr/local/opt/openjdk@21
cd mobile/android
./gradlew :app:assembleDebug
```

输出文件为 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`。连接并在手机上授权 USB 调试后，可通过 Android Studio 安装，或执行 `adb install -r app/build/outputs/apk/debug/app-debug.apk`。

## iOS

```bash
cd mobile
corepack pnpm run sync
corepack pnpm run open:ios
```

iOS release 不允许通过纯 IP 的 HTTP/WS 连接实时服务。iPhone 真机语音测试需要一个带受信任 TLS 证书的域名，并以 `VITE_BACKEND_URL=https://api.example.com` 重新同步；不要为省事把 ATS 全局关闭。
