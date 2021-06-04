import { destinations, scheme, xcselect } from './lib'
import * as core from '@actions/core'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'

async function run() {
  const xcode = core.getInput('xcode')
  const platform = core.getInput('platform')
  const action = core.getInput('action')

  const swiftPM = existsSync('Package.swift')
  const selected = await xcselect(xcode)

  let args = (await destination())
  args.push(figureOutAction())
  args = args.concat(await getScheme())
  args = args.concat(other())

  spawn('xcodebuild', args)

  function figureOutAction() {
    if (selected > '12.5') return 'test'
    if (platform == 'watchOS') {
      if (swiftPM) {
        // watchOS prior to 12.4 will fail to `xcodebuild` a SwiftPM project
        // failing trying to build the test modules, so we generate a project
        spawn('swift', ['package', 'generate-xcodeproj'])
      }
      return 'build'
    }
    return action || 'test'
  }

  function other() {
    if (core.getInput('code-coverage') || false) {
      return ['ENABLE_CODE_COVERAGE=YES']
    } else {
      return []
    }
  }

  async function getScheme() {
    if (swiftPM) {
      return ['-scheme', await scheme()]
    } else {
      return []
    }
  }

  async function destination() {
    switch (platform) {
      case 'iOS':
      case 'tvOS':
      case 'watchOS':
        const id = (await destinations())[platform]
        return ['-destination', `id=${id}`]
      case 'macOS':
        return []
      default:
        throw new Error(`Invalid platform: ${platform}`)
    }
  }
}

function spawn(arg0: string, args: string[]) {
  const { error, status } = spawnSync(arg0, args, {stdio: 'inherit'})
  if (error) throw error
  if (status != 0) throw new Error(`\`${arg0}\` aborted`)
}

run().catch(core.setFailed)
