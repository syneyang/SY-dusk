import Foundation
import SwiftData
import DuskCore

/// 所有对本地库的读写都从这里走，界面层只跟它打交道。
enum JournalStore {
    static func fetch(day: DayKey, in context: ModelContext, calendar: Calendar = .current) -> JournalEntry? {
        let start = day.startOfDay(calendar: calendar)
        var descriptor = FetchDescriptor<JournalEntry>(
            predicate: #Predicate<JournalEntry> { $0.dayStart == start }
        )
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    static func fetch(id: UUID, in context: ModelContext) -> JournalEntry? {
        var descriptor = FetchDescriptor<JournalEntry>(
            predicate: #Predicate<JournalEntry> { $0.id == id }
        )
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    /// 取某天的日记，没有就新建一条（调用方负责决定要不要保存）。
    @discardableResult
    static func entry(for day: DayKey, in context: ModelContext, calendar: Calendar = .current) -> JournalEntry {
        if let existing = fetch(day: day, in: context, calendar: calendar) {
            return existing
        }
        let entry = JournalEntry(dayStart: day.startOfDay(calendar: calendar))
        context.insert(entry)
        return entry
    }

    static func allSnapshots(in context: ModelContext) -> [EntrySnapshot] {
        let descriptor = FetchDescriptor<JournalEntry>(
            sortBy: [SortDescriptor(\JournalEntry.dayStart, order: .forward)]
        )
        return ((try? context.fetch(descriptor)) ?? []).map(\.snapshot)
    }

    static func save(_ context: ModelContext) {
        do {
            try context.save()
        } catch {
            assertionFailure("保存日记失败：\(error)")
        }
    }

    static func delete(_ entry: JournalEntry, in context: ModelContext) {
        context.delete(entry)
        save(context)
    }

    static func deleteAll(in context: ModelContext) {
        let all = (try? context.fetch(FetchDescriptor<JournalEntry>())) ?? []
        for entry in all {
            context.delete(entry)
        }
        save(context)
    }

    /// 导入备份：按天合并，同一天保留更新时间更晚的那篇。
    @discardableResult
    static func importArchive(_ archive: DuskArchive, into context: ModelContext) -> MergeResult {
        let existing = allSnapshots(in: context)
        let result = ArchiveMerger.merge(existing: existing, incoming: archive.entries)
        for snapshot in result.entries {
            if let entry = fetch(day: snapshot.day, in: context) {
                entry.apply(snapshot)
            } else {
                context.insert(JournalEntry(snapshot: snapshot))
            }
        }
        save(context)
        return result
    }
}
