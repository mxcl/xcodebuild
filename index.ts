import { destinations, quiet, scheme, spawn, xcselect } from './lib'
import * as core from '@actions/core'
import { existsSync } from 'fs'
import * as semver from 'semver'

async function run() {
  const cwd = core.getInput('working-directory')
  if (cwd) {
    process.chdir(cwd)
  }

  const swiftPM = existsSync('Package.swift')
  const platform = core.getInput('platform')
  const selected = await xcselect(core.getInput('xcode'), core.getInput('swift'))
  const action = figureOutAction()
  const configuration = getConfiguration()

  core.info(`Selected Xcode ${selected}`)

  generateIfNecessary()

  let args = (await destination())
  args.push(figureOutAction())
  args = args.concat(await getScheme())
  args = args.concat(other())
  if (quiet()) args.push('-quiet')
  if (configuration) args = args.concat(['-configuration', configuration])

  try {
    core.startGroup('`xcodebuild`')
    spawn('xcodebuild', args)
  } finally {
    core.endGroup()
  }

  function generateIfNecessary() {
    if (platform == 'watchOS' && swiftPM && semver.lt(selected, '12.5.0')) {
      // watchOS prior to 12.4 will fail to `xcodebuild` a SwiftPM project
      // failing trying to build the test modules, so we generate a project
      generate()
    } else if (semver.lt(selected, '11.0.0')) {
      generate()
    }

    function generate() {
      try {
        core.startGroup('Generating `.xcodeproj`')
        spawn('swift', ['package', 'generate-xcodeproj'])
      } finally {
        core.endGroup()
      }
    }
  }

  function figureOutAction() {
    const action = core.getInput('action') || 'test'
    if (semver.gt(selected, '12.5.0')) {
      return action
    } else if (platform == 'watchOS' && action == 'test' && swiftPM) {
      core.warning("Setting `action=build` for Apple Watch / Xcode <12.5")
      return 'build'
    } else {
      return action
    }
  }

  function other() {
    if (core.getBooleanInput('code-coverage') && action == 'test') {
      return ['-enableCodeCoverage', 'YES']
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
}

run().catch(e => {
  core.setFailed(e)
  if (e instanceof SyntaxError && e.stack) {
    core.debug(e.stack)
  }
})
