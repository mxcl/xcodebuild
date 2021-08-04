// swift-tools-version:5.0

import PackageDescription

let name = "my-fixture"

let pkg = Package(
    name: name,
    platforms: [
        .macOS(.v10_11)
    ],
    products: [
        .executable(name: name, targets: [name]),
    ],
    targets: [
        .target(name: name, path: ".", sources: ["main.swift"]),
    ]
)
