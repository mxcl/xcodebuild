// swift-tools-version:5.0

import PackageDescription

let name = "my-fixture"

let pkg = Package(
    name: name,
    products: [
        .executable(name: name, targets: [name]),
    ],
    targets: [
        .target(name: name, path: ".", sources: ["main.swift"]),
        .testTarget(name: "\(name)Tests", path: ".", sources: ["test.swift"]),
    ]
)

pkg.platforms = [
    .macOS(.v10_10),
    .iOS(.v9),
    .tvOS(.v9),
    .watchOS(.v3)
]
