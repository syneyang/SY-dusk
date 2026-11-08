import SwiftUI
import SwiftData

@main
struct DuskApp: App {
    /// 只用本机存储：免费签名没有 iCloud 能力，先把数据牢牢放在手机上，
    /// 同步走「导出文件 → AirDrop / 文件 App」，将来再换成 iCloud。
    private let container: ModelContainer = {
        let schema = Schema([JournalEntry.self])
        let configuration = ModelConfiguration(
            "Dusk",
            schema: schema,
            isStoredInMemoryOnly: false,
            cloudKitDatabase: .none
        )
        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("打开本地日记库失败：\(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(container)
    }
}
