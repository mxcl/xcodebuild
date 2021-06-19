#if !targetEnvironment(macCatalyst)
#error("!targetEnvironment(macCatalyst)")
#endif

func foo() -> Int {
    return 5
}

func bar() {
    // deliberate warning
    foo()
}
