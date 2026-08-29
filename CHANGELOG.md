# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-08-29

### 新增

- 图表引擎由 ECharts 替换为 **Lightweight Charts v5**（本地化引入 `vendor/`），渲染更流畅、体积更小
- 引入 **Motion** 动画库（本地化引入 `vendor/`）：导航 tab 指示器弹簧滑动、连接后卡片入场动效
- 曲线数据平滑：**指数移动平均（EMA）**，并按指标分档平滑系数——电压/温度/效率保持中低平滑，电流/功率/风扇快速跟随
- **Y 轴最小跨度控制**：各指标设定最小显示跨度，小幅噪声不再被放大成"假性大波动"
- **跳变直通**：开关机、负载突变等真实电平跳变立即到位，曲线不爬坡
- 设备信息页状态寄存器**风扇正常态 0xA200 识别**（不再误报为告警）
- 字体子集化（Noto Sans SC 子集 + JetBrains Mono），全部资源本地化，**零 CDN 依赖**
- 无障碍支持：键盘焦点样式（focus-visible）、`prefers-reduced-motion` 动效降级
- 粒子背景空闲 2.5 秒自动冻结省电，鼠标移动立即恢复

### 修复

- 修复图表卡片底部 1.6px 缝隙闪现白线（关闭 autoSize、增加 ResizeObserver 与容器裁剪）
- 修复切换页面时半透明遮罩异常闪动、状态栏被短暂覆盖（移除 View Transitions）
- 修复卡片半透明背景持续闪烁（移除 backdrop-filter 毛玻璃，与动态粒子背景逐帧重合成冲突）
- 修复曲线陡变处向上过冲/向下过降（曲线渲染由 Catmull-Rom 改为直线连接，严格贴合采样值）
- 修复页面滚动后下方粒子背景消失（背景 canvas 改回视口固定，修正尺寸与鼠标坐标计算）
- 修复电源开关初始状态不与设备真实状态同步

### 移除

- ECharts 依赖（echarts.min.js，已被 Lightweight Charts 替代）
- View Transitions 切页动画（与半透明卡片冲突）
- 毛玻璃 backdrop-filter 效果（改为扁平半透明，彻底消除闪烁）
- 鼠标指针处的黑色圆形遮罩

## [1.0.0] - 2026-08-02

### 新增

- 首个公开版本：基于 ECharts 的实时监控页面
- Web Bluetooth 直连、远程开关机、设备信息页
- 深色科技风 UI 与粒子背景