// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DuskCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v13)
    ],
    products: [
        .library(name: "DuskCore", targets: ["DuskCore"])
    ],
    targets: [
        .target(
            name: "DuskCore",
            path: "Sources/DuskCore"
        ),
        .testTarget(
            name: "DuskCoreTests",
            dependencies: ["DuskCore"],
            path: "Tests/DuskCoreTests"
        )
    ]
)
