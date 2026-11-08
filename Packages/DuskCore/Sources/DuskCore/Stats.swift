import Foundation

public struct TagCount: Identifiable, Hashable, Sendable {
    public let tag: String
    public let count: Int

    public var id: String { tag }

    public init(tag: String, count: Int) {
        self.tag = tag
        self.count = count
    }
}

/// 一段时间内的统计结果。都是纯计算，方便测试。
public struct JournalStats: Sendable {
    public let totalEntries: Int
    /// 写过的不同天数（正常情况下等于篇数，保留字段以防将来一天多篇）。
    public let daysWritten: Int
    public let totalCharacters: Int
    public let currentStreak: Int
    public let longestStreak: Int
    public let firstDay: DayKey?
    public let lastDay: DayKey?
    public let entriesByYear: [Int: Int]
    public let entriesByMonth: [MonthKey: Int]
    public let daySet: Set<DayKey>
    public let tagCounts: [String: Int]
    public let moodCounts: [Mood: Int]

    public init(
        totalEntries: Int = 0,
        daysWritten: Int = 0,
        totalCharacters: Int = 0,
        currentStreak: Int = 0,
        longestStreak: Int = 0,
        firstDay: DayKey? = nil,
        lastDay: DayKey? = nil,
        entriesByYear: [Int: Int] = [:],
        entriesByMonth: [MonthKey: Int] = [:],
        daySet: Set<DayKey> = [],
        tagCounts: [String: Int] = [:],
        moodCounts: [Mood: Int] = [:]
    ) {
        self.totalEntries = totalEntries
        self.daysWritten = daysWritten
        self.totalCharacters = totalCharacters
        self.currentStreak = currentStreak
        self.longestStreak = longestStreak
        self.firstDay = firstDay
        self.lastDay = lastDay
        self.entriesByYear = entriesByYear
        self.entriesByMonth = entriesByMonth
        self.daySet = daySet
        self.tagCounts = tagCounts
        self.moodCounts = moodCounts
    }

    public static let empty = JournalStats()

    public var averageCharacters: Int {
        totalEntries == 0 ? 0 : totalCharacters / totalEntries
    }

    public func activeDays(in year: Int) -> Int {
        daySet.filter { $0.year == year }.count
    }

    public func entries(in year: Int) -> Int {
        entriesByYear[year] ?? 0
    }

    /// 某一年每个月的篇数，按 1...12 排列，图表的直接输入。
    public func monthlyCounts(in year: Int) -> [Int] {
        (1...12).map { month in
            entriesByMonth[MonthKey(year: year, month: month)] ?? 0
        }
    }

    /// 出现次数最多的标签。
    public func topTags(limit: Int = 8) -> [TagCount] {
        tagCounts
            .sorted { lhs, rhs in
                lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value
            }
            .prefix(limit)
            .map { TagCount(tag: $0.key, count: $0.value) }
    }

    public static func compute(
        entries: [EntrySnapshot],
        referenceDay: DayKey,
        calendar: Calendar = .current
    ) -> JournalStats {
        guard !entries.isEmpty else { return .empty }

        var daySet: Set<DayKey> = []
        var entriesByYear: [Int: Int] = [:]
        var entriesByMonth: [MonthKey: Int] = [:]
        var tagCounts: [String: Int] = [:]
        var moodCounts: [Mood: Int] = [:]
        var totalCharacters = 0

        for entry in entries {
            daySet.insert(entry.day)
            entriesByYear[entry.day.year, default: 0] += 1
            entriesByMonth[entry.day.monthKey, default: 0] += 1
            totalCharacters += entry.characterCount
            for tag in entry.tags where !tag.isEmpty {
                tagCounts[tag, default: 0] += 1
            }
            if let mood = entry.mood {
                moodCounts[mood, default: 0] += 1
            }
        }

        let sortedDays = daySet.sorted()

        return JournalStats(
            totalEntries: entries.count,
            daysWritten: daySet.count,
            totalCharacters: totalCharacters,
            currentStreak: streak(endingAt: referenceDay, days: daySet, calendar: calendar),
            longestStreak: longestStreak(days: sortedDays, calendar: calendar),
            firstDay: sortedDays.first,
            lastDay: sortedDays.last,
            entriesByYear: entriesByYear,
            entriesByMonth: entriesByMonth,
            daySet: daySet,
            tagCounts: tagCounts,
            moodCounts: moodCounts
        )
    }

    /// 从 `referenceDay` 往前数连续写了多少天。
    /// 今天还没写时不算断，从昨天开始数（隔天再写也接得上）。
    public static func streak(endingAt referenceDay: DayKey, days: Set<DayKey>, calendar: Calendar = .current) -> Int {
        var anchor: DayKey?
        if days.contains(referenceDay) {
            anchor = referenceDay
        } else {
            let yesterday = referenceDay.adding(days: -1, calendar: calendar)
            if days.contains(yesterday) { anchor = yesterday }
        }
        guard var cursor = anchor else { return 0 }

        var count = 0
        while days.contains(cursor) {
            count += 1
            cursor = cursor.adding(days: -1, calendar: calendar)
        }
        return count
    }

    public static func longestStreak(days sortedDays: [DayKey], calendar: Calendar = .current) -> Int {
        guard !sortedDays.isEmpty else { return 0 }
        var longest = 1
        var run = 1
        for index in 1..<sortedDays.count {
            if sortedDays[index].daysSince(sortedDays[index - 1], calendar: calendar) == 1 {
                run += 1
            } else {
                run = 1
            }
            longest = max(longest, run)
        }
        return longest
    }
}
