import * as gha_exec from '@actions/exec'
import { spawnSync } from 'child_process'
import semver from 'semver'
import path from 'path'
import * as core from '@actions/core'

async function xcodes() {
  const paths = (await exec('mdfind', ['kMDItemCFBundleIdentifier = com.apple.dt.Xcode'])).split("\n")
  const rv: [string, string][] = []
  for (const path of paths) {
    if (!path.trim()) continue;
    const v = await exec('mdls', ['-raw', '-name', 'kMDItemVersion', path])
    const vv = semver.coerce(v)?.version
    if (vv) {
      rv.push([path, vv])
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

  if (swift) {
    return await selectSwift(swift)
  } else if (xcode) {
    return await selectXcode(xcode)
  } else {

    // figure out the GHA image default Xcode’s version

    const devdir = await exec('xcode-select', ['--print-path'])
    const xcodePath = path.dirname(path.dirname(devdir))
    const rawVersion = await exec('mdls', ['-raw', '-name', 'kMDItemVersion', xcodePath])
    const version = semver.coerce(rawVersion)?.version
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

    if (!rv) throw new Error(`Found no valid Xcodes for ${constraint}`)

    spawn('sudo', ['xcode-select', '--switch', rv[0]])

    return rv[1]
  }

  async function selectSwift(constraint: string): Promise<string> {
    throw new Error('Unsupported currently')
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

function parseJSON(input: string) {
  try {
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

async function exec(command: string, args: string[]): Promise<string> {
  let out = ''
  try {
    await gha_exec.exec(command, args, { listeners: {
      stdout: data => out += data.toString(),
      stderr: data => process.stderr.write(data.toString())
    }, silent: quiet()})

    return out
  } catch (error) {
    // help debug efforts by showing what we ran if there was an error
    core.info(`${command} ${args.join(" \\\n")}`)
    throw error
  }
}

function quiet() {
  const rawInput = core.getInput('quiet').trim()
  if (rawInput === '') {
    return !core.isDebug()  // default is quiet unless debug is enabled for the workflow
  } else {
    return core.getBooleanInput('quiet')
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

export function getAction(platform: Platform, selectedXcode: string) {
  const action = core.getInput('action').trim() || 'test'
  if (semver.gt(selectedXcode, '12.5.0')) {
    return action
  } else if (platform == 'watchOS' && actionIsTestable(action)) {
    core.warning("Setting `action=build` for Apple Watch / Xcode <12.5")
    return 'build'
  } else {
    return action
  }
}

const actionIsTestable = (action: string) => action == 'test' || action == 'build-for-testing'

export async function getDestination(platform: string) {
  switch (platform.trim()) {
    case 'iOS':
    case 'tvOS':
    case 'watchOS':
      const id = (await destinations())[platform]
      return ['-destination', `id=${id}`]
    case 'macOS':
      return ['-destination', 'platform=macOS']
    case '':
      return []
    default:
      throw new Error(`Invalid platform: ${platform}`)
  }
}

export {
  exec, destinations, scheme, xcselect, spawn, quiet, getConfiguration, actionIsTestable
}
