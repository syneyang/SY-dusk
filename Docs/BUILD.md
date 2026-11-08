# 把它装到 iPhone 12 Pro Max 上

## 0. 先说结论

这台 Mac 目前**没有装 Xcode**，所以现在还不能编译。装好 Xcode 之后，整个流程大约 20 分钟。

另外提醒一句：这台机器的命令行工具（Command Line Tools）现在有点问题——任何 `import Foundation` 的 Swift 代码都会报
`redefinition of module 'SwiftBridging'`。装完 Xcode 并把工具链切过去之后，这个问题会自动消失。

## 1. 装 Xcode

1. 打开「App Store」，搜索 **Xcode**，点安装（约 15 GB，下载时间取决于网速）。
2. 装完后打开一次，同意协议、输入密码让它安装附加组件。
3. 把命令行工具切到 Xcode：

   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   ```

4. 验证：

   ```bash
   xcodebuild -version
   # 应该输出 Xcode 16.x 或 26.x
   ```

## 2. 打开工程

```bash
open "/Users/syneyang/Documents/deepseek-harness/default-workspace/dusk/Dusk.xcodeproj"
```

Xcode 首次打开会拉取本地 Swift Package（`Packages/DuskCore`），等它跑完进度条。

## 3. 用免费账号签名

1. Xcode → 菜单 `Xcode > Settings… > Accounts` → 左下角 `+` → 添加 Apple ID（免费的就行）。
2. 左边选中 `Dusk` 工程 → `TARGETS > Dusk` → `Signing & Capabilities`：
   - 勾选 **Automatically manage signing**
   - **Team** 选你的名字（Personal Team）
   - 如果 **Bundle Identifier** 报红（被占用），改成 `com.syneyang.dusk2027` 之类，随便换个后缀即可。

## 4. 连手机

1. 用数据线把 iPhone 12 Pro Max 连到 Mac，手机上点「信任此电脑」。
2. iPhone 上打开：`设置 → 隐私与安全性 → 开发者模式`，打开并重启手机。
3. Xcode 顶部的运行目标选你的 iPhone（不是模拟器），按 **⌘R**。
4. 第一次运行后，手机上打开 App 会提示「不受信任的开发者」：
   去 `设置 → 通用 → VPN 与设备管理` → 选中你的 Apple ID → 「信任」。
5. 再打开 App，就能用了。

## 5. 免费账号的两个限制（重要）

| 限制 | 影响 | 怎么办 |
| --- | --- | --- |
| 签名 **7 天**过期 | 第 8 天 App 打不开，提示需要重新签名 | 到期前连上 Mac，在 Xcode 里再按一次 ⌘R，数据不受影响 |
| 不能用 iCloud 能力 | 没有 CloudKit 同步 | 现在用「设置 → 导出」做备份，AirDrop 到别的设备；将来换付费账号再加 iCloud |

> 数据存在 App 沙盒里。**重装 App、换手机、删 App 之前，一定先在「设置」里导出一次 JSON 备份。**

想彻底摆脱 7 天限制，可以后面买 Apple Developer Program（$99/年），签名有效 1 年，还能用 TestFlight 把 App 装到其他设备。

## 6. 日常开发命令

```bash
cd "/Users/syneyang/Documents/deepseek-harness/default-workspace/dusk"

# 改了 project.yml 或新增了文件后，重新生成工程
./.tools/xcodegen/bin/xcodegen generate

# 重新生成图标
python3 Scripts/make-icon.py

# 核心逻辑的冒烟测试（需要可用的 Swift 工具链）
./Scripts/check-core.sh

# 包里的单元测试
cd Packages/DuskCore && swift test

# 命令行编译（把 <UDID> 换成手机的，xcodebuild -showdestinations 可以查）
xcodebuild -project Dusk.xcodeproj -scheme Dusk \
  -destination 'platform=iOS,id=<UDID>' build
```

## 7. 常见问题

**Q：Xcode 里提示 "No signing certificate"？**
A：`Signing & Capabilities` 里 Team 没选，或者 Bundle Identifier 被别人占了。换一个 Identifier 即可。

**Q：装完 Xcode 后 `swift` 还是报 SwiftBridging 的错？**
A：`xcode-select -p` 看看是不是还指向 `/Library/Developer/CommandLineTools`。如果不是 Xcode 路径，重新执行第 1 步的第 3 条。

**Q：想同时在 Mac 上看日记？**
A：目前 App 只做了 iOS。导出的 Markdown 可以直接在 Mac 上读；将来可以加一个 Mac target（SwiftUI 的同一套代码大部分能复用）。

**Q：iOS 版本低于 17 怎么办？**
A：iPhone 12 Pro Max 支持到 iOS 26，先看 `设置 → 通用 → 关于本机` 的版本号。如果是 16，需要把数据层从 SwiftData 换成 Core Data，告诉我，我来改。
