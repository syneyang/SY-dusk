import SwiftUI
import SwiftData
import Charts
import DuskCore

/// 回望：这一年写了多少、什么时候写得最多、反复出现的是什么。
struct ReviewView: View {
    @Query(sort: \JournalEntry.dayStart, order: .reverse)
    private var entries: [JournalEntry]

    @State private var selectedYear = Calendar.current.component(.year, from: Date())
    @State private var shareItem: ShareItem?
    @State private var exportError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    yearPicker
                    if snapshots.isEmpty {
                        EmptyNote(
                            symbol: "chart.bar.doc.horizontal",
                            title: "还没有可以回望的东西",
                            message: "写满几天之后，这里会长出图表和关键词。"
                        )
                    } else {
                        summaryCard
                        statGrid
                        chartCard
                        pixelCard
                        highlightsCard
                        questionsCard
                        exportButton
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 48)
            }
            .background(Palette.paper.ignoresSafeArea())
            .navigationTitle("回望")
            .navigationBarTitleDisplayMode(.large)
            .sheet(item: $shareItem) { item in
                ShareSheet(items: [item.url])
            }
            .alert("导出失败", isPresented: Binding(
                get: { exportError != nil },
                set: { if !$0 { exportError = nil } }
            )) {
                Button("好", role: .cancel) { exportError = nil }
            } message: {
                Text(exportError ?? "")
            }
        }
    }

    // MARK: - 数据

    private var snapshots: [EntrySnapshot] {
        entries.map(\.snapshot)
    }

    private var availableYears: [Int] {
        var years = Set(snapshots.map(\.day.year))
        years.insert(Calendar.current.component(.year, from: Date()))
        return years.sorted(by: >)
    }

    private var yearEntries: [EntrySnapshot] {
        snapshots.filter { $0.day.year == selectedYear }
    }

    private var stats: JournalStats {
        JournalStats.compute(entries: yearEntries, referenceDay: .today())
    }

    private var monthlyCounts: [Int] {
        stats.monthlyCounts(in: selectedYear)
    }

    // MARK: - 区块

    private var yearPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(availableYears, id: \.self) { year in
                    Button {
                        selectedYear = year
                    } label: {
                        Text("\(String(year)) 年")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(
                                Capsule().fill(selectedYear == year ? Palette.dawn : Palette.card)
                            )
                            .foregroundStyle(selectedYear == year ? Color.white : Palette.inkSoft)
                            .overlay(
                                Capsule().stroke(
                                    selectedYear == year ? Color.clear : Palette.hairline,
                                    lineWidth: 1
                                )
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(String(selectedYear)) 年")
                .font(Typeface.serif(32))
                .foregroundStyle(Palette.ink)
            Text(summaryText)
                .font(Typeface.body(15))
                .foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summaryText: String {
        guard stats.totalEntries > 0 else {
            return "这一年还没有记录。"
        }
        var parts: [String] = [
            "写下 \(stats.totalEntries) 篇，覆盖 \(stats.daysWritten) 天，约 \(stats.totalCharacters) 字。"
        ]
        if stats.daysWritten > 0 {
            let ratio = Int(Double(stats.daysWritten) / 365.0 * 100)
            parts.append("一年里 \(ratio)% 的日子留下了字迹。")
        }
        if stats.longestStreak > 1 {
            parts.append("最长连续记录了 \(stats.longestStreak) 天。")
        }
        return parts.joined(separator: "")
    }

    private var statGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            StatTile(value: "\(stats.daysWritten)", label: "写过的天数")
            StatTile(value: "\(stats.longestStreak)", label: "最长连续")
            StatTile(value: "\(stats.averageCharacters)", label: "平均每篇字数")
            StatTile(value: stats.topTags().first.map { "#\($0.tag)" } ?? "—", label: "最常写的标签")
        }
    }

    private var chartCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("每月的笔迹")
            Chart {
                ForEach(0..<12, id: \.self) { index in
                    BarMark(
                        x: .value("月", index + 1),
                        y: .value("篇数", monthlyCounts[index])
                    )
                    .foregroundStyle(Palette.dawn.gradient)
                    .cornerRadius(4)
                }
            }
            .frame(height: 150)
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine()
                    AxisValueLabel()
                }
            }
        }
        .padding(16)
        .card()
    }

    private var pixelCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("这一年，每天一格")
            YearPixels(year: selectedYear, daySet: stats.daySet)
            HStack(spacing: 6) {
                Text("少")
                ForEach(0..<3, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Palette.dawn.opacity(0.25 + Double(level) * 0.3))
                        .frame(width: 8, height: 8)
                }
                Text("多")
                Spacer()
                Text("\(stats.daysWritten) 天有记录")
                    .font(.caption2)
                    .foregroundStyle(Palette.inkSoft)
            }
            .font(.caption2)
            .foregroundStyle(Palette.inkSoft)
        }
        .padding(16)
        .card()
    }

    private var highlightsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionTitle("反复出现的")
            if stats.topTags().isEmpty {
                Text("还没有标签。在写日记时加几个，年底会更好读。")
                    .font(.footnote)
                    .foregroundStyle(Palette.inkSoft)
            } else {
                FlowRow(spacing: 8) {
                    ForEach(stats.topTags(limit: 10)) { item in
                        TagChip(text: item.tag)
                    }
                }
            }

            Divider().background(Palette.hairline)

            SectionTitle("心情分布")
            HStack(spacing: 10) {
                ForEach(Mood.allCases) { mood in
                    let count = stats.moodCounts[mood] ?? 0
                    VStack(spacing: 4) {
                        Text(mood.symbol).font(.body)
                        Text("\(count)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Palette.ink)
                        Text(mood.label)
                            .font(.caption2)
                            .foregroundStyle(Palette.inkSoft)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(count > 0 ? Palette.dawn.opacity(0.10) : Color.clear)
                    )
                }
            }
        }
        .padding(16)
        .card()
    }

    private var questionsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("年末问自己")
            ForEach(Prompts.reviewQuestions, id: \.self) { question in
                HStack(alignment: .top, spacing: 8) {
                    Text("·")
                        .foregroundStyle(Palette.dawn)
                    Text(question)
                        .font(Typeface.body(15))
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .card()
    }

    private var exportButton: some View {
        Button {
            exportYear()
        } label: {
            HStack {
                Image(systemName: "square.and.arrow.up")
                Text("导出 \(String(selectedYear)) 年 Markdown")
            }
            .font(.subheadline.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(RoundedRectangle(cornerRadius: 14).fill(Palette.dusk.opacity(0.12)))
            .foregroundStyle(Palette.dusk)
        }
        .buttonStyle(.plain)
        .disabled(yearEntries.isEmpty)
        .opacity(yearEntries.isEmpty ? 0.4 : 1)
    }

    private func exportYear() {
        do {
            let url = try Exporter.markdownYear(entries: yearEntries, year: selectedYear)
            shareItem = ShareItem(url: url)
        } catch {
            exportError = error.localizedDescription
        }
    }
}

/// 一整年 = 53 列 × 7 行的小格子，有记录的那天是暖橙色。
struct YearPixels: View {
    let year: Int
    let daySet: Set<DayKey>

    var body: some View {
        let geometry = metrics
        GeometryReader { proxy in
            let cell = max(2, min(10, (proxy.size.width - geometry.spacing * CGFloat(geometry.weeks - 1)) / CGFloat(geometry.weeks)))
            HStack(alignment: .top, spacing: geometry.spacing) {
                ForEach(0..<geometry.weeks, id: \.self) { week in
                    VStack(spacing: geometry.spacing) {
                        ForEach(0..<7, id: \.self) { weekday in
                            cellView(index: week * 7 + weekday - geometry.offset, size: cell)
                        }
                    }
                }
            }
        }
        .frame(height: 7 * 10 + 6 * 3)
    }

    private var metrics: (weeks: Int, offset: Int, spacing: CGFloat) {
        let firstDay = DayKey(year: year, month: 1, day: 1)
        let nextYear = DayKey(year: year + 1, month: 1, day: 1)
        let days = nextYear.daysSince(firstDay)
        let offset = firstDay.weekdayIndex() - 1
        let weeks = (offset + days + 6) / 7
        return (weeks, offset, 3)
    }

    @ViewBuilder
    private func cellView(index: Int, size: CGFloat) -> some View {
        let firstDay = DayKey(year: year, month: 1, day: 1)
        let total = DayKey(year: year + 1, month: 1, day: 1).daysSince(firstDay)
        if index >= 0 && index < total {
            let day = firstDay.adding(days: index)
            RoundedRectangle(cornerRadius: 1.5)
                .fill(daySet.contains(day) ? Palette.dawn : Palette.hairline.opacity(0.5))
                .frame(width: size, height: size)
        } else {
            Color.clear
                .frame(width: size, height: size)
        }
    }
}

/// 简单的横向流式布局，标签多了会换行。
struct FlowRow: Layout {
    typealias Cache = ()

    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
