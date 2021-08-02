import { spawn } from "child_process"
import * as core from '@actions/core'

type SpawnResult = number | NodeJS.Signals | null

async function xcodebuild(args: string[], xcpretty: boolean): Promise<void> {
  const xcodebuild = spawn('xcodebuild', args, { stdio: [
    'inherit',
    xcpretty ? 'pipe' : 'inherit',
    'inherit'
  ]})

  let promise = new Promise<SpawnResult>((fulfill, reject) => {
    xcodebuild.on('error', reject)
    xcodebuild.on('exit', (status, signal) => fulfill(status ?? signal))
  })

  if (xcpretty) {
    const xcpretty = spawn('xcpretty', { stdio: ['pipe', process.stdout, 'inherit'] })

    xcodebuild.stdout?.pipe(xcpretty.stdin)

    promise = promise.then(status0 => new Promise<SpawnResult>((fulfill, reject) => {
      xcpretty.on('error', reject)
      xcpretty.on('exit', (status, signal) => fulfill(status0 ?? status ?? signal))
    }))
  }

  const status = await promise

  if (status !== 0) {
    core.info(`exec: xcodebuild ${args.join(' ')}`)
    throw new Error(`\`xcodebuild\` aborted (${status})`)
  }
}

export default xcodebuild
