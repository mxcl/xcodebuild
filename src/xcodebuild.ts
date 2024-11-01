import { spawn } from 'child_process'
import * as core from '@actions/core'
import { Verbosity } from './lib'

type SpawnResult = number | NodeJS.Signals | null

export default async function xcodebuild(
  args: string[],
  verbosity: Verbosity
): Promise<void> {
  const needsPipe = verbosity === 'xcpretty' || verbosity === 'xcbeautify'

  const xcodebuild = spawn('xcodebuild', args, {
    stdio: ['inherit', needsPipe ? 'pipe' : 'inherit', 'inherit'],
  })

  let promise = new Promise<SpawnResult>((fulfill, reject) => {
    xcodebuild.on('error', reject)
    xcodebuild.on('exit', (status, signal) => fulfill(status ?? signal))
  })

  if (needsPipe) {
    const processResponse = spawn(verbosity, {
      stdio: ['pipe', process.stdout, 'inherit'],
    })

    xcodebuild.stdout?.pipe(processResponse.stdin)

    promise = promise.then(
      (status0) =>
        new Promise<SpawnResult>((fulfill, reject) => {
          processResponse.on('error', reject)
          processResponse.on('exit', (status, signal) =>
            fulfill(status0 ?? status ?? signal)
          )
        })
    )
  }

  const status = await promise

  if (status !== 0) {
    core.info(`exec: xcodebuild ${args.join(' ')}`)
    throw new Error(`\`xcodebuild\` aborted (${status})`)
  }
}
