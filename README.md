# ⚡ CRPS 智能电源监控系统（Web 端）

通过 Web Bluetooth（Web BLE）连接 ESP32-C3，实时监控服务器电源（CRPS）的电压、电流、功率、效率与温度，支持远程开关机控制。

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-在线访问-2ea44f)](https://chris84656.github.io/CRPS-Monitor-Web/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-国内镜像-f38020)](https://crps-monitor-web.pages.dev/)

## 📌 在线访问

| 平台 | 地址 | 说明 |
|------|------|------|
| **GitHub Pages（主站）** | https://chris84656.github.io/CRPS-Monitor-Web/ | 全球访问 |
| **Cloudflare Pages（镜像）** | https://crps-monitor-web.pages.dev/ | 国内访问更快 |

> 网页需在 **HTTPS / localhost** 环境下运行 Web Bluetooth，请使用 **Chrome 或 Edge** 浏览器访问。

## ✨ 功能特性

- 🔌 **Web Bluetooth 直连**：无需安装任何 App，浏览器直接连接 ESP32-C3
- ⚡ **实时监控**：输入/输出电压与电流、输出功率、效率、风扇转速、环境/热点温度
- 📈 **动态图表**：60 秒滑动窗口实时曲线，Y 轴自适应缩放，曲线铺满图表宽度
- 🎛 **远程开关机**：点按式开关按钮，支持手动与设备状态同步
- 🖥 **设备信息页**：展示硬件元数据与电源状态寄存器
- 🎨 **黑科技风格 UI**：深黑背景、青色点缀、粒子动态背景、液态玻璃毛玻璃卡片、全本地化资源（零 CDN 依赖）

## 🛠 技术栈

- **硬件**：ESP32-C3 + ST7789 显示屏（Web 端不依赖屏幕）
- **前端**：原生 HTML / CSS / JavaScript（无框架）
- **图表**：ECharts 5.x（本地化引入）
- **通信**：Web Bluetooth（BLE）

## 🚀 本地运行

项目为纯静态站点，无需构建，可直接用任意静态服务器打开 `index.html`：

```bash
# 方式一：Python
python -m http.server 8080

# 方式二：Node.js
npx serve .

# 方式三：VS Code Live Server 插件
```

打开 `http://localhost:8080` 即可使用。

## ☁️ 部署

推送到 `main` 分支后，由 GitHub Actions / Cloudflare Pages 自动构建部署。

## 📄 开源协议

本项目遵循 MIT License 开源，欢迎 Star、Fork 与二次开发。