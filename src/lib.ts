import * as core from '@actions/core'
import * as gha_exec from '@actions/exec'
import { spawnSync } from 'child_process'
import type { SpawnSyncOptions } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import semver, { Range } from 'semver'
import type { SemVer } from 'semver'

async function mdls(path: string): Promise<SemVer | undefined> {
  const v = await exec('mdls', ['-raw', '-name', 'kMDItemVersion', path])
  if (core.getInput('verbosity') == 'verbose') {
    // in verbose mode all commands and outputs are printed
    // and mdls in `raw` mode does not terminate its lines
    process.stdout.write('\n')
  }
  return semver.coerce(v) ?? undefined
}

async function xcodes(): Promise<[string, SemVer][]> {
  const paths = (
    await exec('mdfind', ['kMDItemCFBundleIdentifier = com.apple.dt.Xcode'])
  ).split('\n')
  const rv: [string, SemVer][] = []
  for (const path of paths) {
    if (!path.trim()) continue
    const v = await mdls(path)
    if (v) {
      rv.push([path, v])
    }
  }
  return rv
}

export function spawn(
  arg0: string,
  args: string[],
  options: SpawnSyncOptions = { stdio: 'inherit' }
): void {
  const { error, signal, status } = spawnSync(arg0, args, options)
  if (error) throw error
  if (signal) throw new Error(`\`${arg0}\` terminated with signal (${signal})`)
  if (status != 0) throw new Error(`\`${arg0}\` aborted (${status})`)
}

export async function xcselect(xcode?: Range, swift?: Range): Promise<SemVer> {
  if (swift) {
    return selectSwift(swift)
  } else if (xcode) {
    return selectXcode(xcode)
  }

  const gotDotSwiftVersion = dotSwiftVersion()
  if (gotDotSwiftVersion) {
    core.info(`» \`.swift-version\` » ~> ${gotDotSwiftVersion}`)
    return selectSwift(gotDotSwiftVersion)
  } else {
    // figure out the GHA image default Xcode’s version

    const devdir = await exec('xcode-select', ['--print-path'])
    const xcodePath = path.dirname(path.dirname(devdir))
    const version = await mdls(xcodePath)
    if (version) {
      return version
    } else {
      // shouldn’t happen, but this action needs to know the Xcode version
      // or we cannot function, this way we are #continuously-resilient
      return selectXcode()
    }
  }

  async function selectXcode(range?: Range): Promise<SemVer> {
    const rv = (await xcodes())
      .filter(([, v]) => (range ? semver.satisfies(v, range) : true))
      .sort((a, b) => semver.compare(a[1], b[1]))
      .pop()

    if (!rv) throw new Error(`No Xcode ~> ${range}`)

    spawn('sudo', ['xcode-select', '--switch', rv[0]])

    return rv[1]
  }

  async function selectSwift(range: Range): Promise<SemVer> {
    const rv1 = await xcodes()
    const rv2 = await Promise.all(rv1.map(swiftVersion))
    const rv3 = rv2
      .filter(([, , sv]) => semver.satisfies(sv, range))
      .sort((a, b) => semver.compare(a[1], b[1]))
      .pop()

    if (!rv3) throw new Error(`No Xcode with Swift ~> ${range}`)

    core.info(`» Selected Swift ${rv3[2]}`)

    spawn('sudo', ['xcode-select', '--switch', rv3[0]])

    return rv3[1]

    async function swiftVersion([DEVELOPER_DIR, xcodeVersion]: [
      string,
      SemVer
    ]): Promise<[string, SemVer, SemVer]> {
      // This command emits 'swift-driver version: ...' to stderr.
      const stdout = await exec(
        'swift',
        ['--version'],
        { DEVELOPER_DIR },
        false
      )
      const matches = stdout.match(/Swift version (.+?)\s/m)
      if (!matches || !matches[1])
        throw new Error(
          `failed to extract Swift version from Xcode ${xcodeVersion}`
        )
      const version = semver.coerce(matches[1])
      if (!version)
        throw new Error(
          `failed to parse Swift version from Xcode ${xcodeVersion}`
        )
      return [DEVELOPER_DIR, xcodeVersion, version]
    }
  }

  function dotSwiftVersion(): Range | undefined {
    if (!fs.existsSync('.swift-version')) return undefined
    const version = fs.readFileSync('.swift-version').toString().trim()
    try {
      // A .swift-version of '5.0' indicates a SemVer Range of '>=5.0.0 <5.1.0'
      return new Range('~' + version)
    } catch (error) {
      core.warning(
        `Failed to parse Swift version from .swift-version: ${error}`
      )
    }
  }
}

interface Devices {
  devices: {
    [key: string]: [
      {
        udid: string
      }
    ]
  }
}

type DeviceType = 'watchOS' | 'tvOS' | 'iOS'
type Destination = { [key: string]: string }

interface Schemes {
  workspace?: {
    schemes: string[]
  }
  project?: {
    schemes: string[]
  }
}

export async function getSchemeFromPackage(
  workspace?: string
): Promise<string> {
  let args = ['-list', '-json']
  if (workspace) args = args.concat(['-workspace', workspace])
  const out = await exec('xcodebuild', args)
  const json = parseJSON<Schemes>(out)
  const schemes = (json?.workspace ?? json?.project)?.schemes
  if (!schemes || schemes.length == 0)
    throw new Error('Could not determine scheme')
  for (const scheme of schemes) {
    if (scheme.endsWith('-Package')) return scheme
  }
  return schemes[0]
}

function parseJSON<T>(input: string): T {
  try {
    input = input.trim()
    // works around xcodebuild sometimes outputting this string in CI conditions
    const xcodebuildSucks =
      'build session not created after 15 seconds - still waiting'
    if (input.endsWith(xcodebuildSucks)) {
      input = input.slice(0, -xcodebuildSucks.length)
    }
    return JSON.parse(input) as T
  } catch (error) {
    core.startGroup('JSON')
    core.error(input)
    core.endGroup()
    throw error
  }
}

async function destinations(arch: Arch | undefined): Promise<Destination> {
  const out = await exec('xcrun', [
    'simctl',
    'list',
    '--json',
    'devices',
    'available',
  ])
  const devices = parseJSON<Devices>(out).devices

  const rv: { [key: string]: { v: SemVer; id: string } } = {}
  for (const opaqueIdentifier in devices) {
    const device = (devices[opaqueIdentifier] ?? [])[0]
    if (!device) continue
    const [type, v] = parse(opaqueIdentifier)
    if (v && (!rv[type] || semver.lt(rv[type].v, v))) {
      rv[type] = { v, id: device.udid }
    }
  }

  return {
    tvOS: withArch(rv.tvOS?.id, arch),
    watchOS: withArch(rv.watchOS?.id, arch),
    iOS: withArch(rv.iOS?.id, arch),
  }

  function parse(key: string): [DeviceType, SemVer?] {
    const [type, ...vv] = (key.split('.').pop() ?? '').split('-')
    const v = semver.coerce(vv.join('.'))
    return [type as DeviceType, v ?? undefined]
  }
}

function withArch(id: string, arch: Arch | undefined): string {
  return arch ? `${id},arch=${arch}` : id
}

async function exec(
  command: string,
  args?: string[],
  env?: { [key: string]: string },
  stdErrToWarning = true
): Promise<string> {
  let out = ''
  try {
    await gha_exec.exec(command, args, {
      listeners: {
        stdout: (data) => (out += data.toString()),
        stderr: (data) => {
          const message = `${command}: ${'\u001b[33m'}${data.toString()}`
          if (stdErrToWarning) {
            core.warning(message)
          } else {
            core.info(message)
          }
        },
      },
      silent: verbosity() != 'verbose',
      env,
    })

    return out
  } catch (error) {
    // help debug efforts by showing what we ran if there was an error
    core.info(`» ${command} ${args ? args.join(' \\\n') : ''}`)
    throw error
  }
}

export function verbosity(): 'xcpretty' | 'quiet' | 'verbose' {
  const value = core.getInput('verbosity')
  switch (value) {
    case 'xcpretty':
    case 'quiet':
    case 'verbose':
      return value
    default:
      // backwards compatability
      if (core.getBooleanInput('quiet')) return 'quiet'

      core.warning(`invalid value for \`verbosity\` (${value})`)
      return 'xcpretty'
  }
}

export function getConfiguration(): string {
  const conf = core.getInput('configuration')
  switch (conf) {
    // both `.xcodeproj` and SwiftPM projects capitalize these
    // by default, and are case-sensitive. And for both if an
    // incorrect configuration is specified do not error, but
    // do not behave as expected instead.
    case 'debug':
      return 'Debug'
    case 'release':
      return 'Release'
    default:
      return conf
  }
}

export type Platform = 'watchOS' | 'iOS' | 'tvOS' | 'macOS' | 'mac-catalyst'

export type Arch = 'arm64' | 'x86_64' | 'i386'

export function getAction(
  xcodeVersion: SemVer,
  platform?: Platform
): string | undefined {
  const action = core.getInput('action')
  if (
    platform == 'watchOS' &&
    actionIsTestable(action) &&
    semver.lt(xcodeVersion, '12.5.0')
  ) {
    core.notice('Setting `action=build` for Apple Watch / Xcode <12.5')
    return 'build'
  }

  return action ?? undefined
}

export function actionIsTestable(action?: string): boolean {
  return action == 'test' || action == 'build-for-testing'
}

export async function getDestination(
  xcodeVersion: SemVer,
  platform?: Platform,
  arch?: Arch
): Promise<string[]> {
  switch (platform) {
    case 'iOS':
    case 'tvOS':
    case 'watchOS': {
      const id = (await destinations(arch))[platform]
      return ['-destination', `id=${id}`]
    }
    case 'macOS':
      return ['-destination', `platform=macOS`]
    case 'mac-catalyst':
      return ['-destination', `platform=macOS,variant=Mac Catalyst`]
    case undefined:
      if (semver.gte(xcodeVersion, '13.0.0')) {
        //FIXME should parse output from xcodebuild -showdestinations
        //NOTE `-json` doesn’t work
        // eg. the Package.swift could only allow iOS, assuming macOS is going to work OFTEN
        // but not ALWAYS
        return ['-destination', 'platform=macOS']
      } else {
        return []
      }
    default:
      throw new Error(`Invalid platform: ${platform}`)
  }
}

export function getIdentity(
  identity: string,
  platform?: Platform
): string | undefined {
  if (identity) {
    return `CODE_SIGN_IDENTITY="${identity}"`
  }

  if (platform == 'mac-catalyst') {
    // Disable code signing for Mac Catalyst unless overridden.
    core.notice('Disabling code signing for Mac Catalyst.')
    return 'CODE_SIGN_IDENTITY=-'
  }
}

// In order to avoid exposure to command line audit logging, we pass commands in
// via stdin. We allow only one command at a time in an effort to avoid injection.
function security(...args: string[]): void {
  for (const arg of args) {
    if (arg.includes('\n')) throw new Error('Invalid security argument')
  }

  const command = args.join(' ').concat('\n')
  spawn('/usr/bin/security', ['-i'], { input: command })
}

export async function createKeychain(
  certificate: string,
  passphrase: string
): Promise<void> {
  // The user should have already stored these as encrypted secrets, but we'll be paranoid on their behalf.
  core.setSecret(certificate)
  core.setSecret(passphrase)

  // Avoid using a well-known password.
  const password = (await exec('/usr/bin/uuidgen')).trim()
  core.setSecret(password)

  // Avoid using well-known paths.
  const name = (await exec('/usr/bin/uuidgen')).trim()
  core.setSecret(name)

  // Unfortunately, a keychain must be stored on disk. We remove it in a post action that calls deleteKeychain.
  const keychainPath = `${process.env.RUNNER_TEMP}/${name}.keychain-db`
  core.saveState('keychainPath', keychainPath)

  const keychainSearchPath = (
    await exec('/usr/bin/security', ['list-keychains', '-d', 'user'])
  )
    .split('\n')
    .map((value) => value.trim())

  core.saveState('keychainSearchPath', keychainSearchPath)

  core.info('Creating keychain')
  security('create-keychain', '-p', password, keychainPath)
  security('set-keychain-settings', '-lut', '21600', keychainPath)
  security('unlock-keychain', '-p', password, keychainPath)

  // Unfortunately, a certificate must be stored on disk in order to be imported. We remove it immediately after import.
  core.info('Importing certificate to keychain')
  const certificatePath = `${process.env.RUNNER_TEMP}/${name}.p12`
  fs.writeFileSync(certificatePath, certificate, { encoding: 'base64' })
  try {
    security(
      'import',
      certificatePath,
      '-P',
      passphrase,
      '-A',
      '-t',
      'cert',
      '-f',
      'pkcs12',
      '-x',
      '-k',
      keychainPath
    )
  } finally {
    fs.unlinkSync(certificatePath)
  }

  core.info('Updating keychain search path')
  security(
    'list-keychains',
    '-d',
    'user',
    '-s',
    keychainPath,
    ...keychainSearchPath
  )
}

export function deleteKeychain(): void {
  const state = core.getState('keychainSearchPath')
  if (state) {
    const keychainSearchPath: string[] = JSON.parse(state)
    core.info('Restoring keychain search path')
    try {
      security('list-keychains', '-d', 'user', '-s', ...keychainSearchPath)
    } catch (error) {
      core.error('Failed to restore keychain search path: ' + error)
      // Continue cleaning up.
    }
  }

  const keychainPath = core.getState('keychainPath')
  if (keychainPath) {
    core.info('Deleting keychain')
    try {
      security('delete-keychain', keychainPath)
    } catch (error) {
      core.error('Failed to delete keychain: ' + error)
      // Best we can do is deleting the keychain file.
      if (fs.existsSync(keychainPath)) {
        fs.unlinkSync(keychainPath)
      }
    }
  }
}

export async function createAppStoreConnectApiKeyFile(
  key: string
): Promise<string> {
  // Avoid using a well-known path.
  const name = (await exec('/usr/bin/uuidgen')).trim()
  core.setSecret(name)

  // Unfortunately, the key must be stored on disk. We remove it in
  // a post action that calls deleteAppStoreConnectApiKeyFile.
  const keyPath = `${process.env.RUNNER_TEMP}/${name}.p8`
  core.saveState('keyPath', keyPath)
  core.info('Creating App Store Connect API key file')
  fs.writeFileSync(keyPath, key, { encoding: 'base64' })

  return keyPath
}

export function deleteAppStoreConnectApiKeyFile() {
  const keyPath = core.getState('keyPath')
  if (keyPath && fs.existsSync(keyPath)) {
    core.info('Deleting App Store Connect API key file')
    try {
      fs.unlinkSync(keyPath)
    } catch (error) {
      core.error('Failed to delete App Store Connect API key file: ' + error)
    }
  }
}

export async function createProvisioningProfiles(
  mobileProfiles: string[],
  profiles: string[]
) {
  core.info('Creating provisioning profiles')

  for (const profile in mobileProfiles) {
    await createProvisioningProfile(profile, '.mobileprovision')
  }

  for (const profile in profiles) {
    await createProvisioningProfile(profile, '.provisionprofile')
  }
}

async function createProvisioningProfile(profile: string, extension: string) {
  // Avoid using a well-known path.
  const name = (await exec('/usr/bin/uuidgen')).trim()
  core.setSecret(name)

  const directory = path.join(
    `${process.env.HOME}`,
    'Library/MobileDevice/Provisioning Profiles'
  )
  fs.mkdirSync(directory, { recursive: true })

  const profilePath = path.join(directory, name + extension)

  // Add the new profile path to the saved state so we can delete it in post.
  const state = JSON.parse(core.getState('provisioningProfilePaths') || '[]')
  state.push(profilePath)
  core.saveState('provisioningProfilePaths', state)

  fs.writeFileSync(profilePath, profile, { encoding: 'base64' })
}

export function deleteProvisioningProfiles() {
  const state = core.getState('provisioningProfilePaths')
  if (!state) return

  core.info('Deleting provisioning profiles')
  for (const path in JSON.parse(state)) {
    if (fs.existsSync(path)) {
      try {
        fs.unlinkSync(path)
      } catch (error) {
        core.error('Failed to delete provisioning profile: ' + error)
      }
    }
  }
}
