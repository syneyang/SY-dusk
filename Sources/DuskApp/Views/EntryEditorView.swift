import SwiftUI
import SwiftData
import DuskCore

/// 单篇日记的编辑页。既可以改旧的一篇，也可以补记过去某一天。
struct EntryEditorView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var draft: EntrySnapshot
    @State private var newTag = ""
    @State private var resolvedID: UUID?
    @State private var showConflictAlert = false
    @State private var showDeleteAlert = false

    init(snapshot: EntrySnapshot) {
        _draft = State(initialValue: snapshot)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker(
                        "日期",
                        selection: dayBinding,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                }

                Section {
                    TextField("小标题（可选）", text: $draft.title)
                        .font(Typeface.serif(17))
                    TextEditor(text: $draft.text)
                        .font(Typeface.body(16))
                        .lineSpacing(6)
                        .frame(minHeight: 220)
                } header: {
                    Text("正文")
                } footer: {
                    Text("\(draft.text.count) 字")
                }

                Section("心情") {
                    HStack(spacing: 8) {
                        ForEach(Mood.allCases) { mood in
                            Button {
                                draft.mood = (draft.mood == mood) ? nil : mood
                            } label: {
                                VStack(spacing: 2) {
                                    Text(mood.symbol).font(.title3)
                                    Text(mood.label).font(.caption2)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                                .background(
                                    RoundedRectangle(cornerRadius: 10)
                                        .fill(draft.mood == mood ? Palette.dawn.opacity(0.15) : Color.clear)
                                )
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(draft.mood == mood ? Palette.dawn : Palette.inkSoft)
                        }
                    }
                }

                Section("标签") {
                    HStack(spacing: 8) {
                        ForEach(draft.tags, id: \.self) { tag in
                            TagChip(text: tag) {
                                draft.tags.removeAll { $0 == tag }
                            }
                        }
                        TextField("+ 添加", text: $newTag)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .onSubmit(addTag)
                    }
                }

                if resolvedID != nil {
                    Section {
                        Button(role: .destructive) {
                            showDeleteAlert = true
                        } label: {
                            Label("删除这一天的记录", systemImage: "trash")
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.paper.ignoresSafeArea())
            .navigationTitle(DateText.full(draft.day))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        if save() { dismiss() }
                    }
                    .disabled(draft.isEmpty)
                }
            }
            .onAppear(perform: resolve)
            .confirmationDialog(
                "这一天已经有别的记录了，要用现在的内容覆盖吗？",
                isPresented: $showConflictAlert,
                titleVisibility: .visible
            ) {
                Button("覆盖", role: .destructive) { overwrite() }
                Button("取消", role: .cancel) {}
            }
            .confirmationDialog(
                "确定删除这一天的记录？",
                isPresented: $showDeleteAlert,
                titleVisibility: .visible
            ) {
                Button("删除", role: .destructive) { deleteCurrent() }
                Button("取消", role: .cancel) {}
            }
        }
    }

    private var dayBinding: Binding<Date> {
        Binding(
            get: { draft.day.startOfDay() },
            set: { draft.day = DayKey($0) }
        )
    }

    // MARK: - 逻辑

    private func resolve() {
        if let entry = JournalStore.fetch(id: draft.id, in: context) {
            draft = entry.snapshot
            resolvedID = entry.id
            return
        }
        if let entry = JournalStore.fetch(day: draft.day, in: context) {
            draft = entry.snapshot
            resolvedID = entry.id
            return
        }
        resolvedID = nil
    }

    private func save() -> Bool {
        if let existing = JournalStore.fetch(day: draft.day, in: context),
           existing.id != resolvedID {
            showConflictAlert = true
            return false
        }

        let entry: JournalEntry
        if let id = resolvedID, let found = JournalStore.fetch(id: id, in: context) {
            entry = found
        } else {
            entry = JournalStore.entry(for: draft.day, in: context)
        }

        apply(draft, to: entry)
        JournalStore.save(context)
        resolvedID = entry.id
        return true
    }

    private func overwrite() {
        guard let existing = JournalStore.fetch(day: draft.day, in: context) else { return }
        if let id = resolvedID, id != existing.id,
           let previous = JournalStore.fetch(id: id, in: context) {
            context.delete(previous)
        }
        apply(draft, to: existing)
        JournalStore.save(context)
        dismiss()
    }

    private func apply(_ snapshot: EntrySnapshot, to entry: JournalEntry) {
        entry.dayStart = snapshot.day.startOfDay()
        entry.title = snapshot.title
        entry.text = snapshot.text
        entry.mood = snapshot.mood
        entry.tags = snapshot.tags
        entry.isPinned = snapshot.isPinned
        entry.updatedAt = Date()
    }

    private func deleteCurrent() {
        if let id = resolvedID, let entry = JournalStore.fetch(id: id, in: context) {
            JournalStore.delete(entry, in: context)
        }
        dismiss()
    }

    private func addTag() {
        let tag = newTag.trimmingCharacters(in: .whitespaces)
        newTag = ""
        guard !tag.isEmpty, !draft.tags.contains(tag) else { return }
        draft.tags.append(tag)
    }
}
