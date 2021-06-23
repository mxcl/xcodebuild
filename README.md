# mxcl/xcodebuild

Make your software #continuously-resilient as well as continuously integrated.

This action will continue to work forever, no more CI breakage because Xcode
is updated.

## [Sponsor @mxcl](https://github.com/sponsors/mxcl)

I can only afford to maintain projects I need or that are sponsored. Thanks.

## Usage

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - use: mxcl/xcodebuild@v1
      # ^^ this is the simplest use, runs tests for whatever `xcodebuild` picks
```

```yaml
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

```yaml
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
          - ^10  # a semantically versioned constraint †
          - ^11
          - ^12
    runs-on: ${{ matrix.os }}
    steps:
      - use: mxcl/xcodebuild@v1
        with:
          xcode: ${{ matrix.xcode }}
          platform: ${{ matrix.platform }}
          action: build             # default = `test`
          code-coverage: true       # default = `false`
          warnings-as-errors: true  # default = `false`
          configuration: release    # no default, ie. `xcodebuild` decides itself
```

```yaml
jobs:
  build:
    runs-on: macos-latest
    strategy:
      matrix:
        swift:
          - ~5.3
          - ~5.4
          - ^6
    steps:
      - use: mxcl/xcodebuild@v1
        with:
          swift: ${{ matrix.swift }}
          # ^^ mxcl/xcodebuild selects the newest Xcode that provides the requested Swift
          # obviously don’t specify an Xcode constraint *as well*
         continue-on-error: ${{ matrix.swift == '^6' }}
          # ^^ pre-emptively try to build against unreleased versions
```

> † check out https://devhints.io/semver for valid constraints

## Available Xcodes

GitHub’s images have a **limited selection** of Xcodes.

* GitHub list what is available for the current 10.15 image [here][gha-xcode-list].
* We run a scheduled workflow to determine what is available [here][automated-list].

To install other versions first use [sinoru/actions-setup-xcode], then
`mxcl/xcodebuild` *will find that Xcode* if you specify an appropriate value for
the `xcode` input.

# Logs

We automatically upload the build logs as artifacts on failure.

The resulting artifact is an `.xcresult` “package” and once downloaded will
open in Xcode.

# `.swift-version` File

If your repo has a `.swift-version` file and neither `swift` no `xcode` is
specified it will be read and that Swift version resolved.

If `working-directory` is set, the `.swift-version` file is read from this
directory.

This behavior cannot currently be disabled, PR welcome.

# Caveats

* The selected Xcode remains the default Xcode for the image for the duration of
your job.

## Neat Stuff

* We’re smart based on the selected Xcode version, for example we know watchOS
cannot be tested prior to 12.5 and run xcodebuild with `build` instead
* We figure out the the simulator destination for you automatically. Stop
specifying fragile strings like `platform=iphonesimulator,os=14.5,name=iPhone 12`
that will break when Xcode updates next week.
* You probably don’t need to specify project or scheme since we aren’t tedious
if possible

## Continuous Resilience

* Use `macos-latest` and trust this action to always work
  * This because GitHub deprecate old environments, so if you want your CI to
    continue to work in 5 years you need to use `latest`
  * This makes specifying specific xcode versions problematic however, we
    haven’t got a good story for this yet.
* Set up a scheduled job for your CI for at least once a week
  * This way you’ll be notified if a new version of something (like Xcode)
    causes breakage in your builds

## Contributing

1. Run `npm install`
1. Edit the various `.ts` files
1. Run `npm run prepare`
1. Test with `npm test`
1. Create a [Pull Request](https://github.com/mxcl/xcodebuild/compare)


[automated-list]: https://flatgithub.com/mxcl/.github/?filename=versions.json
[gha-xcode-list]: https://github.com/actions/virtual-environments/blob/main/images/macos/macos-10.15-Readme.md#xcode
[sinoru/actions-setup-xcode]: https://github.com/sinoru/actions-setup-xcode
