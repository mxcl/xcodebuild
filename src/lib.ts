import * as gha_exec from '@actions/exec'
import { spawnSync } from 'child_process'
import semver from 'semver'
import path from 'path'
import * as core from '@actions/core'
import * as fs from 'fs'

async function mdls(path: string): Promise<string | undefined> {
  const v = await exec('mdls', ['-raw', '-name', 'kMDItemVersion', path])
  if (core.getInput('verbosity') == 'verbose') {
    // in verbose mode all commands and outputs are printed
    // and mdls in `raw` mode does not terminate its lines
    process.stdout.write("\n")
  }
  return semver.coerce(v)?.version
}

async function xcodes() {
  const paths = (await exec('mdfind', ['kMDItemCFBundleIdentifier = com.apple.dt.Xcode'])).split("\n")
  const rv: [string, string][] = []
  for (const path of paths) {
    if (!path.trim()) continue;
    const v = await mdls(path)
    if (v) {
      rv.push([path, v])
    }
  }
  return rv
}

function spawn(arg0: string, args: string[]) {
  const { error, status } = spawnSync(arg0, args, {stdio: 'inherit'})
  if (error) throw error
  if (status != 0) throw new Error(`\`${arg0}\` aborted (${status})`)
}

async function xcselect(xcode: string | undefined, swift: string | undefined): Promise<string> {

  let gotDotSwiftVersion: string | undefined

  if (swift) {
    return await selectSwift(swift)
  } else if (xcode) {
    return await selectXcode(xcode)
  } else if (gotDotSwiftVersion = dotSwiftVersion()) {
    core.info(`» \`.swift-version\` » ~> ${gotDotSwiftVersion}`)
    return await selectSwift(gotDotSwiftVersion)
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

  async function selectXcode(constraint?: string) {
    const rv = (await xcodes()).filter(([path, v]) =>
      constraint ? semver.satisfies(v, constraint) : true
    ).sort((a,b) =>
      semver.compare(a[1], b[1])
    ).pop()

    if (!rv) throw new Error(`No Xcode ~> ${constraint}`)

    spawn('sudo', ['xcode-select', '--switch', rv[0]])

    return rv[1]
  }

  async function selectSwift(constraint: string): Promise<string> {
    const rv1 = await xcodes()
    const rv2 = await Promise.all(rv1.map(swiftVersion))
    const rv3 = rv2
      .filter(([,,sv]) => semver.satisfies(sv, constraint))
      .sort((a,b) => semver.compare(a[1], b[1]))
      .pop()

    if (!rv3) throw new Error(`No Xcode with Swift ~> ${constraint}`)

    core.info(`» Selected Swift ${rv3[2]}`)

    spawn('sudo', ['xcode-select', '--switch', rv3[0]])

    return rv3[1]

    async function swiftVersion([DEVELOPER_DIR, xcodeVersion]: [string, string]): Promise<[string, string, string]> {
      const stdout = await exec('swift', ['--version'], {DEVELOPER_DIR})
      const matches = stdout.match(/Swift version (.+?)\s/m)
      if (!matches || !matches[1]) throw new Error(`failed to extract Swift version from Xcode ${xcodeVersion}`)
      const version = semver.coerce(matches[1])?.version
      if (!version) throw new Error(`failed to parse Swift version from Xcode ${xcodeVersion}`)
      return [DEVELOPER_DIR, xcodeVersion, version]
    }
  }

  function dotSwiftVersion(): string | undefined {
    if (!fs.existsSync('.swift-version')) return
    return fs.readFileSync('.swift-version').toString().trim()
  }
}

interface Devices {
  devices: {
    [key: string]: [{
      udid: string
    }]
  }
}

type DeviceType = 'watchOS' | 'tvOS' | 'iOS'
type DestinationsResponse = {[key: string]: string}

async function scheme(): Promise<string> {
  const out = await exec('xcodebuild', ['-list', '-json'])
  const json = parseJSON(out)
  const schemes = (json?.workspace ?? json?.project)?.schemes as string[]
  if (!schemes || schemes.length == 0) throw new Error('Could not determine scheme')
  for (const scheme of schemes) {
    if (scheme.endsWith('-Package')) return scheme
  }
  return schemes[0]
}

export function parseJSON(input: string) {
  try {
    input = input.trim()
    // works around xcodebuild sometimes outputting this string in CI conditions
    const xcodebuildSucks = 'build session not created after 15 seconds - still waiting'
    if (input.endsWith(xcodebuildSucks)) {
      input = input.slice(0, -xcodebuildSucks.length)
    }
    return JSON.parse(input)
  } catch (error) {
    core.startGroup("JSON")
    core.error(input)
    core.endGroup()
    throw error
  }
}

async function destinations(): Promise<DestinationsResponse> {
  const out = await exec('xcrun', ['simctl', 'list', '--json', 'devices', 'available'])
  const devices = (parseJSON(out) as Devices).devices

  const rv: {[key: string]: {v: string, id: string}} = {}
  for (const opaqueIdentifier in devices) {
    const device = (devices[opaqueIdentifier] ?? [])[0]
    if (!device) continue
    const [type, v] = parse(opaqueIdentifier)
    //TODO make into semantic version and do a proper comparison
    if (!rv[type] || rv[type].v < v) {
      rv[type] = {v, id: device.udid}
    }
  }

  return {
    tvOS: rv.tvOS?.id,
    watchOS: rv.watchOS?.id,
    iOS: rv.iOS?.id,
  }

  function parse(key: string): [DeviceType, string] {
    const [type, ...vv] = (key.split('.').pop() ?? '').split('-')
    const v = vv.join('.')
    return [type as DeviceType, v]
  }
}

async function exec(command: string, args?: string[], env?: {[key: string]: string}): Promise<string> {
  let out = ''
  try {
    await gha_exec.exec(command, args, { listeners: {
      stdout: data => out += data.toString(),
      stderr: data => core.info(`⚠ ${command}: ${'\u001b[33m'}${data.toString()}`)
    }, silent: verbosity() != 'verbose', env})

    return out
  } catch (error) {
    // help debug efforts by showing what we ran if there was an error
    core.info(`» ${command} ${args ? args.join(" \\\n") : ''}`)
    throw error
  }
}

function verbosity(): 'xcpretty' | 'quiet' | 'verbose' {
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

function getConfiguration() {
  const conf = core.getInput('configuration')
  switch (conf) {
    // both `.xcodeproj` and SwiftPM projects capitalize these
    // by default, and are case-sensitive. And for both if an
    // incorrect configuration is specified do not error, but
    // do not behave as expected instead.
    case 'debug': return 'Debug'
    case 'release': return 'Release'
    default: return conf
  }
}

export type Platform = 'watchOS' | 'iOS' | 'tvOS' | 'macOS' | ''

export function getAction(platform: Platform, selectedXcode: string): string | null {
  const action = core.getInput('action')
  if (semver.gte(selectedXcode, '12.5.0')) {
    return action
  } else if (platform == 'watchOS' && actionIsTestable(action)) {
    core.info("Setting `action=build` for Apple Watch / Xcode <12.5")
    return 'build'
  } else {
    return action || null
  }
}

const actionIsTestable = (action: string | null) => action == 'test' || action == 'build-for-testing'

export async function getDestination(platform: string, xcode: string): Promise<string[]> {
  switch (platform.trim()) {
    case 'iOS':
    case 'tvOS':
    case 'watchOS':
      const id = (await destinations())[platform]
      return ['-destination', `id=${id}`]
    case 'macOS':
      return ['-destination', 'platform=macOS']
    case 'mac-catalyst':
      return ['-destination', 'platform=macOS,variant=Mac Catalyst']
    case '':
      if (semver.gte(xcode, '13.0.0')) {
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

export function getIdentity(identity: string, platform: string): string | null {
  if (identity) {
    return `CODE_SIGN_IDENTITY="${identity}"`
  }

  if (platform == 'mac-catalyst') {
    // Disable code signing for Mac Catalyst unless overridden.
    return 'CODE_SIGN_IDENTITY=-'
  }

  return null
}

export async function createKeychain(certificate: string, passphrase: string) {
  // The user should have already stored these as encrypted secrets, but we'll be paranoid on their behalf.
  core.setSecret(certificate)
  core.setSecret(passphrase)

  // Avoid using a well-known password.
  const password = await exec('/usr/bin/uuidgen')
  core.setSecret(password)

  // Avoid using well-known paths.
  const name = await exec('/usr/bin/uuidgen')
  core.setSecret(name)

  // Unfortunately, a keychain must be stored on disk. We remove it in a post action that calls deleteKeychain.
  const keychainPath = `${process.env.RUNNER_TEMP}/${name}.keychain-db`
  core.saveState('keychainPath', keychainPath)

  core.info('Creating keychain')
  spawn('/usr/bin/security', ['create-keychain', '-p', password, keychainPath])
  spawn('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychainPath])
  spawn('/usr/bin/security', ['unlock-keychain', '-p', password, keychainPath])

  // Unfortunately, a certificate must be stored on disk in order to be imported. We remove it immediately after import.
  const certificatePath = `${process.env.RUNNER_TEMP}/${name}.p12`
  core.info('Importing certificate')
  fs.writeFileSync(certificatePath, certificate, { encoding: 'base64' })
  try {
    spawn(
      '/usr/bin/security',
      ['import', certificatePath, '-P', passphrase, '-A', '-t', 'cert', '-f', 'pkcs12', '-x', '-k', keychainPath]
    )
  } finally {
    fs.unlinkSync(certificatePath)
  }

  // This is necessary for Xcode to find the imported certificate.
  spawn('/usr/bin/security', ['list-keychain', '-d', 'user', '-s', keychainPath])
}

export async function deleteKeychain() {
  const keychainPath = core.getState('keychainPath')
  if (!keychainPath) return

  core.info('Deleting keychain')
  try {
    spawn('/usr/bin/security', ['delete-keychain', keychainPath])
  } finally {
    if (fs.existsSync(keychainPath)) {
      fs.unlinkSync(keychainPath)
    }
  }
}

export {
  exec, destinations, scheme, xcselect, spawn, verbosity, getConfiguration, actionIsTestable
}
