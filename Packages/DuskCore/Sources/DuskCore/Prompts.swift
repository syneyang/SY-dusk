import Foundation

public struct Prompt: Identifiable, Hashable, Sendable {
    public let id: Int
    public let text: String
    public let category: PromptCategory

    public init(id: Int, text: String, category: PromptCategory) {
        self.id = id
        self.text = text
        self.category = category
    }
}

public enum PromptCategory: String, Sendable, CaseIterable {
    case moment      // 事情
    case feeling     // 感受
    case people      // 人
    case body        // 身体
    case reflect     // 反思

    public var label: String {
        switch self {
        case .moment: return "一件小事"
        case .feeling: return "一点感受"
        case .people: return "一个人"
        case .body: return "身体"
        case .reflect: return "想一想"
        }
    }
}

/// 每天一个写作提示。不强制，只是给「不知道写什么」的时候一个把手。
public enum Prompts {
    public static let all: [Prompt] = [
        Prompt(id: 1, text: "今天最值得记住的一件事是什么？", category: .moment),
        Prompt(id: 2, text: "今天有没有哪个瞬间，你希望时间暂停一下？", category: .moment),
        Prompt(id: 3, text: "今天你和谁说了最久的话？聊了什么？", category: .people),
        Prompt(id: 4, text: "今天吃到的最好吃的一口是什么？", category: .body),
        Prompt(id: 5, text: "今天有没有什么事情，比预想的顺利？", category: .moment),
        Prompt(id: 6, text: "今天让你皱眉的是什么？", category: .feeling),
        Prompt(id: 7, text: "今天的天气、光线、声音，挑一个写下来。", category: .moment),
        Prompt(id: 8, text: "今天有没有一个念头，出现过不止一次？", category: .reflect),
        Prompt(id: 9, text: "今天你为自己做了什么？", category: .reflect),
        Prompt(id: 10, text: "今天有没有对谁说过「谢谢」？", category: .people),
        Prompt(id: 11, text: "今天你身体的感觉怎么样？", category: .body),
        Prompt(id: 12, text: "今天走了多少路？路上看到什么？", category: .body),
        Prompt(id: 13, text: "今天有没有哪件事，你本来想拖到明天？", category: .reflect),
        Prompt(id: 14, text: "今天最安静的时刻，你在做什么？", category: .moment),
        Prompt(id: 15, text: "今天有没有笑出声？因为什么？", category: .feeling),
        Prompt(id: 16, text: "今天你学到的一个小知识或小技巧。", category: .moment),
        Prompt(id: 17, text: "今天有没有想起一个很久没联系的人？", category: .people),
        Prompt(id: 18, text: "今天花了多少钱？花得值吗？", category: .reflect),
        Prompt(id: 19, text: "今天哪个决定让你犹豫了？", category: .reflect),
        Prompt(id: 20, text: "今天有没有一件事，你做得比昨天好？", category: .reflect),
        Prompt(id: 21, text: "今天有没有看到好看的云、树，或者人的侧脸？", category: .moment),
        Prompt(id: 22, text: "今天你听的是什么歌？为什么是它？", category: .feeling),
        Prompt(id: 23, text: "今天有没有一个时刻觉得自己很笨？", category: .feeling),
        Prompt(id: 24, text: "今天有没有一个时刻觉得自己还不错？", category: .feeling),
        Prompt(id: 25, text: "今天谁帮了你？你怎么回报的？", category: .people),
        Prompt(id: 26, text: "今天有没有什么「第一次」？", category: .moment),
        Prompt(id: 27, text: "今天的工作或学习里，哪一部分让你有成就感？", category: .reflect),
        Prompt(id: 28, text: "今天有没有什么让你觉得「世界还挺好」？", category: .feeling),
        Prompt(id: 29, text: "今天想对明天的自己说什么？", category: .reflect),
        Prompt(id: 30, text: "今天有没有什么习惯，你坚持了，或者断了？", category: .reflect),
        Prompt(id: 31, text: "今天最想保存下来的一张画面是什么？", category: .moment),
        Prompt(id: 32, text: "今天有没有什么让你不安，但你没说出口？", category: .feeling),
        Prompt(id: 33, text: "今天你离想成为的人，近了一点还是远了一点？", category: .reflect),
        Prompt(id: 34, text: "如果用三个词形容今天，是哪三个？", category: .reflect),
        Prompt(id: 35, text: "今天有没有什么小事，让你想起小时候？", category: .moment),
        Prompt(id: 36, text: "今天有没有一顿饭，值得慢一点吃？", category: .body),
        Prompt(id: 37, text: "今天有没有谁的表情，你记得很清楚？", category: .people),
        Prompt(id: 38, text: "今天你忍住没说的话是什么？", category: .feeling),
        Prompt(id: 39, text: "今天有没有什么让你意外的事？", category: .moment),
        Prompt(id: 40, text: "今天结束时，你身上还留着什么情绪？", category: .feeling)
    ]

    /// 每天固定一个提示，同一天刷新也不会变。
    public static func daily(for day: DayKey, calendar: Calendar = .current) -> Prompt {
        guard !all.isEmpty else {
            return Prompt(id: 0, text: "今天想记点什么？", category: .moment)
        }
        let index = (day.dayOfYear(calendar: calendar) - 1) % all.count
        return all[max(0, min(index, all.count - 1))]
    }

    /// 「换一个」：按顺序取下一条。
    public static func next(after prompt: Prompt) -> Prompt {
        guard !all.isEmpty else {
            return Prompt(id: 0, text: "今天想记点什么？", category: .moment)
        }
        let index = (all.firstIndex(of: prompt) ?? -1) + 1
        return all[index % all.count]
    }

    /// 年底复盘时可以问自己的问题。
    public static let reviewQuestions: [String] = [
        "这一年，哪一天你最先想起来？",
        "有什么事情，你在年初很在意，现在却想不起来了？",
        "这一年你反复做的哪件小事，其实定义了你？",
        "谁在这一年里，出现在你日记里的次数最多？",
        "如果用一句话给这一年起个名字，叫什么？",
        "这一年你学会了什么，是以前不会的？",
        "有什么是你今年终于放下的？",
        "明年你想多写点什么，少写点什么？"
    ]
}

extension DayKey {
    /// 一年中的第几天（1 月 1 日为 1）。
    public func dayOfYear(calendar: Calendar = .current) -> Int {
        calendar.ordinality(of: .day, in: .year, for: startOfDay(calendar: calendar)) ?? day
    }
}
