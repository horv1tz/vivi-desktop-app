import { afterEach, describe, expect, it, vi } from 'vitest'

const getCursorScreenPoint = vi.fn()
const getDisplayNearestPoint = vi.fn()
const robot = {
  getMousePos: vi.fn(),
  moveMouse: vi.fn(),
  moveMouseSmooth: vi.fn(),
  mouseClick: vi.fn(),
  mouseToggle: vi.fn(),
  dragMouse: vi.fn(),
  scrollMouse: vi.fn(),
  typeString: vi.fn(),
  keyTap: vi.fn(),
  keyToggle: vi.fn(),
  getScreenSize: vi.fn(),
  setMouseDelay: vi.fn(),
  setKeyboardDelay: vi.fn(),
}

vi.mock('electron', () => ({
  screen: { getCursorScreenPoint, getDisplayNearestPoint },
  clipboard: { readText: vi.fn(async () => ''), writeText: vi.fn(async () => undefined) },
}))
vi.mock('robotjs', () => ({ default: robot }))
vi.mock('../../../src/main/agent/tools/windows-list', () => ({
  listWindows: vi.fn(async () => []),
}))

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
const REAL_PLATFORM = process.platform
afterEach(() => {
  setPlatform(REAL_PLATFORM)
  vi.clearAllMocks()
})

describe('RobotJsDriver — Windows DPI calibration', () => {
  it('uses identity coordinates when robotjs already matches Electron (Per-Monitor-V2-aware build)', async () => {
    setPlatform('win32')
    robot.getMousePos.mockReturnValue({ x: 500, y: 300 })
    getCursorScreenPoint.mockReturnValue({ x: 500, y: 300 })
    getDisplayNearestPoint.mockReturnValue({
      scaleFactor: 2,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    })
    const { RobotJsDriver } = await import('../../../src/main/agent/tools/drivers/robotjs')
    const driver = new RobotJsDriver()
    await driver.moveMouse(800, 400, false)
    // mode 'none': no scaling despite the (mocked) display reporting scaleFactor 2.
    expect(robot.moveMouse).toHaveBeenCalledWith(800, 400)
  })

  it('falls back to per-display scaling when robotjs reports a different coordinate space than Electron', async () => {
    setPlatform('win32')
    robot.getMousePos.mockReturnValue({ x: 1000, y: 600 }) // 2x what Electron reports below
    getCursorScreenPoint.mockReturnValue({ x: 500, y: 300 })
    getDisplayNearestPoint.mockReturnValue({
      scaleFactor: 2,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    })
    const { RobotJsDriver } = await import('../../../src/main/agent/tools/drivers/robotjs')
    const driver = new RobotJsDriver()
    await driver.moveMouse(800, 400, false)
    expect(robot.moveMouse).toHaveBeenCalledWith(1600, 800) // 800*2, 400*2
  })

  it('never scales on non-Windows platforms', async () => {
    setPlatform('linux')
    robot.getMousePos.mockReturnValue({ x: 0, y: 0 })
    const { RobotJsDriver } = await import('../../../src/main/agent/tools/drivers/robotjs')
    const driver = new RobotJsDriver()
    await driver.moveMouse(300, 150, false)
    expect(robot.moveMouse).toHaveBeenCalledWith(300, 150)
    expect(getCursorScreenPoint).not.toHaveBeenCalled()
  })

  it('calibrates once and reuses the decision on later calls', async () => {
    setPlatform('win32')
    robot.getMousePos.mockReturnValue({ x: 10, y: 10 })
    getCursorScreenPoint.mockReturnValue({ x: 10, y: 10 })
    getDisplayNearestPoint.mockReturnValue({
      scaleFactor: 1.5,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    })
    const { RobotJsDriver } = await import('../../../src/main/agent/tools/drivers/robotjs')
    const driver = new RobotJsDriver()
    await driver.moveMouse(1, 1, false)
    await driver.moveMouse(2, 2, false)
    expect(getCursorScreenPoint).toHaveBeenCalledTimes(1)
  })
})
