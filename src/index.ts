import { scheme as libGetScheme, spawn, xcselect, getConfiguration, actionIsTestable, getAction, Platform, getDestination, getIdentity, createKeychain, deleteKeychain, verbosity } from './lib'
import xcodebuildX from './xcodebuild'
import artifact from '@actions/artifact';
import * as core from '@actions/core'
import { existsSync } from 'fs'
import * as semver from 'semver'
import * as fs from 'fs'
import { basename, extname, join } from 'path'

//TODO we also need to set the right flags for other languages
const warningsAsErrorsFlags = 'OTHER_SWIFT_FLAGS=-warnings-as-errors'

async function main() {
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
  const destination = await getDestination(platform, selected)
  const identity = getIdentity(core.getInput('code-sign-identity'), platform)
  const xcpretty = verbosity() == 'xcpretty'

  core.info(`» Selected Xcode ${selected}`)

  const reason: string | false = shouldGenerateXcodeproj()
  if (reason) {
    generateXcodeproj(reason)
  }

  await configureKeychain()

  await build(await getScheme())

  if (core.getInput('upload-logs') == 'always') {
    await uploadLogs()
  }

//// immediate funcs

  function shouldGenerateXcodeproj(): string | false {
    if (!swiftPM) return false
    if (platform == 'watchOS' && semver.lt(selected, '12.5.0')) {
      // watchOS prior to 12.4 will fail to `xcodebuild` a SwiftPM project
      // failing trying to build the test modules, so we generate a project
      return 'Xcode <12.5 fails to build Swift Packages for watchOS if tests exist'
    } else if (semver.lt(selected, '11.0.0')) {
      return 'Xcode <11 cannot build'
    } else if (warningsAsErrors) {
      // `build` with SwiftPM projects will build the tests too, and if there are warnings in the
      // tests we will then fail to build (it's common that the tests may have ok warnings)
      //TODO only do this if there are test targets
      return '`warningsAsErrors` is set'
    }
    return false
  }

  function generateXcodeproj(reason: string) {
    try {
      core.startGroup('Generating `.xcodeproj`')
      core.info(`Generating \`.xcodeproj\` ∵ ${reason}`)
      spawn('swift', ['package', 'generate-xcodeproj'])
    } finally {
      core.endGroup()
    }
  }

  async function configureKeychain() {
    const certificate = core.getInput('code-sign-certificate')
    if (!certificate) return

    if (process.env.RUNNER_OS != 'macOS') {
      throw new Error('code-sign-certificate requires macOS.')
    }

    const passphrase = core.getInput('code-sign-certificate-passphrase')
    if (!passphrase) {
      throw new Error('code-sign-certificate requires code-sign-certificate-passphrase.')
    }

    await core.group(
      'Configuring code signing',
      async function() {
        await createKeychain(certificate, passphrase)
      }
    )
  }

  async function build(scheme: string | undefined) {
    if (warningsAsErrors && actionIsTestable(action)) {
      await xcodebuild('build', scheme)
    }
    await xcodebuild(action, scheme)
  }

//// helper funcs

  async function xcodebuild(action: string | null, scheme: string | undefined): Promise<void> {
    if (action === 'none') return

    try {
      const title = ['xcodebuild', action].filter(x=>x).join(' ')
      core.startGroup(`\`${title}\``)
      let args = destination
      if (scheme) args = args.concat(['-scheme', scheme])
      if (identity) args = args.concat(identity)
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

      if (action) args.push(action)

      await xcodebuildX(args, xcpretty)
    } finally {
      core.endGroup()
    }
  }

  //NOTE this is not nearly clever enough I think
  async function getScheme(): Promise<string | undefined> {
    const scheme = core.getInput('scheme')
    if (scheme) {
      return scheme
    }

    if (swiftPM) {
      return await libGetScheme()
    }
  }
}

async function post() {
  await deleteKeychain()
}

async function run() {
  // We use the same entry point for `main` and `post` in action.yml in order to
  // avoid duplicating common logic. To differentiate at runtime, we set some
  // state in `main` for `post` to read.
  const isPost = Boolean(core.getState('isPost'))
  if (isPost) {
    return await post()
  } else {
    core.saveState('isPost', true)
  }

  try {
    await main()
  } catch (error) {
    await uploadLogs()

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

    throw error
  }
}

run().catch(async e => {
  core.setFailed(e)

  if (e instanceof SyntaxError && e.stack) {
    core.error(e.stack)
  }
})

async function uploadLogs() {
  const getFiles: (path: string) => string[] = path => fs.readdirSync(path)
    .map(file => join(path, file))
    .flatMap(path => fs.lstatSync(path).isDirectory() ? getFiles(path) : [path])

  try {
    core.startGroup('Uploading Logs')

    const xcresults = fs.readdirSync('.').filter(path => extname(path) == '.xcresult')

    if (xcresults.length === 0) {
      core.warning("strange… no `.xcresult` bundles found")
    }

    for (const xcresult of xcresults) {

      // random part because GitHub doesn’t yet expose any kind of per-job, per-matrix ID
      // https://github.community/t/add-build-number/16149/17
      const nonce = Math.random().toString(36).replace(/[^a-zA-Z0-9]+/g, '').substr(0, 6)

      const base = basename(xcresult, '.xcresult')
      const name = `${base}#${process.env.GITHUB_RUN_NUMBER}.${nonce}.xcresult`
      await artifact.create().uploadArtifact(name, getFiles(xcresult), '.')
    }
  } finally {
    core.endGroup()
  }
}
