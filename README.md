# mxcl/xcodebuild

Make your software #continuously-resilient as well as continuously integrated.

This action will continue to work forever, no more CI breakage because Xcode
is updated.

The action will build both Xcode projects and Swift packages.

## [Sponsor @mxcl](https://github.com/sponsors/mxcl)

I can only afford to maintain projects I need or that are sponsored. Thanks.

## Usage

> For complete input/output documentation, see [action.yml](action.yml).

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - use: mxcl/xcodebuild@v1
      # ^^ this is the simplest use, runs tests for whatever platform `xcodebuild` picks
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
          - mac-catalyst
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
        platform:
          - macOS
          - watchOS
          - tvOS
          - iOS
        xcode:
          - ^10  # a semantic version range †
          - ^11
          - ^12
    runs-on: macos-10.15
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

> † check out https://devhints.io/semver for valid ranges

```yaml
jobs:
  build:
    runs-on: macos-11
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
          # obviously don’t specify an Xcode range *as well*
        continue-on-error: ${{ matrix.swift == '^6' }}
        # ^^ pre-emptively try to build against unreleased versions
```

If you need to test against Swift versions that cross macOS images then you will
want something like this:

```yaml
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        swift:
          - ~5.0          # Xcode 10.3
          - ~5.1          # Xcode 11.3.1
          - ~5.2          # Xcode 11.7
          - ~5.3          # Xcode 12.4
        os:
          - macos-10.15
        include:
          - swift: ~5.4   # Xcode 12.5.1
            os: macos-11
          - swift: ~5.5
            os: macos-11  # Xcode 13
    steps:
      - use: mxcl/xcodebuild@v1
        with:
          swift: ${{ matrix.swift }}
```

You *can* use this action to just select Xcode and perform no action:

```yaml
jobs:
  build:
    runs-on: ${{ matrix.os }}
    steps:
      - use: mxcl/xcodebuild@v1
        with:
          action: none
      - run: … # do your own thing
```

## Specifying `scheme`

You can specify `scheme`.
If you don’t we try to figure it out for you; this sometimes fails.

Ideally if there is only one scheme you wouldn’t need to specify it,
if you think we could have figured it out but didn’t please open a ticket.

## Available Xcodes

GitHub’s images have a **limited selection** of Xcodes.

* GitHub list what is available for the current 10.15 image [here][gha-xcode-list].
* We run a scheduled workflow to determine what is available [here][automated-list].

To install other versions first use [sinoru/actions-setup-xcode], then
`mxcl/xcodebuild` *will find that Xcode* if you specify an appropriate value for
the `xcode` input.

## Logs

We automatically upload the build logs as artifacts on failure.

The resulting artifact is an `.xcresult` “bundle” and once downloaded can be
opened in Xcode:

![img]

You’ll even get your coverage report!

> Note this feature requires Xcode >= 11

## `.swift-version` File

If your repo has a `.swift-version` file and neither `swift` nor `xcode` is
specified it will be read and that Swift version resolved.

If `working-directory` is set, the `.swift-version` file is read from this
directory.

This behavior cannot currently be disabled, PR welcome.

## Code Signing

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - use: mxcl/xcodebuild@v1
        with:
          code-sign-certificate: ${{ secrets.CERTIFICATE_BASE64 }}
          code-sign-certificate-passphrase: ${{ secrets.CERTIFICATE_PASSPHRASE}}
```

> This feature requires macOS.

A code signing certificate can be installed to the macOS Keychain. It is
automatically removed from the Keychain in a post action.

To export your certificate from Xcode and Base64 encode it, follow
[these instructions][export]. Store any secrets, including certificates and
passphrases, in GitHub as [Encrypted Secrets][secrets].

You may specify a `code-sign-identity` to override any `CODE_SIGN_IDENTITY`
specified by your project.

To disable code signing, you can specify `code-sign-identity: '-'`.

## Caveats

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
* `warnings-as-errors` is only applied to normal targets: not your tests

## Continuous Resilience

* Use `macos-latest` and trust this action to always work
  * This because GitHub deprecate old environments, so if you want your CI to
    continue to work in 5 years you need to use `latest`
  * This makes specifying specific xcode versions problematic however, we
    haven’t got a good story for this yet.
* Set up a scheduled job for your CI for at least once a week
  * This way you’ll be notified if a new version of something (like Xcode)
    causes breakage in your builds

## Linux

If your project is a Swift Package (which it would have to be to build on Linux)
then by far the best and quickest way to build on Linux is by using the official
Swift docker containers:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        swift:
          - '5.0'  # string or you’ll get 5.5!
          - 5.1
    container:
      image: swift:${{ matrix.swift }}
    steps:
      - run: swift test
```

This action does not support Linux.

## Contributing

1. Run `npm install`
1. Edit the various `.ts` files
1. Run `npm run prepare`
1. Create a [Pull Request](https://github.com/mxcl/xcodebuild/compare)

[automated-list]: https://flatgithub.com/mxcl/.github/?filename=versions.json
[gha-xcode-list]: https://github.com/actions/virtual-environments/blob/main/images/macos/macos-10.15-Readme.md#xcode
[sinoru/actions-setup-xcode]: https://github.com/sinoru/actions-setup-xcode
[img]: https://raw.githubusercontent.com/mxcl/xcodebuild/gh-pages/XCResult.png
[secrets]: https://docs.github.com/en/actions/reference/encrypted-secrets
[export]: https://docs.github.com/en/actions/guides/installing-an-apple-certificate-on-macos-runners-for-xcode-development#creating-secrets-for-your-certificate-and-provisioning-profile
