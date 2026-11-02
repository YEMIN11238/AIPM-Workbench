独立安装的原版 Remotion starter 运行依赖。Remotion 4.0.537，React/ReactDOM19.1.0；固定依赖见 package-lock.json。源 starter 与 helpers/score/check 保持原样，Google Fonts 默认仍需要字体网络下载。
本机 Chrome Headless Shell 缓存通过只读用途的链接复用已安装、版本匹配的 157.0.8080.0-remotion-v3；没有改动 video-engine。
上游 MIT 与Remotion/React许可见credits。上游check输出FAIL时可能仍退出0，不应只依赖退出码；score参数需要宿主校验，特别是循环步长/配色/长度。
