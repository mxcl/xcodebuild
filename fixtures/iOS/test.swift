#if !os(iOS)
#error("!os(iOS)")
#endif

func foo() -> Int {
    return 5
}

func bar() {
    // deliberate warning
    foo()
}

import XCTest

class Test: XCTestCase {
    func test() {
        XCTAssertEqual(1, 1)
    }
}
