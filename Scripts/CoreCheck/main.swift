// 在没有 Xcode 的机器上，用 swiftc 直接编译并跑一遍核心逻辑的冒烟测试。
// 用法：Scripts/check-core.sh
import Foundation

var failures = 0
var checks = 0

func check(_ condition: Bool, _ message: String) {
    checks += 1
    if !condition {
        failures += 1
        print("✗ \(message)")
    }
}

func equal<T: Equatable>(_ lhs: T, _ rhs: T, _ message: String) {
    check(lhs == rhs, "\(message)（期望 \(rhs)，实际 \(lhs)）")
}

let calendar = JournalCalendar.make(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

// MARK: - DayKey

let newYear = DayKey(year: 2027, month: 1, day: 1)
equal(newYear.iso, "2027-01-01", "ISO 输出")
equal(DayKey(iso: "2027-01-01"), newYear, "ISO 解析")
check(DayKey(iso: "2027-1") == nil, "非法 ISO 返回 nil")
equal(DayKey(year: 2026, month: 12, day: 31).adding(days: 1, calendar: calendar), newYear, "跨年 +1 天")
equal(DayKey(year: 2028, month: 2, day: 28).adding(days: 1, calendar: calendar), DayKey(year: 2028, month: 2, day: 29), "闰年 2 月 29 日")
equal(DayKey(year: 2028, month: 2, day: 28).dayOfYear(calendar: calendar), 59, "闰年序数")
equal(newYear.weekdayIndex(calendar: calendar), 6, "2027-01-01 是周五")
equal(DateText.weekday(newYear, calendar: calendar), "周五", "周五文案")
equal(newYear.daysSince(DayKey(year: 2026, month: 12, day: 31), calendar: calendar), 1, "相差一天")
equal(
    [DayKey(year: 2027, month: 2, day: 1), DayKey(year: 2026, month: 12, day: 31), DayKey(year: 2027, month: 1, day: 15)].sorted().map(\.iso),
    ["2026-12-31", "2027-01-15", "2027-02-01"],
    "日期排序"
)
equal(DateText.full(newYear), "2027年1月1日", "完整日期文案")
equal(DateText.relative(DayKey(year: 2027, month: 1, day: 2), to: newYear), "明天", "相对日期")

// MARK: - 分组

func makeEntry(_ iso: String, text: String = "正文") -> EntrySnapshot {
    EntrySnapshot(day: DayKey(iso: iso)!, text: text)
}

let grouped = Grouping.sections([
    makeEntry("2027-01-01"),
    makeEntry("2027-01-20"),
    makeEntry("2027-03-05"),
    makeEntry("2026-12-31")
])
equal(grouped.map(\.year), [2027, 2026], "年份分组顺序")
equal(grouped[0].months.map(\.key.month), [3, 1], "月份分组顺序")
equal(grouped[0].months[1].count, 2, "一月两篇")
equal(grouped[0].count, 3, "2027 年三篇")

let ascending = Grouping.sections([makeEntry("2027-03-05"), makeEntry("2027-01-01")], newestFirst: false)
equal(ascending[0].months.map(\.key.month), [1, 3], "正序分组")

var older = makeEntry("2027-01-01", text: "旧")
older.updatedAt = Date(timeIntervalSince1970: 100)
var newer = makeEntry("2027-01-01", text: "新")
newer.updatedAt = Date(timeIntervalSince1970: 200)
equal(Grouping.byDay([older, newer])[DayKey(iso: "2027-01-01")!]?.text, "新", "按天索引取更新的那篇")

// MARK: - 统计

func entries(_ isos: [String]) -> [EntrySnapshot] {
    isos.map { makeEntry($0, text: "一二三") }
}

equal(JournalStats.compute(entries: [], referenceDay: newYear, calendar: calendar).totalEntries, 0, "空统计")
equal(JournalStats.compute(entries: entries(["2027-01-01", "2027-01-02", "2027-01-03"]), referenceDay: DayKey(iso: "2027-01-03")!, calendar: calendar).currentStreak, 3, "连续三天")
equal(JournalStats.compute(entries: entries(["2027-01-01", "2027-01-02"]), referenceDay: DayKey(iso: "2027-01-03")!, calendar: calendar).currentStreak, 2, "今天没写不断签")
equal(JournalStats.compute(entries: entries(["2027-01-01", "2027-01-02"]), referenceDay: DayKey(iso: "2027-01-05")!, calendar: calendar).currentStreak, 0, "隔了三天算断签")
let gapStats = JournalStats.compute(
    entries: entries(["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-10", "2027-02-01", "2027-02-02"]),
    referenceDay: DayKey(iso: "2027-02-02")!,
    calendar: calendar
)
equal(gapStats.longestStreak, 3, "最长连续")
equal(gapStats.daysWritten, 6, "写过的天数")
equal(gapStats.totalCharacters, 18, "总字数")
equal(gapStats.entries(in: 2027), 6, "当年篇数")
equal(gapStats.monthlyCounts(in: 2027)[0], 4, "一月篇数")
equal(gapStats.monthlyCounts(in: 2027)[1], 2, "二月篇数")
equal(gapStats.monthlyCounts(in: 2027)[2], 0, "三月篇数")

var tagged = entries(["2027-01-01", "2027-01-02"])
tagged[0].tags = ["旅行", "朋友"]
tagged[1].tags = ["旅行"]
tagged[0].mood = .great
let tagStats = JournalStats.compute(entries: tagged, referenceDay: DayKey(iso: "2027-01-02")!, calendar: calendar)
equal(tagStats.topTags().first?.tag, "旅行", "最多的标签")
equal(tagStats.topTags().first?.count, 2, "标签次数")
equal(tagStats.moodCounts[.great], 1, "心情计数")

// MARK: - Markdown

var markdownEntry = makeEntry("2027-01-01", text: "今天去了海边。\n风很大。")
markdownEntry.title = "海边"
markdownEntry.mood = .good
markdownEntry.tags = ["旅行"]
let yearMarkdown = MarkdownExporter.year([markdownEntry], year: 2027, calendar: calendar)
check(yearMarkdown.contains("# 2027 年 · 朝夕"), "年度标题")
check(yearMarkdown.contains("> 1 篇 · 1 天"), "年度统计行")
check(yearMarkdown.contains("## 一月"), "月份标题")
check(yearMarkdown.contains("### 1月1日 周五 · 不错"), "日期标题")
check(yearMarkdown.contains("#旅行"), "标签")
check(yearMarkdown.contains("今天去了海边。"), "正文")
check(MarkdownExporter.year([], year: 2027, calendar: calendar).contains("这一年还没有记录"), "空年份")
check(MarkdownExporter.singleFile(markdownEntry, calendar: calendar).hasPrefix("---\ndate: 2027-01-01"), "单篇 front matter")

// MARK: - 存档

var archived = makeEntry("2027-01-01", text: "正文内容")
archived.createdAt = Date(timeIntervalSince1970: 1_800_000_000)
archived.updatedAt = Date(timeIntervalSince1970: 1_800_000_500)
archived.title = "标题"
archived.mood = .calm
archived.tags = ["工作"]
archived.isPinned = true

do {
    let data = try ArchiveCodec.encode(ArchiveCodec.makeArchive(entries: [archived]))
    let decoded = try ArchiveCodec.decode(data)
    equal(decoded.entries.count, 1, "存档条目数")
    equal(decoded.entries[0].text, "正文内容", "存档正文")
    equal(decoded.entries[0].mood, .calm, "存档心情")
    equal(decoded.entries[0].tags, ["工作"], "存档标签")
    equal(decoded.entries[0].isPinned, true, "存档置顶")
    equal(decoded.entries[0].updatedAt, archived.updatedAt, "存档时间")
} catch {
    check(false, "存档编解码抛错：\(error)")
}

let mergeResult = ArchiveMerger.merge(existing: [older], incoming: [newer, makeEntry("2027-01-02")])
equal(mergeResult.added, 1, "合并新增")
equal(mergeResult.updated, 1, "合并更新")
equal(mergeResult.skipped, 0, "合并跳过")
equal(mergeResult.entries.count, 2, "合并总数")

var stale = makeEntry("2027-01-01", text: "过期的")
stale.updatedAt = Date(timeIntervalSince1970: 50)
let skipResult = ArchiveMerger.merge(existing: [newer], incoming: [stale])
equal(skipResult.skipped, 1, "旧数据被跳过")
equal(skipResult.entries[0].text, "新", "保留较新的内容")

// MARK: - 提示

equal(Prompts.daily(for: DayKey(year: 2027, month: 3, day: 14), calendar: calendar), Prompts.daily(for: DayKey(year: 2027, month: 3, day: 14), calendar: calendar), "同一天提示固定")
check(Prompts.daily(for: DayKey(year: 2027, month: 1, day: 1), calendar: calendar) != Prompts.daily(for: DayKey(year: 2027, month: 1, day: 2), calendar: calendar), "相邻两天提示不同")
equal(Prompts.next(after: Prompts.all[Prompts.all.count - 1]), Prompts.all[0], "提示循环")
equal(Set(Prompts.all.map(\.id)).count, Prompts.all.count, "提示 id 唯一")
equal(Set(Prompts.all.map(\.text)).count, Prompts.all.count, "提示文案唯一")

// MARK: - 摘要

let summaryEntry = EntrySnapshot(day: newYear, text: "\n\n今天很累。\n但还是写了。")
equal(summaryEntry.summary(), "今天很累。", "摘要取第一行")
equal(EntrySnapshot(day: newYear, text: String(repeating: "字", count: 100)).summary(limit: 10).count, 11, "摘要截断")
check(EntrySnapshot(day: newYear, text: "   ").isEmpty, "空白判定")
check(!EntrySnapshot(day: newYear, text: "x").isEmpty, "有内容判定")

// MARK: - 结果

print("")
if failures == 0 {
    print("✓ 全部 \(checks) 项检查通过")
    exit(0)
} else {
    print("✗ \(failures)/\(checks) 项检查失败")
    exit(1)
}
