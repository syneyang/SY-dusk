import Foundation

/// 当天心情，用五个档位足够，不追求精确。
public enum Mood: String, Codable, CaseIterable, Sendable, Identifiable {
    case great
    case good
    case calm
    case tired
    case low

    public var id: String { rawValue }

    /// 界面上显示的符号。
    public var symbol: String {
        switch self {
        case .great: return "😄"
        case .good: return "🙂"
        case .calm: return "😌"
        case .tired: return "😮‍💨"
        case .low: return "😔"
        }
    }

    public var label: String {
        switch self {
        case .great: return "很好"
        case .good: return "不错"
        case .calm: return "平静"
        case .tired: return "疲惫"
        case .low: return "低落"
        }
    }
}

/// 一篇日记的纯数据形态。
///
/// 刻意不依赖 SwiftData / UIKit，这样它既能被 App 用，也能在命令行里跑测试，
/// 还是导出 JSON 时的稳定格式。
public struct EntrySnapshot: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    /// 这篇日记属于哪一天。全库唯一，一天的日记只有一篇。
    public var day: DayKey
    public var createdAt: Date
    public var updatedAt: Date
    /// 可选的小标题，留空时用当天的第一句话代替。
    public var title: String
    /// 正文，纯文本 + 换行；将来可以升级成 markdown。
    public var text: String
    public var mood: Mood?
    public var tags: [String]
    public var isPinned: Bool

    public init(
        id: UUID = UUID(),
        day: DayKey,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        title: String = "",
        text: String = "",
        mood: Mood? = nil,
        tags: [String] = [],
        isPinned: Bool = false
    ) {
        self.id = id
        self.day = day
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.title = title
        self.text = text
        self.mood = mood
        self.tags = tags
        self.isPinned = isPinned
    }

    /// 正文的字符数（中文一个字算一个）。
    public var characterCount: Int {
        text.count
    }

    /// 正文里去掉空行后的行，用来做占位、摘要。
    public var nonEmptyLines: [String] {
        text
            .split(separator: "\n", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// 列表里显示的一行摘要：优先用标题，其次用第一句正文。
    public func summary(limit: Int = 60) -> String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let source = trimmedTitle.isEmpty ? (nonEmptyLines.first ?? "") : trimmedTitle
        if source.count <= limit { return source }
        return String(source.prefix(limit)) + "…"
    }

    public var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
