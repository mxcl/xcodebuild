Make your software #continuously-resilient as well as continuously integrated.

This action will continue to work forever, no more CI breakage because Xcode
is updated.

# Sponsor @mxcl

I can only afford to maintain projects I need or that are sponsored. Thanks.

# Usage

```
jobs:
  build:
    runs-on: macos-latest
    steps:
      - use: mxcl/xcodebuild@v1
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
      - use: mxcl/xcodebuild@v1
        with:
          platform: ${{ matrix.platform }}
```

```
jobs:
  build:
    strategy:
      matrix:
        os:
          - macos-11
          - macos-10.15
        platform:
          - macOS
          - watchOS
          - tvOS
          - iOS
        xcode:
          - ^10
          - ^11
          - ^12
    runs-on: ${{ matrix.os }}
    steps:
      - use: mxcl/xcodebuild@v1
        with:
          xcode: ${{ matrix.xcode }}
          platform: ${{ matrix.platform }}
          action: build        # `test` is the default
          code-coverage: true  # `false` is the default
```

# Neat Stuff

* We’re smart based on the selected Xcode version, for example we know watchOS
cannot be tested prior to 12.5 and run xcodebuild with `build` instead
* We figure out the newest simulator to use for you so you don’t have to be a
wizard and your CI will stop breaking every few months
* You probably don’t need to specify project or scheme since we aren’t tedious
if possible

# Continuous Resilience

* Use `macos-latest` and trust this action to always work
  * This because GitHub deprecate old environments, so if you want your CI to continue to work in 5 years you need to use `latest`
* Set up a scheduled job for your CI for at least once a week
  * This way you’ll be notified if a new version of something (like Xcode) causes breakage in your builds

# Contributing

1. Run `npm install`
1. Edit the various `.ts` files
1. Run `npm run prepare`
1. Test with `npm test`
1. Make a “Pull Request”
