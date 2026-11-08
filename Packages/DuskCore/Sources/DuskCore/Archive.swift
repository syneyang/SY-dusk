import Foundation

/// 全量备份文件的结构。给用户留一条「数据永远能拿出来」的退路，
/// 也是以后换设备、同步到别处的基础。
public struct DuskArchive: Codable, Sendable {
    public static let currentVersion = 1
    public static let appIdentifier = "com.syneyang.dusk"

    public var version: Int
    public var app: String
    public var exportedAt: Date
    public var entries: [EntrySnapshot]

    public init(
        version: Int = DuskArchive.currentVersion,
        app: String = DuskArchive.appIdentifier,
        exportedAt: Date = Date(),
        entries: [EntrySnapshot]
    ) {
        self.version = version
        self.app = app
        self.exportedAt = exportedAt
        self.entries = entries
    }
}

public enum ArchiveCodec {
    public static func makeArchive(entries: [EntrySnapshot], now: Date = Date()) -> DuskArchive {
        DuskArchive(exportedAt: now, entries: entries.sorted { $0.day < $1.day })
    }

    public static func encode(_ archive: DuskArchive) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(archive)
    }

    public static func decode(_ data: Data) throws -> DuskArchive {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(DuskArchive.self, from: data)
    }
}

public struct MergeResult: Sendable {
    public let entries: [EntrySnapshot]
    public let added: Int
    public let updated: Int
    public let skipped: Int

    public init(entries: [EntrySnapshot], added: Int, updated: Int, skipped: Int) {
        self.entries = entries
        self.added = added
        self.updated = updated
        self.skipped = skipped
    }
}

public enum ArchiveMerger {
    /// 导入时合并两批日记：同一天只保留 `updatedAt` 更新的那一篇，
    /// 不会因为重复导入而丢数据，也不会产生重复条目。
    public static func merge(existing: [EntrySnapshot], incoming: [EntrySnapshot]) -> MergeResult {
        var merged: [DayKey: EntrySnapshot] = [:]
        for entry in existing {
            merged[entry.day] = entry
        }

        var added = 0
        var updated = 0
        var skipped = 0

        for entry in incoming {
            if let current = merged[entry.day] {
                if entry.updatedAt > current.updatedAt {
                    merged[entry.day] = entry
                    updated += 1
                } else {
                    skipped += 1
                }
            } else {
                merged[entry.day] = entry
                added += 1
            }
        }

        let result = merged.values.sorted { $0.day < $1.day }
        return MergeResult(entries: result, added: added, updated: updated, skipped: skipped)
    }
}
