import SwiftUI
import SwiftData
import DuskCore

/// 打开 App 的第一屏：今天的日期、一句提示，和一块可以马上写字的地方。
struct TodayView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(SettingsKey.journeyStart) private var journeyStartISO: String = SettingsKey.defaultJourneyStart

    @State private var day: DayKey = .today()
    @State private var title: String = ""
    @State private var text: String = ""
    @State private var mood: Mood?
    @State private var tags: [String] = []
    @State private var newTag: String = ""
    @State private var prompt: Prompt = Prompts.daily(for: .today())
    @State private var savedAt: Date?
    @State private var isLoaded = false
    @State private var saveTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                promptCard
                editorCard
                moodSection
                tagSection
                footer
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 48)
        }
        .background(Palette.paper.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .onAppear(perform: load)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                if DayKey(Date()) != day { load() }
            } else {
                persist()
            }
        }
        .onChange(of: text) { _, _ in scheduleSave() }
        .onChange(of: title) { _, _ in scheduleSave() }
        .onChange(of: mood) { _, _ in scheduleSave() }
        .onChange(of: tags) { _, _ in scheduleSave() }
        .onDisappear(perform: persist)
    }

    // MARK: - 头部

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(DateText.monthDay(day))
                    .font(Typeface.serif(40))
                    .foregroundStyle(Palette.ink)
                Spacer()
                Text(journeyLabel)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Palette.dawn)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Palette.dawn.opacity(0.12)))
            }
            Text("\(DateText.weekday(day)) · \(String(day.year))")
                .font(.subheadline)
                .foregroundStyle(Palette.inkSoft)
        }
    }

    private var journeyLabel: String {
        let start = Journey.start(from: journeyStartISO)
        if day < start {
            return "距出发 \(start.daysSince(day)) 天"
        }
        return "第 \(day.daysSince(start) + 1) 天"
    }

    // MARK: - 今日提示

    private var promptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(prompt.category.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.dusk)
                Spacer()
                Button {
                    prompt = Prompts.next(after: prompt)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                        Text("换一个")
                    }
                    .font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.inkSoft)
            }
            Text(prompt.text)
                .font(Typeface.serif(19, weight: .regular))
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .card()
    }

    // MARK: - 正文

    private var editorCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("给今天起个小标题（可选）", text: $title)
                .font(Typeface.serif(17))
                .foregroundStyle(Palette.ink)

            Rectangle()
                .fill(Palette.hairline)
                .frame(height: 1)

            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("今天发生了什么？随手写两句，年底回看时会有惊喜。")
                        .font(Typeface.body(16))
                        .foregroundStyle(Palette.inkSoft.opacity(0.65))
                        .padding(.top, 8)
                        .padding(.leading, 4)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .font(Typeface.body(16))
                    .lineSpacing(6)
                    .foregroundStyle(Palette.ink)
                    .scrollContentBackground(.hidden)
                    .background(Color.clear)
                    .frame(minHeight: 220)
            }
        }
        .padding(16)
        .card()
    }

    // MARK: - 心情

    private var moodSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("今天的心情")
            HStack(spacing: 8) {
                ForEach(Mood.allCases) { item in
                    Button {
                        mood = (mood == item) ? nil : item
                    } label: {
                        VStack(spacing: 3) {
                            Text(item.symbol)
                                .font(.title3)
                            Text(item.label)
                                .font(.caption2)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(mood == item ? Palette.dawn.opacity(0.15) : Palette.card)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(mood == item ? Palette.dawn : Palette.hairline, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(mood == item ? Palette.dawn : Palette.inkSoft)
                }
            }
        }
    }

    // MARK: - 标签

    private var tagSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("标签")
            HStack(spacing: 8) {
                ForEach(tags, id: \.self) { tag in
                    TagChip(text: tag) {
                        tags.removeAll { $0 == tag }
                    }
                }
                TextField("+ 添加", text: $newTag)
                    .font(.caption)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit(addTag)
                    .frame(minWidth: 60, maxWidth: 140)
            }
        }
    }

    // MARK: - 底部状态

    private var footer: some View {
        HStack {
            Text(savedText)
                .font(.caption)
                .foregroundStyle(Palette.inkSoft)
            Spacer()
            Text("\(text.count) 字")
                .font(.caption)
                .foregroundStyle(Palette.inkSoft)
        }
    }

    private var savedText: String {
        guard let savedAt else { return "写下第一个字，就会自动保存" }
        return "已保存 \(savedAt.formatted(date: .omitted, time: .shortened))"
    }

    // MARK: - 读写

    private func load() {
        day = DayKey(Date())
        prompt = Prompts.daily(for: day)
        if let entry = JournalStore.fetch(day: day, in: context) {
            title = entry.title
            text = entry.text
            mood = entry.mood
            tags = entry.tags
            savedAt = entry.updatedAt
        } else {
            title = ""
            text = ""
            mood = nil
            tags = []
            savedAt = nil
        }
        isLoaded = true
    }

    private func scheduleSave() {
        guard isLoaded else { return }
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            persist()
        }
    }

    private func persist() {
        guard isLoaded else { return }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty || !trimmedText.isEmpty || mood != nil || !tags.isEmpty else {
            return
        }

        if let existing = JournalStore.fetch(day: day, in: context),
           existing.title == title,
           existing.text == text,
           existing.mood == mood,
           existing.tags == tags {
            return
        }

        let entry = JournalStore.entry(for: day, in: context)
        entry.title = title
        entry.text = text
        entry.mood = mood
        entry.tags = tags
        entry.updatedAt = Date()
        JournalStore.save(context)
        savedAt = entry.updatedAt
    }

    private func addTag() {
        let tag = newTag.trimmingCharacters(in: .whitespaces)
        newTag = ""
        guard !tag.isEmpty, !tags.contains(tag) else { return }
        tags.append(tag)
    }
}
