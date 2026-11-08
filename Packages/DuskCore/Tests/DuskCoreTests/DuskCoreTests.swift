import XCTest
@testable import DuskCore

final class DayKeyTests: XCTestCase {
    private let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

    func testISORoundTrip() {
        let day = DayKey(year: 2027, month: 1, day: 1)
        XCTAssertEqual(day.iso, "2027-01-01")
        XCTAssertEqual(DayKey(iso: "2027-01-01"), day)
        XCTAssertNil(DayKey(iso: "2027-1"))
        XCTAssertNil(DayKey(iso: "abc"))
    }

    func testAddingAcrossMonthAndYear() {
        let day = DayKey(year: 2026, month: 12, day: 31)
        XCTAssertEqual(day.adding(days: 1, calendar: calendar), DayKey(year: 2027, month: 1, day: 1))
        XCTAssertEqual(day.adding(days: 32, calendar: calendar), DayKey(year: 2027, month: 2, day: 1))
        XCTAssertEqual(day.adding(days: -365, calendar: calendar), DayKey(year: 2026, month: 1, day: 1))
    }

    func testLeapDay() {
        let day = DayKey(year: 2028, month: 2, day: 28)
        XCTAssertEqual(day.adding(days: 1, calendar: calendar), DayKey(year: 2028, month: 2, day: 29))
        XCTAssertEqual(day.adding(days: 2, calendar: calendar), DayKey(year: 2028, month: 3, day: 1))
        XCTAssertEqual(day.dayOfYear(calendar: calendar), 59)
    }

    func testDaysSince() {
        let a = DayKey(year: 2027, month: 1, day: 1)
        let b = DayKey(year: 2027, month: 3, day: 1)
        XCTAssertEqual(b.daysSince(a, calendar: calendar), 59)
        XCTAssertEqual(a.daysSince(b, calendar: calendar), -59)
        XCTAssertEqual(a.daysSince(a, calendar: calendar), 0)
    }

    func testWeekday() {
        // 2027-01-01 是周五
        XCTAssertEqual(DayKey(year: 2027, month: 1, day: 1).weekdayIndex(calendar: calendar), 6)
        XCTAssertEqual(DateText.weekday(DayKey(year: 2027, month: 1, day: 1), calendar: calendar), "周五")
    }

    func testSorting() {
        let days = [
            DayKey(year: 2027, month: 2, day: 1),
            DayKey(year: 2026, month: 12, day: 31),
            DayKey(year: 2027, month: 1, day: 15)
        ].sorted()
        XCTAssertEqual(days.map(\.iso), ["2026-12-31", "2027-01-15", "2027-02-01"])
    }
}

final class GroupingTests: XCTestCase {
    private let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

    private func entry(_ iso: String, text: String = "正文") -> EntrySnapshot {
        EntrySnapshot(day: DayKey(iso: iso)!, text: text)
    }

    func testSectionsAreNestedByYearAndMonth() {
        let entries = [
            entry("2027-01-01"),
            entry("2027-01-20"),
            entry("2027-03-05"),
            entry("2026-12-31")
        ]
        let sections = Grouping.sections(entries)
        XCTAssertEqual(sections.map(\.year), [2027, 2026])
        XCTAssertEqual(sections[0].months.map(\.key.month), [3, 1])
        XCTAssertEqual(sections[0].months[1].count, 2)
        XCTAssertEqual(sections[0].count, 3)
    }

    func testOldestFirstOrdering() {
        let entries = [entry("2027-03-05"), entry("2027-01-01")]
        let sections = Grouping.sections(entries, newestFirst: false)
        XCTAssertEqual(sections[0].months.map(\.key.month), [1, 3])
    }

    func testByDayPrefersNewerUpdate() {
        let day = DayKey(iso: "2027-01-01")!
        var older = EntrySnapshot(day: day, text: "旧")
        older.updatedAt = Date(timeIntervalSince1970: 100)
        var newer = EntrySnapshot(day: day, text: "新")
        newer.updatedAt = Date(timeIntervalSince1970: 200)

        let index = Grouping.byDay([older, newer])
        XCTAssertEqual(index[day]?.text, "新")
    }
}

final class StatsTests: XCTestCase {
    private let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

    private func entries(_ isos: [String]) -> [EntrySnapshot] {
        isos.map { EntrySnapshot(day: DayKey(iso: $0)!, text: "一二三") }
    }

    func testEmptyStats() {
        let stats = JournalStats.compute(entries: [], referenceDay: DayKey(year: 2027, month: 1, day: 1), calendar: calendar)
        XCTAssertEqual(stats.totalEntries, 0)
        XCTAssertEqual(stats.currentStreak, 0)
        XCTAssertNil(stats.firstDay)
    }

    func testStreakCountsBackFromToday() {
        let list = entries(["2027-01-01", "2027-01-02", "2027-01-03"])
        let stats = JournalStats.compute(entries: list, referenceDay: DayKey(iso: "2027-01-03")!, calendar: calendar)
        XCTAssertEqual(stats.currentStreak, 3)
        XCTAssertEqual(stats.longestStreak, 3)
    }

    func testStreakSurvivesMissingToday() {
        let list = entries(["2027-01-01", "2027-01-02"])
        let stats = JournalStats.compute(entries: list, referenceDay: DayKey(iso: "2027-01-03")!, calendar: calendar)
        XCTAssertEqual(stats.currentStreak, 2)
    }

    func testStreakBreaksAfterGap() {
        let list = entries(["2027-01-01", "2027-01-02"])
        let stats = JournalStats.compute(entries: list, referenceDay: DayKey(iso: "2027-01-05")!, calendar: calendar)
        XCTAssertEqual(stats.currentStreak, 0)
        XCTAssertEqual(stats.longestStreak, 2)
    }

    func testLongestStreakAcrossGaps() {
        let list = entries([
            "2027-01-01", "2027-01-02", "2027-01-03",
            "2027-01-10",
            "2027-02-01", "2027-02-02"
        ])
        let stats = JournalStats.compute(entries: list, referenceDay: DayKey(iso: "2027-02-02")!, calendar: calendar)
        XCTAssertEqual(stats.longestStreak, 3)
        XCTAssertEqual(stats.daysWritten, 6)
        XCTAssertEqual(stats.totalCharacters, 18)
        XCTAssertEqual(stats.entries(in: 2027), 6)
        XCTAssertEqual(stats.activeDays(in: 2027), 6)
    }

    func testMonthlyCounts() {
        let list = entries(["2027-01-01", "2027-01-31", "2027-03-02"])
        let stats = JournalStats.compute(entries: list, referenceDay: DayKey(iso: "2027-03-02")!, calendar: calendar)
        let counts = stats.monthlyCounts(in: 2027)
        XCTAssertEqual(counts.count, 12)
        XCTAssertEqual(counts[0], 2)
        XCTAssertEqual(counts[1], 0)
        XCTAssertEqual(counts[2], 1)
    }

    func testTagsAndMoods() {
        var list = entries(["2027-01-01", "2027-01-02"])
        list[0].tags = ["旅行", "朋友"]
        list[1].tags = ["旅行"]
        list[0].mood = .great
        let stats = JournalStats.compute(entries: list, referenceDay: DayKey(iso: "2027-01-02")!, calendar: calendar)
        XCTAssertEqual(stats.topTags().first?.tag, "旅行")
        XCTAssertEqual(stats.topTags().first?.count, 2)
        XCTAssertEqual(stats.moodCounts[.great], 1)
    }
}

final class MarkdownTests: XCTestCase {
    private let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

    func testYearMarkdownStructure() {
        var entry = EntrySnapshot(day: DayKey(iso: "2027-01-01")!, text: "今天去了海边。\n风很大。")
        entry.title = "海边"
        entry.mood = .good
        entry.tags = ["旅行"]

        let markdown = MarkdownExporter.year([entry], year: 2027, calendar: calendar)
        XCTAssertTrue(markdown.contains("# 2027 年 · 朝夕"))
        XCTAssertTrue(markdown.contains("> 1 篇 · 1 天"))
        XCTAssertTrue(markdown.contains("## 一月"))
        XCTAssertTrue(markdown.contains("### 1月1日 周五 · 不错"))
        XCTAssertTrue(markdown.contains("#旅行"))
        XCTAssertTrue(markdown.contains("**海边**"))
        XCTAssertTrue(markdown.contains("今天去了海边。"))
    }

    func testEmptyYearMarkdown() {
        let markdown = MarkdownExporter.year([], year: 2027, calendar: calendar)
        XCTAssertTrue(markdown.contains("这一年还没有记录"))
    }

    func testSingleFileHasFrontMatter() {
        let entry = EntrySnapshot(day: DayKey(iso: "2027-01-01")!, text: "正文", tags: ["a", "b"])
        let file = MarkdownExporter.singleFile(entry, calendar: calendar)
        XCTAssertTrue(file.hasPrefix("---\ndate: 2027-01-01"))
        XCTAssertTrue(file.contains("tags: [a, b]"))
    }
}

final class ArchiveTests: XCTestCase {
    func testRoundTrip() throws {
        var entry = EntrySnapshot(
            day: DayKey(year: 2027, month: 1, day: 1),
            createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_800_000_500),
            title: "标题",
            text: "正文内容",
            mood: .calm,
            tags: ["工作"],
            isPinned: true
        )
        entry.id = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!

        let archive = ArchiveCodec.makeArchive(entries: [entry])
        let data = try ArchiveCodec.encode(archive)
        let decoded = try ArchiveCodec.decode(data)

        XCTAssertEqual(decoded.version, DuskArchive.currentVersion)
        XCTAssertEqual(decoded.entries.count, 1)
        XCTAssertEqual(decoded.entries[0].day, entry.day)
        XCTAssertEqual(decoded.entries[0].text, entry.text)
        XCTAssertEqual(decoded.entries[0].mood, .calm)
        XCTAssertEqual(decoded.entries[0].tags, ["工作"])
        XCTAssertEqual(decoded.entries[0].isPinned, true)
        XCTAssertEqual(decoded.entries[0].updatedAt, entry.updatedAt)
    }

    func testMergeAddsUpdatesAndSkips() {
        let day1 = DayKey(year: 2027, month: 1, day: 1)
        let day2 = DayKey(year: 2027, month: 1, day: 2)

        var existingEntry = EntrySnapshot(day: day1, text: "旧文本")
        existingEntry.updatedAt = Date(timeIntervalSince1970: 200)
        var olderIncoming = EntrySnapshot(day: day1, text: "更旧的文本")
        olderIncoming.updatedAt = Date(timeIntervalSince1970: 100)
        var newerIncoming = EntrySnapshot(day: day1, text: "新文本")
        newerIncoming.updatedAt = Date(timeIntervalSince1970: 300)
        let brandNew = EntrySnapshot(day: day2, text: "新的一天")

        let result = ArchiveMerger.merge(existing: [existingEntry], incoming: [olderIncoming, brandNew])

        XCTAssertEqual(result.added, 1)
        XCTAssertEqual(result.updated, 0)
        XCTAssertEqual(result.skipped, 1)
        XCTAssertEqual(result.entries.count, 2)

        let second = ArchiveMerger.merge(existing: [existingEntry], incoming: [newerIncoming])
        XCTAssertEqual(second.updated, 1)
        XCTAssertEqual(second.entries[0].text, "新文本")
    }
}

final class PromptsTests: XCTestCase {
    func testDailyPromptIsStableForSameDay() {
        let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        let day = DayKey(year: 2027, month: 3, day: 14)
        XCTAssertEqual(Prompts.daily(for: day, calendar: calendar), Prompts.daily(for: day, calendar: calendar))
    }

    func testPromptRotatesAcrossDays() {
        let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        let first = Prompts.daily(for: DayKey(year: 2027, month: 1, day: 1), calendar: calendar)
        let second = Prompts.daily(for: DayKey(year: 2027, month: 1, day: 2), calendar: calendar)
        XCTAssertNotEqual(first, second)
    }

    func testNextWrapsAround() {
        let last = Prompts.all[Prompts.all.count - 1]
        XCTAssertEqual(Prompts.next(after: last), Prompts.all[0])
    }

    func testPromptsAreUnique() {
        XCTAssertEqual(Set(Prompts.all.map(\.id)).count, Prompts.all.count)
        XCTAssertEqual(Set(Prompts.all.map(\.text)).count, Prompts.all.count)
    }
}

final class EntrySnapshotTests: XCTestCase {
    func testSummaryFallsBackToFirstLine() {
        let entry = EntrySnapshot(day: DayKey(year: 2027, month: 1, day: 1), text: "\n\n今天很累。\n但还是写了。")
        XCTAssertEqual(entry.summary(), "今天很累。")
    }

    func testSummaryTruncates() {
        let entry = EntrySnapshot(day: DayKey(year: 2027, month: 1, day: 1), text: String(repeating: "字", count: 100))
        XCTAssertEqual(entry.summary(limit: 10).count, 11)
    }

    func testEmptyDetection() {
        XCTAssertTrue(EntrySnapshot(day: DayKey(year: 2027, month: 1, day: 1), text: "   ").isEmpty)
        XCTAssertFalse(EntrySnapshot(day: DayKey(year: 2027, month: 1, day: 1), text: "x").isEmpty)
    }
}
