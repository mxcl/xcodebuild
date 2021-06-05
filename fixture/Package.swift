// swift-tools-version:5.0

import PackageDescription

let name = "my-fixture"

let package = Package(
    name: name,
    products: [
        .executable(name: name, targets: [name]),
    ],
    targets: [
        .target(name: name, path: ".", sources: ["main.swift"]),
    ]
)
