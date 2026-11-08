import Foundation

/// 一天的「身份证」：只保存年月日，不保存具体时刻。
///
/// 日记是按天存在的，用 `Date` 表示「哪一天」会带来时区和夏令时的麻烦，
/// 所以整个项目内部都用 `DayKey` 指代某一天。
public struct DayKey: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// 从某个时刻里取出它所在的日历日（默认使用设备当前日历）。
    public init(_ date: Date, calendar: Calendar = .current) {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        self.year = parts.year ?? 1970
        self.month = parts.month ?? 1
        self.day = parts.day ?? 1
    }

    /// 从 `"2027-01-01"` 这样的字符串还原。格式不对返回 nil。
    public init?(iso: String) {
        let parts = iso.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2])
        else { return nil }
        self.year = year
        self.month = month
        self.day = day
    }

    public static func today(calendar: Calendar = .current) -> DayKey {
        DayKey(Date(), calendar: calendar)
    }

    /// `"2027-01-01"`，用于存档、文件名、URL。
    public var iso: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    public var monthKey: MonthKey {
        MonthKey(year: year, month: month)
    }

    /// 这一天 00:00 的时刻。
    public func startOfDay(calendar: Calendar = .current) -> Date {
        var parts = DateComponents()
        parts.year = year
        parts.month = month
        parts.day = day
        return calendar.date(from: parts) ?? .distantPast
    }

    /// 平移若干天（可以是负数），跨月、跨年、闰年都由 Foundation 处理。
    public func adding(days: Int, calendar: Calendar = .current) -> DayKey {
        guard let moved = calendar.date(byAdding: .day, value: days, to: startOfDay(calendar: calendar)) else {
            return self
        }
        return DayKey(moved, calendar: calendar)
    }

    /// `self` 与 `other` 相差多少个日历日（`self` 更晚时为正）。
    public func daysSince(_ other: DayKey, calendar: Calendar = .current) -> Int {
        calendar.dateComponents(
            [.day],
            from: other.startOfDay(calendar: calendar),
            to: startOfDay(calendar: calendar)
        ).day ?? 0
    }

    /// 1 = 周日，7 = 周六。
    public func weekdayIndex(calendar: Calendar = .current) -> Int {
        calendar.component(.weekday, from: startOfDay(calendar: calendar))
    }

    public static func < (lhs: DayKey, rhs: DayKey) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    public var description: String { iso }
}

/// 年月，用于按月分组和统计。
public struct MonthKey: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int

    public init(year: Int, month: Int) {
        self.year = year
        self.month = month
    }

    public static func < (lhs: MonthKey, rhs: MonthKey) -> Bool {
        (lhs.year, lhs.month) < (rhs.year, rhs.month)
    }

    public var description: String { String(format: "%04d-%02d", year, month) }
}

public enum JournalCalendar {
    /// 固定公历（而不是佛历、和历等），时区跟随设备。
    public static func make(timeZone: TimeZone = .current) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.locale = Locale(identifier: "zh_CN")
        return calendar
    }
}
