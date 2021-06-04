import * as gha_exec from '@actions/exec'
import { spawnSync } from 'child_process'
const semver = require('semver')

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
  if (status != 0) throw new Error(`\`${arg0}\` aborted`)
}

async function xcselect(constraint: string | undefined) {
  const rv = (await xcodes()).filter(([path, v]) =>
    constraint ? semver.satisfies(v, constraint) : true
  ).sort((a,b) =>
    semver.compare(a[1], b[1])
  ).pop()

  if (!rv) throw new Error(`Found no valid Xcodes for ${constraint}`)

  spawn('sudo', ['xcode-select', '--switch', rv[0]])

  return rv[1]
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
  const json = JSON.parse(out)
  const schemes = (json?.workspace ?? json?.project)?.schemes as string[]
  if (!schemes || schemes.length == 0) throw new Error('Could not determine scheme')
  for (const scheme of schemes) {
    if (scheme.endsWith('-Package')) return scheme
  }
  return schemes[0]
}

async function destinations(): Promise<DestinationsResponse> {
  const out = await exec('xcrun', ['simctl', 'list', '--json', 'devices', 'available'])
  const devices = (JSON.parse(out) as Devices).devices

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

  await gha_exec.exec(command, args, { listeners: {
    stdout: data => out += data.toString(),
    stderr: data => process.stderr.write(data.toString())
  }})

  return out
}

export {
  exec, destinations, scheme, xcselect, spawn
}
