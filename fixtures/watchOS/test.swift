#if !os(watchOS)
#error("!os(watchOS)")
#endif

func foo() -> Int {
    return 5
}

func bar() {
    // deliberate warning
    foo()
}
