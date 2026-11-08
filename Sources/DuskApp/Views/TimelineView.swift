import SwiftUI
import SwiftData
import DuskCore

/// 全部日记，按「年 → 月」排好，可以搜索、可以回改。
struct TimelineView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \JournalEntry.dayStart, order: .reverse)
    private var entries: [JournalEntry]

    @State private var searchText = ""
    @State private var yearFilter: Int?
    @State private var editingSnapshot: EntrySnapshot?
    @State private var deleteTarget: EntrySnapshot?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if sections.isEmpty {
                        emptyState
                    } else {
                        ForEach(sections) { section in
                            yearHeader(section)
                            ForEach(section.months) { month in
                                monthHeader(month)
                                ForEach(month.entries) { snapshot in
                                    row(snapshot)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
            .background(Palette.paper.ignoresSafeArea())
            .navigationTitle("时光")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $searchText, prompt: "搜一段记忆")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    yearMenu
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editingSnapshot = EntrySnapshot(day: .today())
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .sheet(item: $editingSnapshot) { snapshot in
                EntryEditorView(snapshot: snapshot)
            }
            .confirmationDialog(
                "删除这一天的记录？",
                isPresented: Binding(
                    get: { deleteTarget != nil },
                    set: { if !$0 { deleteTarget = nil } }
                ),
                presenting: deleteTarget
            ) { target in
                Button("删除", role: .destructive) {
                    delete(target)
                }
                Button("取消", role: .cancel) {
                    deleteTarget = nil
                }
            } message: { target in
                Text("\(DateText.full(target.day)) 的记录会被删掉，无法恢复。")
            }
        }
    }

    // MARK: - 数据

    private var snapshots: [EntrySnapshot] {
        entries.map(\.snapshot)
    }

    private var filtered: [EntrySnapshot] {
        var list = snapshots
        if let yearFilter {
            list = list.filter { $0.day.year == yearFilter }
        }
        let query = searchText.trimmingCharacters(in: .whitespaces)
        if !query.isEmpty {
            list = list.filter { entry in
                entry.text.localizedCaseInsensitiveContains(query)
                    || entry.title.localizedCaseInsensitiveContains(query)
                    || entry.tags.contains { $0.localizedCaseInsensitiveContains(query) }
            }
        }
        return list
    }

    private var sections: [YearSection] {
        Grouping.sections(filtered)
    }

    private var availableYears: [Int] {
        Set(snapshots.map(\.day.year)).sorted(by: >)
    }

    // MARK: - 子视图

    private var emptyState: some View {
        Group {
            if snapshots.isEmpty {
                EmptyNote(
                    symbol: "book.closed",
                    title: "还是一片空白",
                    message: "在「今天」写下第一篇，\n它就会出现在这里。"
                )
            } else {
                EmptyNote(
                    symbol: "magnifyingglass",
                    title: "没找到",
                    message: "换个词试试，或者切回「全部年份」。"
                )
            }
        }
    }

    private var yearMenu: some View {
        Menu {
            Button {
                yearFilter = nil
            } label: {
                if yearFilter == nil {
                    Label("全部年份", systemImage: "checkmark")
                } else {
                    Text("全部年份")
                }
            }
            ForEach(availableYears, id: \.self) { year in
                Button {
                    yearFilter = year
                } label: {
                    if yearFilter == year {
                        Label("\(String(year)) 年", systemImage: "checkmark")
                    } else {
                        Text("\(String(year)) 年")
                    }
                }
            }
        } label: {
            Text(yearFilter.map { "\(String($0)) 年" } ?? "全部")
                .font(.subheadline.weight(.medium))
        }
    }

    private func yearHeader(_ section: YearSection) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(String(section.year))")
                .font(Typeface.serif(30))
                .foregroundStyle(Palette.ink)
            Text("年 · \(section.count) 篇")
                .font(.caption)
                .foregroundStyle(Palette.inkSoft)
            Spacer()
        }
        .padding(.top, 26)
        .padding(.bottom, 4)
    }

    private func monthHeader(_ month: MonthSection) -> some View {
        HStack(spacing: 8) {
            Text(DateText.monthName(month.key.month))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.dusk)
            Rectangle()
                .fill(Palette.hairline)
                .frame(height: 1)
            Text("\(month.count)")
                .font(.caption2)
                .foregroundStyle(Palette.inkSoft)
        }
        .padding(.top, 18)
        .padding(.bottom, 2)
    }

    private func row(_ snapshot: EntrySnapshot) -> some View {
        Button {
            editingSnapshot = snapshot
        } label: {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 1) {
                    Text("\(snapshot.day.day)")
                        .font(Typeface.serif(21))
                        .foregroundStyle(Palette.ink)
                    Text(DateText.weekday(snapshot.day))
                        .font(.caption2)
                        .foregroundStyle(Palette.inkSoft)
                }
                .frame(width: 36)

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 5) {
                        Text(headline(of: snapshot))
                            .font(Typeface.serif(16))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                        if snapshot.isPinned {
                            Image(systemName: "pin.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(Palette.dawn)
                        }
                    }
                    if !preview(of: snapshot).isEmpty {
                        Text(preview(of: snapshot))
                            .font(.footnote)
                            .foregroundStyle(Palette.inkSoft)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    HStack(spacing: 8) {
                        if let mood = snapshot.mood {
                            Text("\(mood.symbol) \(mood.label)")
                                .font(.caption2)
                                .foregroundStyle(Palette.inkSoft)
                        }
                        ForEach(snapshot.tags.prefix(3), id: \.self) { tag in
                            Text("#\(tag)")
                                .font(.caption2)
                                .foregroundStyle(Palette.dusk)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                togglePin(snapshot)
            } label: {
                Label(snapshot.isPinned ? "取消置顶" : "置顶", systemImage: "pin")
            }
            Button(role: .destructive) {
                deleteTarget = snapshot
            } label: {
                Label("删除", systemImage: "trash")
            }
        }
    }

    private func headline(of snapshot: EntrySnapshot) -> String {
        let title = snapshot.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { return title }
        let first = snapshot.nonEmptyLines.first ?? "（空）"
        return first.count > 24 ? String(first.prefix(24)) + "…" : first
    }

    private func preview(of snapshot: EntrySnapshot) -> String {
        let title = snapshot.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return "" }
        let body = snapshot.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return body.count > 60 ? String(body.prefix(60)) + "…" : body
    }

    // MARK: - 操作

    private func delete(_ snapshot: EntrySnapshot) {
        deleteTarget = nil
        guard let entry = JournalStore.fetch(id: snapshot.id, in: context) else { return }
        JournalStore.delete(entry, in: context)
    }

    private func togglePin(_ snapshot: EntrySnapshot) {
        guard let entry = JournalStore.fetch(id: snapshot.id, in: context) else { return }
        entry.isPinned.toggle()
        entry.updatedAt = Date()
        JournalStore.save(context)
    }
}
