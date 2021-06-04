Make your software #continuously-resilient as well as continuously integrated.

This action will continue to work forever, no more CI breakage because Xcode
is updated.

# Usage

```
jobs:
  build:
    runs-on: macos-latest
    steps:
      - use: mxcl/xcodebuild
      # ^^ this is the simplest use, runs tests for macOS
```

```
jobs:
  build:
    runs-on: macos-latest
    strategy:
      matrix:
        platform:
          - macOS
          - watchOS
          - tvOS
          - iOS
    steps:
      - use: mxcl/xcodebuild
        with:
          platform: ${{ matrix.platform }}
```

```
jobs:
  build:
    strategy:
      os:
        - macos-11
        - macos-10.15
      matrix:
        platform:
          - macOS
          - watchOS
          - tvOS
          - iOS
    runs-on: ${{ matrix.os }}
    steps:
      - use: mxcl/xcodebuild
        with:
          platform: ${{ matrix.platform }}
          action: build        # `test` is the default
          code-coverage: true  # `false` is the default
```

# Neat Stuff

* We know watchOS cannot be tested prior to 12.5 and run xcodebuild with `build`
instead
* We figure out the newest simulator to use for you so you don’t have to be a
wizard and your CI will stop breaking every few months
* You probably don’t need to specify project or scheme since we aren’t tedious
if possible
