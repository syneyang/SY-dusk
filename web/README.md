# 朝夕 · 网页版（PWA）

原生版（`Sources/`）因为需要 Apple 芯片的 Mac 才能编译，先暂停。这里是能马上用的网页版。

## 本地跑起来

```bash
cd web
python3 -m http.server 8080
```

然后打开 <http://localhost:8080>。

想在手机上试（同一 Wi-Fi / 热点下）：

```bash
ipconfig getifaddr en0   # 拿到 Mac 的局域网 IP，比如 172.20.10.2
```

手机浏览器打开 `http://<那个IP>:8080`。

> 注意：用 `http://` 时 iPhone 不能「添加到主屏幕」成全屏 App，也不能离线。要真正安装，需要部署到 HTTPS 地址（下一步）。

## 技术选择

- 零依赖、零构建：原生 ES Module + IndexedDB，改完刷新就生效
- 数据全在本地：`entries`（一天一篇）、`images`（照片 Blob）、`meta`（设置）
- 照片在选图时就压到长边 1600px，另存一张 320px 缩略图给列表用

## 目录

```
web/
├── index.html
├── manifest.webmanifest     # PWA 清单
├── sw.js                    # 离线缓存（网络优先，断网回退缓存）
├── css/app.css
├── js/
│   ├── app.js       # 路由 + 底部标签
│   ├── db.js        # IndexedDB 封装
│   ├── model.js     # 数据结构、照片压缩
│   ├── editor.js    # 记日记页（表头 + 图文交替正文）
│   ├── list.js      # 时光
│   ├── review.js    # 回望
│   ├── settings.js  # 备份 / 导入 / 清空
│   └── util.js      # 日期与 DOM 小工具
└── icons/
```

## 已经跑通的

- 一天一篇，自动保存（防抖 700ms），刷新/重开不丢
- 表头：日期（可改）、天气、地点、区域
- 正文：段落 + 照片交替插入，粘贴纯文本自动分段
- 时光：按年-月分组、倒序、字数/照片数
- 分析：当前/最长连续（按天、按周）、今年篇数 + 每月柱状图、字数（总/今年/本月）、照片数、地点数、**月历打卡点（点日期直接跳过去）**、常去的地方
- 设置：开始日期、导出 JSON（含照片）、导出 HTML 单文件、导入合并、清空

## 还没做

- 高德：地图选点 + 自动天气（需要 key 和小中转）
- 豆包：粘贴后自动抽取汇总（需要 key）
- 口述录音 → 转写 → 生成（需要 ASR + LLM）
- HTTPS 部署（让 iPhone 能真正安装）
