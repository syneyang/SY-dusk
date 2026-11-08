import Foundation
import DuskCore

/// 把日记写成临时文件，交给系统的分享面板（存到「文件」、AirDrop、发给自己都行）。
enum Exporter {
    static func temporaryFile(named name: String, content: String) throws -> URL {
        try temporaryFile(named: name, data: Data(content.utf8))
    }

    static func temporaryFile(named name: String, data: Data) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("DuskExport", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        try data.write(to: url, options: .atomic)
        return url
    }

    static func jsonBackup(entries: [EntrySnapshot]) throws -> URL {
        let data = try ArchiveCodec.encode(ArchiveCodec.makeArchive(entries: entries))
        let stamp = DayKey(Date()).iso
        return try temporaryFile(named: "朝夕备份-\(stamp).json", data: data)
    }

    static func markdownAll(entries: [EntrySnapshot]) throws -> URL {
        try temporaryFile(
            named: "朝夕-全部日记.md",
            content: MarkdownExporter.all(entries)
        )
    }

    static func markdownYear(entries: [EntrySnapshot], year: Int) throws -> URL {
        try temporaryFile(
            named: "朝夕-\(year)年.md",
            content: MarkdownExporter.year(entries, year: year)
        )
    }

    static func readArchive(from url: URL) throws -> DuskArchive {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        return try ArchiveCodec.decode(data)
    }
}
