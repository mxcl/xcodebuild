#if !os(tvOS)
#error("!os(tvOS)")
#endif

func foo() -> Int {
    return 5
}

func bar() {
    // deliberate warning
    foo()
}
