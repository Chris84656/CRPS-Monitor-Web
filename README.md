# ⚡ CRPS 智能电源监控系统（Web 端）

通过 Web Bluetooth（Web BLE）连接 ESP32-C3，实时监控服务器电源（CRPS）的输入/输出电压与电流、输出功率、效率、风扇转速与环境/热点温度，支持远程开关机控制与设备信息查看。

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-在线访问-2ea44f)](https://chris84656.github.io/CRPS-Monitor-Web/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-国内镜像-f38020)](https://crps-monitor-web.pages.dev/)

## 📌 在线访问

| 平台 | 地址 | 说明 |
|------|------|------|
| **GitHub Pages（主站）** | https://chris84656.github.io/CRPS-Monitor-Web/ | 全球访问 |
| **Cloudflare Pages（镜像）** | https://crps-monitor-web.pages.dev/ | 国内访问更快 |

> 网页需在 **HTTPS / localhost** 环境下运行 Web Bluetooth，请使用 **Chrome 或 Edge** 浏览器访问，并通过浏览器弹出窗口完成设备配对。

## ✨ 功能特性

- 🔌 **Web Bluetooth 直连**：无需安装任何 App，浏览器直接连接 ESP32-C3
- ⚡ **实时监控**：输入/输出电压与电流、输出功率、效率、风扇转速、环境/热点温度
- 📈 **动态图表**：60 秒滑动窗口实时曲线，Y 轴自适应；指数移动平均（EMA）平滑 + 按指标分档平滑系数，兼顾去噪与响应速度
- 🎯 **防"假性大波动"**：Y 轴最小跨度控制，小幅噪声不会被放大成满屏起伏；开关机等真实跳变直通显示，不爬坡、不过冲
- 🎛 **远程开关机**：点按式电源开关，与设备真实状态同步
- 🖥 **设备信息页**：硬件元数据与电源状态寄存器逐项展示（含风扇正常态 0xA200 识别）
- 🎨 **黑科技风格 UI**：深黑背景、青色点缀、粒子动态背景（视口固定 + 空闲自动冻结）、弹簧动效，全本地化资源（零 CDN 依赖）
- ♿ **无障碍支持**：键盘焦点样式、`prefers-reduced-motion` 动效降级

## 🛠 技术栈

- **前端**：原生 HTML / CSS / JavaScript（无框架）
- **图表**：Lightweight Charts v5（本地引入 `vendor/`）
- **动效**：Motion（本地引入 `vendor/`），弹簧 tab 指示器与卡片入场
- **字体**：Noto Sans SC（子集化）、JetBrains Mono、Material Symbols（全部本地化）
- **通信**：Web Bluetooth 的完整 GATT Read（动态250 ms、静态5秒轮询）；本网页不订阅 Notify，也不要求 MTU ≥247。
- 控制特征支持 Read 时，先读取以完成固件可能要求的配对。兼容可选 `proto:1/seq/valid/ack`，失败字段为未知；支持 `ack` 时匹配本次命令回执和目标状态才结束等待；无 `ack` 时保留单字节命令，只能观察写后状态。客户端不提供设备端认证保障，仍需固件支持。
- 失去新动态样本10秒后主卡片及图表当前值清空、控制禁用。带静态采样序号的固件45秒不更新身份会过期。

## 🚀 本地运行

项目为纯静态站点，无需构建，直接以任意静态服务器打开：

```bash
# 方式一：Python
python -m http.server 8080

# 方式二：Node.js
npx serve .
```

打开 `http://localhost:8080` 即可使用（localhost 属于安全上下文，Web BLE 可用）。

## ☁️ 部署

部署入口（是否自动发布以维护者实际配置为准）：

- **GitHub Pages**：可从 `main` 分支根目录构建发布
- **Cloudflare Pages**：可关联仓库分支，在推送后自动构建上线

## 回归验证

使用支持 `node:test` 的 Node.js 运行，无需安装 npm 依赖：

```sh
node --test tests/ble.test.cjs
```

测试执行实际 `app.js` / `chart.js`，以 GATT、DOM 和时钟替身覆盖会话隔离、串行读写、失败清理、严格解析、过期、命令回执和旧协议兼容。它不证明真实浏览器配对、无线传输或最终视觉效果；合并前仍需维护者使用原版及支持扩展的设备分别联调。

## 📂 目录结构

```
├── index.html          # 页面结构
├── styles.css          # 样式（主题变量 / 卡片 / 导航 / 图表容器）
├── app.js              # 状态管理、BLE 数据解包、UI 更新
├── chart.js            # 图表渲染（采样、平滑、Y 轴策略）
├── background.js       # 粒子点阵背景
├── vendor/             # 本地化第三方库（Lightweight Charts、Motion）
├── *.woff2 / *.ttf     # 本地化字体
└── *.css               # 字体与图标定义
```

## 📄 开源协议

本仓库仅包含 Web 前端代码，遵循 **MIT License** 开源，欢迎 Star、Fork 与二次开发。

> **注意**：ESP32-C3 设备端固件代码及硬件设计素材不开源，不在本仓库中提供。

## 📋 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)。
