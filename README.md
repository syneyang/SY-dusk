# 朝夕 · Dusk

一个只给自己用的 iPhone 日记 App。

每天记一点，年底能把这些天连起来看——这是它存在的唯一理由。

- **机型**：iPhone 12 Pro Max（iOS 17 及以上）
- **技术**：SwiftUI + SwiftData + Swift Charts，纯原生
- **数据**：只存在这台手机上，随时可导出 Markdown / JSON
- **启用日**：2027 年 1 月 1 日（App 里可以改，但「第几天」默认从这天算）

## 现在有的四个页面

| 页面 | 做什么 |
| --- | --- |
| 今天 | 大号日期、每天一句写作提示、正文自动保存、心情、标签 |
| 时光 | 全部日记按「年 → 月」排列，可搜索、可按年筛选、可补记、可置顶 |
| 回望 | 年度统计、每月柱状图、全年每天一格的热力图、标签与心情分布、年末自问、导出该年 Markdown |
| 设置 | 开始日期、备份（JSON）、导出（Markdown）、导入恢复、清空 |

## 目录结构

```
dusk/
├── Dusk.xcodeproj          # 由 project.yml 生成，双击即可打开
├── project.yml             # 工程定义（改完跑一次 xcodegen）
├── Sources/
│   ├── DuskApp/            # App 本体：视图、数据层、配色、图标
│   │   ├── DuskApp.swift
│   │   ├── Views/          # Today / Timeline / Review / Settings / Editor
│   │   ├── Data/           # SwiftData 模型、存取、导入导出
│   │   ├── Theme/          # 配色与字体
│   │   └── Assets.xcassets # App 图标、强调色、启动背景
│   └── ...
├── Packages/DuskCore/      # 纯逻辑包（日期、分组、统计、Markdown、存档）
│   ├── Sources/DuskCore/
│   └── Tests/DuskCoreTests/
├── Scripts/
│   ├── check-core.sh       # 不依赖 Xcode 的核心逻辑冒烟测试
│   ├── make-icon.py        # 生成 App 图标
│   └── CoreCheck/main.swift
├── Docs/                   # 产品说明、构建步骤、数据格式、路线图
└── Support/Info.plist      # 由 xcodegen 生成
```

## 当前状态

- ✅ 工程骨架、四个页面、数据层、导出/导入、图标、文档
- ✅ 源码语法检查、工程文件校验、资源校验
- ⏳ 等待 Xcode：真实编译与真机运行（这台机器目前没装 Xcode，详见 [Docs/BUILD.md](Docs/BUILD.md)）

## 怎么跑起来

见 [Docs/BUILD.md](Docs/BUILD.md)。一句话版本：装 Xcode → 打开 `Dusk.xcodeproj` → 选自己的免费 Apple ID 作为 Team → 连上 iPhone → ⌘R。

## 为什么叫朝夕

见 [Docs/PRODUCT.md](Docs/PRODUCT.md)。

## 数据永不锁死

- **JSON 备份**：包含每篇的结构化内容，可原样导回。
- **Markdown 导出**：按年一份，直接丢进 Obsidian、备忘录或任何编辑器都能读。

两种格式的细节在 [Docs/DATA-FORMAT.md](Docs/DATA-FORMAT.md)。
