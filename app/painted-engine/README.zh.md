# 水彩动画运行环境

此运行环境保留 `tuzhechen2005/opus-video-skills` 固定提交 `59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1` 的完整 painted-animation 模板。锁文件固定 p5 2.3.3、p5.brush 2.2.3 和 Puppeteer Core 25.11.0；依赖通过 `npm ci --ignore-scripts` 安装，不执行上游安装、更新或发布脚本。

`preparePaintedProject` 将完整模板、引擎模块、绘制指南和角色表复制到工程，并保存真实 p5、p5.brush 浏览器库和许可证。绘制不调用图片生成服务或在线字体；显式文字覆盖层可用本机字体。原版渲染器保留，独立执行时需恢复其 Node 依赖和浏览器；工作台使用已有受管理的 Lemo 渲染器。

工程适配只调整尺寸、可选预览控件与渲染接口。`window.render(t)` 使用原版 p5.brush 绘制与合成，`READY`、`DUR`、`EV`、`TEXTS` 对接工作台。初始化镜头摘要用于区分模板与实际创作。已有影片不覆盖；明确替换的 Lemo 初始化页面在改动前保留备份。

两点墨线的兼容修正采用 `jumpersun/framecraft-skills` 提交 `734a9093fecf1589cd5be51fa5ee62e9c37584dd` 的实现：两点 `inkLine` 使用直线样条路径。运行与工程记录均保留此补丁来源。

水彩填充的速度须在实际显卡上测量，可能达到每帧数秒。环境就绪与技术验证通过不代表审美验收或达到某个模型的演示水准。
