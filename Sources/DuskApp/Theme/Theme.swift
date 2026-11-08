import SwiftUI

/// 一天的开始与结束之间的颜色：暖纸、墨色、晨光橙、暮色紫。
enum Palette {
    static let paper = dynamic(light: (0.976, 0.957, 0.925), dark: (0.075, 0.071, 0.067))
    static let card = dynamic(light: (1.000, 0.992, 0.976), dark: (0.125, 0.118, 0.110))
    static let ink = dynamic(light: (0.157, 0.137, 0.118), dark: (0.925, 0.906, 0.878))
    static let inkSoft = dynamic(light: (0.420, 0.388, 0.353), dark: (0.647, 0.620, 0.588))
    static let hairline = dynamic(light: (0.878, 0.855, 0.816), dark: (0.220, 0.208, 0.196))
    static let dawn = dynamic(light: (0.804, 0.435, 0.235), dark: (0.937, 0.588, 0.353))
    static let dusk = dynamic(light: (0.408, 0.353, 0.518), dark: (0.647, 0.588, 0.749))

    private static func dynamic(
        light: (CGFloat, CGFloat, CGFloat),
        dark: (CGFloat, CGFloat, CGFloat)
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let values = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: values.0, green: values.1, blue: values.2, alpha: 1)
        })
    }
}

enum Typeface {
    /// 日期、标题用衬线体，像纸上的字。
    static func serif(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func body(_ size: CGFloat) -> Font {
        .system(size: size, weight: .regular)
    }
}
