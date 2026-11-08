import Foundation

/// 中文日期文案。集中在一个地方，方便以后加多语言。
public enum DateText {
    public static let weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

    public static let monthNames = [
        "一月", "二月", "三月", "四月", "五月", "六月",
        "七月", "八月", "九月", "十月", "十一月", "十二月"
    ]

    /// `2027年1月1日`
    public static func full(_ day: DayKey) -> String {
        "\(day.year)年\(day.month)月\(day.day)日"
    }

    /// `1月1日`
    public static func monthDay(_ day: DayKey) -> String {
        "\(day.month)月\(day.day)日"
    }

    /// `周五`
    public static func weekday(_ day: DayKey, calendar: Calendar = .current) -> String {
        let index = day.weekdayIndex(calendar: calendar)
        guard weekdayNames.indices.contains(index - 1) else { return "" }
        return weekdayNames[index - 1]
    }

    /// `一月`
    public static func monthName(_ month: Int) -> String {
        guard monthNames.indices.contains(month - 1) else { return "\(month)月" }
        return monthNames[month - 1]
    }

    /// `2027年1月`
    public static func monthTitle(_ key: MonthKey) -> String {
        "\(key.year)年\(key.month)月"
    }

    /// `今天` / `昨天` / `3 天前`
    public static func relative(_ day: DayKey, to reference: DayKey) -> String {
        let diff = day.daysSince(reference)
        switch diff {
        case 0: return "今天"
        case -1: return "昨天"
        case -2: return "前天"
        case 1: return "明天"
        default:
            return diff < 0 ? "\(-diff) 天前" : "\(diff) 天后"
        }
    }

    /// 把「天数」写成人类读得懂的样子：`128 天`、`1 年 3 天`。
    public static func days(_ count: Int) -> String {
        if count < 365 { return "\(count) 天" }
        let years = count / 365
        let rest = count % 365
        return rest == 0 ? "\(years) 年" : "\(years) 年 \(rest) 天"
    }
}
