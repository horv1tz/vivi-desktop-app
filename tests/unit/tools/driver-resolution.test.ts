import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeRobotJs {
  readonly name = 'robotjs'
  private failWith: string | null
  constructor(failWith: string | null = null) {
    this.failWith = failWith
  }
  async available(): Promise<boolean> {
    return this.failWith === null
  }
  getLoadError(): string | null {
    return this.failWith ? `robotjs unavailable: ${this.failWith}` : null
  }
}

class FakeNativeCli {
  readonly name = 'native-cli'
  private ok: boolean
  constructor(ok = true) {
    this.ok = ok
  }
  async available(): Promise<boolean> {
    return this.ok
  }
}

let robotjsFailWith: string | null = null
let nativeCliOk = true

vi.mock('../../../src/main/agent/tools/drivers/robotjs', () => ({
  RobotJsDriver: class extends FakeRobotJs {
    constructor() {
      super(robotjsFailWith)
    }
  },
}))
vi.mock('../../../src/main/agent/tools/drivers/native-cli', () => ({
  NativeCliDriver: class extends FakeNativeCli {
    constructor() {
      super(nativeCliOk)
    }
  },
}))

const ORIG_ENV = process.env['VIVI_INPUT_DRIVER']

beforeEach(() => {
  vi.resetModules()
  robotjsFailWith = null
  nativeCliOk = true
  delete process.env['VIVI_INPUT_DRIVER']
})

afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env['VIVI_INPUT_DRIVER']
  else process.env['VIVI_INPUT_DRIVER'] = ORIG_ENV
})

describe('getInputDriverInfo (OBS-01)', () => {
  it('reports robotjs as active with a single successful attempt when it loads', async () => {
    const { getInputDriverInfo } = await import('../../../src/main/agent/tools/drivers/index')
    const info = await getInputDriverInfo()
    expect(info.active).toBe('robotjs')
    expect(info.attempts).toEqual([{ name: 'robotjs', ok: true }])
  })

  it('records why robotjs was skipped and falls back to native-cli', async () => {
    robotjsFailWith = 'prebuild not found for this platform/arch'
    const { getInputDriverInfo } = await import('../../../src/main/agent/tools/drivers/index')
    const info = await getInputDriverInfo()
    expect(info.active).toBe('native-cli')
    expect(info.attempts).toEqual([
      {
        name: 'robotjs',
        ok: false,
        reason: 'robotjs unavailable: prebuild not found for this platform/arch',
      },
      { name: 'native-cli', ok: true },
    ])
  })

  it('reports no active driver and both failures when neither is available', async () => {
    robotjsFailWith = 'boom'
    nativeCliOk = false
    const { getInputDriverInfo } = await import('../../../src/main/agent/tools/drivers/index')
    const info = await getInputDriverInfo()
    expect(info.active).toBeNull()
    expect(info.attempts.map((a) => a.ok)).toEqual([false, false])
  })

  it('only tries the forced driver when VIVI_INPUT_DRIVER is set', async () => {
    process.env['VIVI_INPUT_DRIVER'] = 'native'
    const { getInputDriverInfo } = await import('../../../src/main/agent/tools/drivers/index')
    const info = await getInputDriverInfo()
    expect(info.active).toBe('native-cli')
    expect(info.attempts).toEqual([{ name: 'native-cli', ok: true }])
  })

  it('caches the resolution so a second call does not re-run available() checks', async () => {
    const availableSpy = vi.fn(async () => true)
    vi.doMock('../../../src/main/agent/tools/drivers/robotjs', () => ({
      RobotJsDriver: class {
        readonly name = 'robotjs'
        available = availableSpy
      },
    }))
    vi.resetModules()
    const { getInputDriverInfo } = await import('../../../src/main/agent/tools/drivers/index')
    await getInputDriverInfo()
    await getInputDriverInfo()
    expect(availableSpy).toHaveBeenCalledTimes(1)
  })
})
