# 朝夕 · Android 安装版

## 是什么

把网页版「朝夕」包成的安卓应用（TWA，用手机上的 Chrome 内核运行）。
**代码和网站完全同一份**，以后改网页就是改 App，不用重新发版。

- 包名：`com.syneyang.dusk`
- 版本：1.0.0（versionCode 1）
- 最低系统：Android 7.0（API 24）
- 签名：`CN=Dusk`，指纹已写入网站 `/.well-known/assetlinks.json`

## 安装

1. 把 `朝夕-1.0.0.apk` 传到三星手机上（微信/QQ 传文件，或数据线）
2. 点开安装，允许「安装未知来源应用」
3. 桌面出现「朝夕」图标
4. 打开 → 输入邮箱密码登录 → 拉取云端日记

## 为什么第一次打开没有地址栏

TWA 启动时会用 `assetlinks.json` 校验「这个域名确实属于这个包名」。
校验通过 → 全屏无地址栏；校验失败 → 顶部会出现一条网址栏（功能一样，只是丑）。

如果出现地址栏，说明校验没过，检查：

- `https://sy-dusk.pages.dev/.well-known/assetlinks.json` 能否打开
- 里面的 `sha256_cert_fingerprints` 是否和 APK 签名一致

## 以后怎么更新

两种方式，内容自动跟着变：

1. **网页更新** → 打开 App 自动加载新版（和 iOS 一样），不需要重新装 APK
2. **只有改图标/包名/权限** 时，才需要重新打包 APK

## 重新打包

```bash
cd ~/dusk-android
BUBBLEWRAP_KEYSTORE_PASSWORD=$(cat ~/dusk-signing-password.txt) \
BUBBLEWRAP_KEY_PASSWORD=$(cat ~/dusk-signing-password.txt) \
npx @bubblewrap/cli@1.24.0 build --skipPwaValidation
```

产物：`app-release-signed.apk`

**签名密钥在 `~/dusk-backup/`，一定要备份**——丢了就不能覆盖升级。
