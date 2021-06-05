import { destinations, scheme, spawn, xcselect } from './lib'
import * as core from '@actions/core'
import { existsSync } from 'fs'
import * as semver from 'semver'

async function run() {
  const cwd = core.getInput('working-directory')
  if (cwd) {
    process.chdir(cwd)
  }

  const swiftPM = existsSync('Package.swift')
  const xcode = core.getInput('xcode')
  const platform = core.getInput('platform')
  const selected = await xcselect(xcode)
  const action = figureOutAction()

  core.info(`Selected Xcode ${selected}`)

  await generateIfNecessary()

  let args = (await destination())
  args.push(figureOutAction())
  args = args.concat(await getScheme())
  args = args.concat(other())
  if (core.getInput('quiet')) args.push('-quiet')

  try {
    core.startGroup('`xcodebuild`')
    spawn('xcodebuild', args)
  } finally {
    core.endGroup()
  }

  async function generateIfNecessary() {
    if (platform == 'watchOS' && swiftPM && semver.lt(selected, '12.5.0')) {
      // watchOS prior to 12.4 will fail to `xcodebuild` a SwiftPM project
      // failing trying to build the test modules, so we generate a project
      await generate()
    } else if (semver.lt(selected, '11.0.0')) {
      await generate()
    }

    async function generate() {
      try {
        core.startGroup('Generating `.xcodeproj`')
        await spawn('swift', ['package', 'generate-xcodeproj'])
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
      core.warning("Cannot test Apple Watch with Xcode < 12.5")
      return 'build'
    } else {
      return action
    }
  }

  function other() {
    if ((core.getInput('code-coverage') || false) && action == 'test') {
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
}

run().catch(e => {
  core.setFailed(e)
  if (e instanceof SyntaxError && e.stack) {
    core.debug(e.stack)
  }
})
