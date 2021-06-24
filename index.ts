import { scheme as libGetScheme, spawn, xcselect, getConfiguration, actionIsTestable, getAction, Platform, getDestination, verbosity } from './lib'
import xcodebuildX from './xcodebuild'
const artifact = require('@actions/artifact');
import * as core from '@actions/core'
import { existsSync } from 'fs'
import * as semver from 'semver'
import * as fs from 'fs'
import { basename, extname } from 'path'

//TODO we also need to set the right flags for other languages
const warningsAsErrorsFlags = 'OTHER_SWIFT_FLAGS=-warnings-as-errors'

async function run() {
  const cwd = core.getInput('working-directory')
  if (cwd) {
    process.chdir(cwd)
  }

  const swiftPM = existsSync('Package.swift')
  const platform = core.getInput('platform') as Platform
  const selected = await xcselect(core.getInput('xcode'), core.getInput('swift'))
  const action = getAction(platform, selected)
  const configuration = getConfiguration()
  const warningsAsErrors = core.getBooleanInput('warnings-as-errors')
  const destination = await getDestination(platform)
  const xcpretty = verbosity() == 'xcpretty'

  core.info(`» Xcode ${selected}`)

  if (shouldGenerateXcodeproj()) {
    generateXcodeproj()
  }
  await build(await getScheme())

//// immediate funcs

  function shouldGenerateXcodeproj() {
    if (platform == 'watchOS' && swiftPM && semver.lt(selected, '12.5.0')) {
      // watchOS prior to 12.4 will fail to `xcodebuild` a SwiftPM project
      // failing trying to build the test modules, so we generate a project
      return true
    } else if (semver.lt(selected, '11.0.0')) {
      return true
    } else if (warningsAsErrors && swiftPM) {
      // `build` with SwiftPM projects will build the tests too, and if there are warnings in the
      // tests we will then fail to build (it's common that the tests may have ok warnings)
      //TODO only do this if there are test targets
      return true
    }
  }

  function generateXcodeproj() {
    try {
      core.startGroup('Generating `.xcodeproj`')
      spawn('swift', ['package', 'generate-xcodeproj'])
    } finally {
      core.endGroup()
    }
  }

  async function build(scheme: string | undefined) {
    if (warningsAsErrors && actionIsTestable(action)) {
      await xcodebuild('build', scheme)
    }
    await xcodebuild(action, scheme)
  }

//// helper funcs

  async function xcodebuild(action: string, scheme: string | undefined): Promise<void> {
    try {
      core.startGroup(`\`xcodebuild ${action}\``)
      let args = destination
      if (scheme) args = args.concat(['-scheme', scheme])
      if (verbosity() == 'quiet') args.push('-quiet')
      if (configuration) args = args.concat(['-configuration', configuration])

      args = args.concat(['-resultBundlePath', `${action}`])

      switch (action) {
      case 'build':
        if (warningsAsErrors) args.push(warningsAsErrorsFlags)
        break
      case 'test':
      case 'build-for-testing':
        if (core.getBooleanInput('code-coverage')) {
          args = args.concat(['-enableCodeCoverage', 'YES'])
        }
        break
      }

      args.push(action)

      await xcodebuildX(args, xcpretty)
    } finally {
      core.endGroup()
    }
  }

  //NOTE this is not nearly clever enough I think
  async function getScheme(): Promise<string | undefined> {
    if (swiftPM) {
      return await libGetScheme()
    }
  }
}

run().catch(async e => {
  core.setFailed(e)
  if (e instanceof SyntaxError && e.stack) {
    core.error(e.stack)
  }

  try {
    core.startGroup('Uploading Logs')

    const getFiles = (path: string) => {
      let files: string[] = []
      for (const file of fs.readdirSync(path)) {
        const fullPath = path + '/' + file
        if(fs.lstatSync(fullPath).isDirectory()) {
          files = files.concat(getFiles(fullPath))
        } else {
          files.push(fullPath)
        }
      }
      return files
    }

    const xcresults = fs.readdirSync('.').filter(path => extname(path) == '.xcresult')

    for (const xcresult of xcresults) {
      const base = basename(xcresult, '.xcresult')
      const id = `${process.env.GITHUB_RUN_ID}#${process.env.GITHUB_RUN_NUMBER}`
      const name = `${base}.${id}.xcresult`
      await artifact.create().uploadArtifact(name, getFiles(xcresult), '.')
    }

    const id = `${process.env.GITHUB_RUN_ID}`
    const slug = process.env.GITHUB_REPOSITORY
    const href = `https://github.com/${slug}/actions/runs/${id}#artifact`

    core.warning(`
      We feel you.
      CI failures suck.
      Download the \`.xcresult\` files we just artifact’d.
      They *really* help diagnose what went wrong!
      ${href}
      `.replace(/\s+/g, ' '))

  } finally {
    core.endGroup()
  }
})
