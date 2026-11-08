import Foundation

public struct MonthSection: Identifiable, Sendable {
    public let key: MonthKey
    public let entries: [EntrySnapshot]

    public var id: MonthKey { key }
    public var title: String { DateText.monthTitle(key) }
    public var count: Int { entries.count }
}

public struct YearSection: Identifiable, Sendable {
    public let year: Int
    public let months: [MonthSection]

    public var id: Int { year }
    public var entries: [EntrySnapshot] { months.flatMap(\.entries) }
    public var count: Int { months.reduce(0) { $0 + $1.entries.count } }
    public var title: String { "\(year) 年" }
}

public enum Grouping {
    /// 按「年 → 月」两级分好组，供时间线使用。
    public static func sections(_ entries: [EntrySnapshot], newestFirst: Bool = true) -> [YearSection] {
        let sorted = entries.sorted { lhs, rhs in
            if lhs.day != rhs.day { return newestFirst ? lhs.day > rhs.day : lhs.day < rhs.day }
            return newestFirst ? lhs.createdAt > rhs.createdAt : lhs.createdAt < rhs.createdAt
        }

        var yearOrder: [Int] = []
        var monthsByYear: [Int: [MonthKey]] = [:]
        var entriesByMonth: [Int: [MonthKey: [EntrySnapshot]]] = [:]

        for entry in sorted {
            let year = entry.day.year
            if entriesByMonth[year] == nil {
                yearOrder.append(year)
                monthsByYear[year] = []
                entriesByMonth[year] = [:]
            }
            let month = entry.day.monthKey
            if entriesByMonth[year]?[month] == nil {
                monthsByYear[year]?.append(month)
                entriesByMonth[year]?[month] = []
            }
            entriesByMonth[year]?[month]?.append(entry)
        }

        return yearOrder.map { year in
            let months = (monthsByYear[year] ?? []).map { month in
                MonthSection(key: month, entries: entriesByMonth[year]?[month] ?? [])
            }
            return YearSection(year: year, months: months)
        }
    }

    /// 按天建索引，方便「今天写了没有」这类查询。
    public static func byDay(_ entries: [EntrySnapshot]) -> [DayKey: EntrySnapshot] {
        var result: [DayKey: EntrySnapshot] = [:]
        for entry in entries {
            if let existing = result[entry.day] {
                if entry.updatedAt > existing.updatedAt { result[entry.day] = entry }
            } else {
                result[entry.day] = entry
            }
        }
        return result
    }
}
