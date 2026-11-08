import Foundation
import DuskCore

enum SettingsKey {
    /// 正式启用「朝夕」的那一天，也是「第几天」的起点。
    static let journeyStart = "journeyStart"
    static let defaultJourneyStart = "2027-01-01"
}

enum Journey {
    static func start(from iso: String) -> DayKey {
        DayKey(iso: iso) ?? DayKey(year: 2027, month: 1, day: 1)
    }

    /// 起点之后的第几天（起点当天是第 1 天）；还没开始时返回 0 或负数。
    static func index(of day: DayKey, start: DayKey) -> Int {
        day.daysSince(start) + 1
    }
}
