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
      - uses: mxcl/xcodebuild@v3
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
          - visionOS
    steps:
      - uses: mxcl/xcodebuild@v3
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
          - ^10 # a semantic version range †
          - ^11
          - ^12
    runs-on: macos-10.15
    steps:
      - uses: mxcl/xcodebuild@v3
        with:
          xcode: ${{ matrix.xcode }}
          platform: ${{ matrix.platform }}
          action: build # default = `test`
          code-coverage: true # default = `false`
          warnings-as-errors: true # default = `false`
          configuration: release # no default, ie. `xcodebuild` decides itself
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
      - uses: mxcl/xcodebuild@v3
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
          - ~5.0 # Xcode 10.3
          - ~5.1 # Xcode 11.3.1
          - ~5.2 # Xcode 11.7
          - ~5.3 # Xcode 12.4
        os:
          - macos-10.15
        include:
          - swift: ~5.4 # Xcode 12.5.1
            os: macos-11
          - swift: ~5.5
            os: macos-11 # Xcode 13
    steps:
      - uses: mxcl/xcodebuild@v3
        with:
          swift: ${{ matrix.swift }}
```

You _can_ use this action to just select Xcode and perform no action:

```yaml
jobs:
  build:
    runs-on: ${{ matrix.os }}
    steps:
      - uses: mxcl/xcodebuild@v3
        with:
          action: none
      - run: … # do your own thing
```

## Specifying `workspace`

You can specify `workspace`.

If you are using CocoaPods you will likely need to specify the workspace, it is NOT automatically
deciphered for you.

## Specifying `scheme`

You can specify `scheme`.
If you don’t we try to figure it out for you; this sometimes fails.

Ideally if there is only one scheme you wouldn’t need to specify it,
if you think we could have figured it out but didn’t please open a ticket.

## Available Xcodes

GitHub’s images have a **limited selection** of Xcodes.

- GitHub list what is available for the current [10.15][gha-xcode-list-catalina]
  and [11][gha-xcode-list-big-sur] images.
- We run a scheduled workflow to determine what is available [here][automated-list].

To install other versions first use [sinoru/actions-setup-xcode], then
`mxcl/xcodebuild` _will find that Xcode_ if you specify an appropriate value for
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

> This feature requires macOS.

Code signing can be enabled with either an App Store Connect API key, or with a
certificate.

### Using an App Store Connect API Key

> This feature requires Xcode 13 or later.

[Create][create-api-key-instructions] an API key on
[App Store Connect][create-api-key]. Download your key and Base64-encode it:

```bash
base64 AuthKey_9XXXX9XXXX.p8
```

Create [GitHub Secrets][secrets] for your base64-encoded key, the key ID, and
the key's issuer ID. The IDs are displayed on App Store Connect.

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: mxcl/xcodebuild@v3
        with:
          authentication-key-base64: ${{ secrets.APP_STORE_CONNECT_KEY_BASE64 }}
          authentication-key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          authentication-key-issuer-id: ${{ secrets.APP_STORE_CONNECT_KEY_ISSER_ID }}
```

Certificates and provisioning profiles will be created automatically using the
App Store Connect API. Certificates will appear in your
[list of certificates](cert-list) as `Created via API`.

Devices will be registered automatically. GitHub-hosted runners will appear in
in your [list of devices](device-list) as `mac-NUMBER.local`.

> :warning: This may cause undesired behavior when using GitHub-hosted runners.
> For best results, use App Store Connect API keys only on self-hosted runners.

For more information on this method of code signing, please review the
["Distribute apps in Xcode with cloud signing"][cloud-signing] talk from WWDC21.

### Using a Specific Certificate

If you are not able to use an App Store Connect API key, and you have a specific
code signing certificate you'd like to use, it can be installed to the macOS
Keychain. It is automatically removed from the Keychain in a post action.

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: mxcl/xcodebuild@v3
        with:
          code-sign-certificate: ${{ secrets.CERTIFICATE_BASE64 }}
          code-sign-certificate-passphrase: ${{ secrets.CERTIFICATE_PASSPHRASE}}
```

To export your certificate from Xcode and Base64 encode it, follow
[these instructions][export]. Store any secrets, including certificates and
passphrases, in GitHub as [Encrypted Secrets][secrets].

### Specifying an Identity

You may specify a `code-sign-identity` to override any `CODE_SIGN_IDENTITY`
specified by your project.

### Disabling Code Signing

To disable code signing, you can specify `code-sign-identity: '-'`.

### Provisioning Profiles

If you are not able to use an App Store Connect API key, and you have specific
provisioning profiles you'd like to use, you can specify profiles for Mac
`provisioning-profiles-base64`, or for iOS or other devices using
`mobile-provisioning-profiles-base64`.

To export your provisioning profiles from Xcode and Base64 encode these, follow
[these instructions][export]. Store any secrets, including provisioning
profiles, in GitHub as [Encrypted Secrets][secrets].

```yaml
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: mxcl/xcodebuild@v3
        with:
          mobile-provisioning-profiles-base64: |
            ${{ secrets.IPHONE_PROVISIONING_PROFILE_BASE64 }}
            ${{ secrets.IPAD_PROVISIONING_PROFILE_BASE64 }}
          provisioning-profiles-base64: |
            ${{ secrets.MAC_PROVISIONING_PROFILE_BASE64 }}
```

## Caveats

- The selected Xcode remains the default Xcode for the image for the duration of
  your job.

## Neat Stuff

- We’re smart based on the selected Xcode version, for example we know watchOS
  cannot be tested prior to 12.5 and run xcodebuild with `build` instead
- We figure out the the simulator destination for you automatically. Stop
  specifying fragile strings like `platform=iphonesimulator,os=14.5,name=iPhone 12`
  that will break when Xcode updates next week.
- You probably don’t need to specify project or scheme since we aren’t tedious
  if possible
- `warnings-as-errors` is only applied to normal targets: not your tests

## Continuous Resilience

- Use `macos-latest` and trust this action to always work
  - This because GitHub deprecate old environments, so if you want your CI to
    continue to work in 5 years you need to use `latest`
  - This makes specifying specific xcode versions problematic however, we
    haven’t got a good story for this yet.
- Set up a scheduled job for your CI for at least once a week
  - This way you’ll be notified if a new version of something (like Xcode)
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
          - '5.0' # string or you’ll get 5.5!
          - 5.1
    container:
      image: swift:${{ matrix.swift }}
    steps:
      - run: swift test
```

This action does not support Linux.

## Windows

Use: https://github.com/marketplace/actions/swift-for-windows-action

This action does not support Windows.

## Contributing

1. Run `npm install`
1. Edit the various `.ts` files
1. Run `npm run prepare`
1. Correct any lint issues with `npm run format` or in your editor
1. If there are lint failures, try
1. Create a [Pull Request](https://github.com/mxcl/xcodebuild/compare)

[automated-list]: https://flatgithub.com/mxcl/.github/?filename=versions.json
[cloud-signing]: https://developer.apple.com/videos/play/wwdc2021/10204/
[create-api-key]: https://appstoreconnect.apple.com/access/api
[create-api-key-instructions]: https://developer.apple.com/documentation/appstoreconnectapi/creating_api_keys_for_app_store_connect_api
[cert-list]: https://developer.apple.com/account/resources/certificates/list
[device-list]: https://developer.apple.com/account/resources/devices/list
[gha-xcode-list-catalina]: https://github.com/actions/virtual-environments/blob/main/images/macos/macos-10.15-Readme.md#xcode
[gha-xcode-list-big-sur]: https://github.com/actions/virtual-environments/blob/main/images/macos/macos-11-Readme.md#xcode
[sinoru/actions-setup-xcode]: https://github.com/sinoru/actions-setup-xcode
[img]: https://raw.githubusercontent.com/mxcl/xcodebuild/gh-pages/XCResult.png
[secrets]: https://docs.github.com/en/actions/reference/encrypted-secrets
[export]: https://docs.github.com/en/actions/guides/installing-an-apple-certificate-on-macos-runners-for-xcode-development#creating-secrets-for-your-certificate-and-provisioning-profile

![Analytics](https://repobeats.axiom.co/api/embed/d18c74fbcc8431bca3d0dd76cc3131c32df24dce.svg 'Repobeats analytics image')
