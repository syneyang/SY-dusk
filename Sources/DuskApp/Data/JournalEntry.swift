import Foundation
import SwiftData
import DuskCore

/// SwiftData 里存的一天。字段刻意保持扁平，方便查询和迁移。
/// 真正的业务逻辑都在 DuskCore 的 `EntrySnapshot` 上。
@Model
final class JournalEntry {
    @Attribute(.unique) var id: UUID
    /// 当天 00:00，作为「这一天」的唯一标识。
    var dayStart: Date
    var createdAt: Date
    var updatedAt: Date
    var title: String
    var text: String
    /// 存 rawValue，避免迁移时枚举变动影响数据库。
    var moodRaw: String?
    /// 标签用逗号拼起来存，查询简单。
    var tagsLine: String
    var isPinned: Bool

    init(
        id: UUID = UUID(),
        dayStart: Date,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        title: String = "",
        text: String = "",
        mood: Mood? = nil,
        tags: [String] = [],
        isPinned: Bool = false
    ) {
        self.id = id
        self.dayStart = dayStart
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.title = title
        self.text = text
        self.moodRaw = mood?.rawValue
        self.tagsLine = tags.joined(separator: ",")
        self.isPinned = isPinned
    }

    convenience init(snapshot: EntrySnapshot) {
        self.init(
            id: snapshot.id,
            dayStart: snapshot.day.startOfDay(),
            createdAt: snapshot.createdAt,
            updatedAt: snapshot.updatedAt,
            title: snapshot.title,
            text: snapshot.text,
            mood: snapshot.mood,
            tags: snapshot.tags,
            isPinned: snapshot.isPinned
        )
    }

    var day: DayKey {
        DayKey(dayStart)
    }

    var mood: Mood? {
        get { moodRaw.flatMap(Mood.init(rawValue:)) }
        set { moodRaw = newValue?.rawValue }
    }

    var tags: [String] {
        get {
            tagsLine
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        }
        set {
            tagsLine = newValue
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .joined(separator: ",")
        }
    }

    var snapshot: EntrySnapshot {
        EntrySnapshot(
            id: id,
            day: day,
            createdAt: createdAt,
            updatedAt: updatedAt,
            title: title,
            text: text,
            mood: mood,
            tags: tags,
            isPinned: isPinned
        )
    }

    /// 用快照覆盖内容，时间戳照抄（导入时保持原来的先后顺序）。
    func apply(_ snapshot: EntrySnapshot) {
        id = snapshot.id
        dayStart = snapshot.day.startOfDay()
        createdAt = snapshot.createdAt
        updatedAt = snapshot.updatedAt
        title = snapshot.title
        text = snapshot.text
        mood = snapshot.mood
        tags = snapshot.tags
        isPinned = snapshot.isPinned
    }
}
