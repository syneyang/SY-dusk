import Foundation

/// 把日记导出成 Markdown：方便放进 Obsidian / iCloud 备忘录 / 任何编辑器里长期保存。
public enum MarkdownExporter {

    /// 整年一份文件。
    public static func year(_ entries: [EntrySnapshot], year: Int, calendar: Calendar = .current) -> String {
        let yearEntries = entries.filter { $0.day.year == year }.sorted { $0.day < $1.day }
        guard !yearEntries.isEmpty else {
            return "# \(year) 年\n\n这一年还没有记录。\n"
        }

        let days = Set(yearEntries.map(\.day)).count
        let characters = yearEntries.reduce(0) { $0 + $1.characterCount }

        var lines: [String] = []
        lines.append("# \(year) 年 · 朝夕")
        lines.append("")
        lines.append("> \(yearEntries.count) 篇 · \(days) 天 · 约 \(characters) 字")
        lines.append("")

        let months = Grouping.sections(yearEntries, newestFirst: false)
        for section in months {
            for month in section.months {
                lines.append("## \(DateText.monthName(month.key.month))")
                lines.append("")
                for entry in month.entries {
                    lines.append(contentsOf: entryBlock(entry, calendar: calendar, headingLevel: 3))
                }
            }
        }

        return lines.joined(separator: "\n") + "\n"
    }

    /// 所有年份合成一份。
    public static func all(_ entries: [EntrySnapshot], calendar: Calendar = .current) -> String {
        let years = Set(entries.map(\.day.year)).sorted(by: >)
        guard !years.isEmpty else { return "# 朝夕\n\n还没有记录。\n" }

        var lines: [String] = ["# 朝夕 · 全部日记", ""]
        let days = Set(entries.map(\.day)).count
        let characters = entries.reduce(0) { $0 + $1.characterCount }
        lines.append("> \(entries.count) 篇 · \(days) 天 · 约 \(characters) 字 · 导出于 \(DateText.full(.today(calendar: calendar)))")
        lines.append("")

        for year in years {
            let yearEntries = entries.filter { $0.day.year == year }.sorted { $0.day < $1.day }
            lines.append("## \(year) 年")
            lines.append("")
            for section in Grouping.sections(yearEntries, newestFirst: false) {
                for month in section.months {
                    for entry in month.entries {
                        lines.append(contentsOf: entryBlock(entry, calendar: calendar, headingLevel: 3))
                    }
                }
            }
        }

        return lines.joined(separator: "\n") + "\n"
    }

    /// 单篇导出（Obsidian 的「一天一个文件」模式，带 front matter）。
    public static func singleFile(_ entry: EntrySnapshot, calendar: Calendar = .current) -> String {
        var lines: [String] = []
        lines.append("---")
        lines.append("date: \(entry.day.iso)")
        if let mood = entry.mood {
            lines.append("mood: \(mood.rawValue)")
        }
        if !entry.tags.isEmpty {
            lines.append("tags: [\(entry.tags.joined(separator: ", "))]")
        }
        lines.append("created: \(ISO8601DateFormatter().string(from: entry.createdAt))")
        lines.append("---")
        lines.append("")
        lines.append(contentsOf: bodyLines(entry, calendar: calendar))
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: - 内部

    private static func entryBlock(_ entry: EntrySnapshot, calendar: Calendar, headingLevel: Int) -> [String] {
        var lines: [String] = []
        let hashes = String(repeating: "#", count: headingLevel)
        var heading = "\(hashes) \(DateText.monthDay(entry.day)) \(DateText.weekday(entry.day, calendar: calendar))"
        if let mood = entry.mood {
            heading += " · \(mood.label)"
        }
        if entry.isPinned {
            heading += " 📌"
        }
        lines.append(heading)
        lines.append("")
        lines.append(contentsOf: bodyLines(entry, calendar: calendar))
        return lines
    }

    private static func bodyLines(_ entry: EntrySnapshot, calendar: Calendar) -> [String] {
        var lines: [String] = []
        let title = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty {
            lines.append("**\(title)**")
            lines.append("")
        }
        if !entry.tags.isEmpty {
            lines.append(entry.tags.map { "#\($0.replacingOccurrences(of: " ", with: "-"))" }.joined(separator: " "))
            lines.append("")
        }
        let body = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
        lines.append(body.isEmpty ? "（没有正文）" : body)
        lines.append("")
        lines.append("---")
        lines.append("")
        return lines
    }
}
