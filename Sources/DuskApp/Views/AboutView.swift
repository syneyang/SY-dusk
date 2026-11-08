import SwiftUI

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .center, spacing: 14) {
                        Image(systemName: "sun.horizon.fill")
                            .font(.system(size: 38, weight: .light))
                            .foregroundStyle(Palette.dawn)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("朝夕")
                                .font(Typeface.serif(32))
                                .foregroundStyle(Palette.ink)
                            Text("一天从朝到夕，一年从春到冬")
                                .font(.footnote)
                                .foregroundStyle(Palette.inkSoft)
                        }
                    }

                    Rectangle()
                        .fill(Palette.hairline)
                        .frame(height: 1)

                    section(
                        title: "为什么叫这个名字",
                        body: "«朝» 是早晨，«夕» 是傍晚。一天就是朝与夕之间的一小段；一年就是三百六十五个朝夕。名字里的两个时刻，刚好是大多数人有空写几句话的时候。"
                    )

                    section(
                        title: "它想做的事",
                        body: "每天记一点，不做太重的事；年底能把这些天连起来看，知道自己这一年是怎么过来的。所有日记都是纯文本，随时能导出成 Markdown 或 JSON，不属于任何服务器。"
                    )

                    section(
                        title: "数据在哪",
                        body: "只有这台 iPhone。没有账号，不上传，不联网。换手机之前，去「设置 → 导出」做一次备份，再在新手机上导入即可。"
                    )

                    section(
                        title: "版本",
                        body: "0.1.0 · 2026 年 11 月 · 为 2027 年元旦准备的第一版"
                    )
                }
                .padding(22)
            }
            .background(Palette.paper.ignoresSafeArea())
            .navigationTitle("关于")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .tint(Palette.dawn)
    }

    private func section(title: String, body text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(title)
            Text(text)
                .font(Typeface.body(15))
                .foregroundStyle(Palette.ink)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
