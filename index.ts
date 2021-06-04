import { destinations, scheme } from './lib'
import * as core from '@actions/core'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'

async function run() {
  const xcode = core.getInput('xcode')
  const platform = core.getInput('platform')
  const action = core.getInput('action')

  let args = (await destination())
  args.push(figureOutAction())
  args = args.concat(await getScheme())
  args = args.concat(other())

  const { error } = spawnSync('xcodebuild', args, {stdio: 'inherit'})
  if (error) throw error

  function figureOutAction() {
    return platform == 'watchOS' ? 'build' : (action || 'test')
  }

  function other() {
    if (core.getInput('code-coverage') || false) {
      return ['ENABLE_CODE_COVERAGE=YES']
    } else {
      return []
    }
  }

  async function getScheme() {
    if (existsSync('Package.swift')) {
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

run().catch(core.setFailed)
