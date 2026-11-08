import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import DuskCore

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \JournalEntry.dayStart, order: .reverse)
    private var entries: [JournalEntry]
    @AppStorage(SettingsKey.journeyStart) private var journeyStartISO: String = SettingsKey.defaultJourneyStart

    @State private var shareItem: ShareItem?
    @State private var showImporter = false
    @State private var showDeleteAll = false
    @State private var showAbout = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                journeySection
                exportSection
                importSection
                aboutSection
                dangerSection
            }
            .navigationTitle("设置")
            .scrollContentBackground(.hidden)
            .background(Palette.paper.ignoresSafeArea())
            .tint(Palette.dawn)
            .sheet(item: $shareItem) { item in
                ShareSheet(items: [item.url])
            }
            .sheet(isPresented: $showAbout) {
                AboutView()
            }
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: [.json],
                allowsMultipleSelection: false
            ) { result in
                handleImport(result)
            }
            .alert(
                "提示",
                isPresented: Binding(
                    get: { message != nil },
                    set: { if !$0 { message = nil } }
                )
            ) {
                Button("好", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
            .confirmationDialog(
                "清空所有日记？这会删除本机上的全部记录，且无法撤销。",
                isPresented: $showDeleteAll,
                titleVisibility: .visible
            ) {
                Button("全部删除", role: .destructive) {
                    JournalStore.deleteAll(in: context)
                    message = "已经清空。建议以后定期导出备份。"
                }
                Button("取消", role: .cancel) {}
            }
        }
    }

    // MARK: - 区块

    private var journeySection: some View {
        Section {
            DatePicker(
                "开始记录的日子",
                selection: startBinding,
                displayedComponents: .date
            )
            LabeledContent("已经写了", value: "\(entries.count) 篇")
            if let first = entries.last?.day, let last = entries.first?.day {
                LabeledContent("第一笔", value: DateText.full(first))
                LabeledContent("最近一笔", value: DateText.full(last))
            }
        } header: {
            Text("旅程")
        } footer: {
            Text("「第几天」按这个日期计算。默认从 2027 年 1 月 1 日开始。")
        }
    }

    private var exportSection: some View {
        Section {
            Button {
                exportJSON()
            } label: {
                Label("备份全部（JSON）", systemImage: "archivebox")
            }

            Button {
                exportMarkdownAll()
            } label: {
                Label("全部日记（Markdown）", systemImage: "doc.text")
            }
        } header: {
            Text("导出")
        } footer: {
            Text("JSON 是给这台 App 自己用的完整备份；Markdown 可以直接放进 Obsidian、备忘录或任何编辑器里阅读。")
        }
    }

    private var importSection: some View {
        Section {
            Button {
                showImporter = true
            } label: {
                Label("从备份恢复…", systemImage: "square.and.arrow.down")
            }
        } header: {
            Text("导入")
        } footer: {
            Text("导入采用「按天合并」：同一天以更新的那一篇为准，不会覆盖掉你后写的内容。")
        }
    }

    private var aboutSection: some View {
        Section {
            Button {
                showAbout = true
            } label: {
                Label("关于「朝夕」", systemImage: "sun.horizon")
            }
            LabeledContent("版本", value: "0.1.0")
        } header: {
            Text("关于")
        } footer: {
            Text("所有内容只保存在这台 iPhone 上，没有账号，没有服务器，不会上传任何东西。")
        }
    }

    private var dangerSection: some View {
        Section {
            Button(role: .destructive) {
                showDeleteAll = true
            } label: {
                Label("清空全部日记", systemImage: "trash")
            }
        }
    }

    // MARK: - 逻辑

    private var startBinding: Binding<Date> {
        Binding(
            get: { Journey.start(from: journeyStartISO).startOfDay() },
            set: { journeyStartISO = DayKey($0).iso }
        )
    }

    private func exportJSON() {
        do {
            let snapshots = entries.map(\.snapshot)
            shareItem = ShareItem(url: try Exporter.jsonBackup(entries: snapshots))
        } catch {
            message = "导出失败：\(error.localizedDescription)"
        }
    }

    private func exportMarkdownAll() {
        do {
            let snapshots = entries.map(\.snapshot)
            shareItem = ShareItem(url: try Exporter.markdownAll(entries: snapshots))
        } catch {
            message = "导出失败：\(error.localizedDescription)"
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            do {
                let archive = try Exporter.readArchive(from: url)
                let merged = JournalStore.importArchive(archive, into: context)
                message = "导入完成：新增 \(merged.added) 篇，更新 \(merged.updated) 篇，跳过 \(merged.skipped) 篇。"
            } catch {
                message = "这个文件读不出来，可能不是朝夕的备份。\n\(error.localizedDescription)"
            }
        case .failure(let error):
            message = "导入失败：\(error.localizedDescription)"
        }
    }
}
