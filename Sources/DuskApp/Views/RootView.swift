import SwiftUI

struct RootView: View {
    enum Tab: Hashable {
        case today
        case timeline
        case review
        case settings
    }

    @State private var selection: Tab = .today

    var body: some View {
        TabView(selection: $selection) {
            TodayView()
                .tabItem { Label("今天", systemImage: "sun.max.fill") }
                .tag(Tab.today)

            TimelineView()
                .tabItem { Label("时光", systemImage: "books.vertical.fill") }
                .tag(Tab.timeline)

            ReviewView()
                .tabItem { Label("回望", systemImage: "chart.bar.fill") }
                .tag(Tab.review)

            SettingsView()
                .tabItem { Label("设置", systemImage: "gearshape.fill") }
                .tag(Tab.settings)
        }
        .tint(Palette.dawn)
    }
}
