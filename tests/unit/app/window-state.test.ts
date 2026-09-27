import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clampToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from '../../../src/main/app/window-state'

describe('clampToDisplays (UX-08)', () => {
  const singleDisplay = [{ x: 0, y: 0, width: 1920, height: 1080 }]

  it('keeps bounds unchanged when fully on-screen', () => {
    const state: WindowState = { x: 100, y: 100, width: 1180, height: 780, isMaximized: false }
    expect(clampToDisplays(state, singleDisplay)).toEqual(state)
  })

  it('re-centers on the primary display when the saved position is on no current display', () => {
    // e.g. a second monitor to the right (x: 1920+) was disconnected
    const state: WindowState = { x: 2200, y: 200, width: 1180, height: 780, isMaximized: false }
    const result = clampToDisplays(state, singleDisplay)
    expect(result.x).toBe(Math.round((1920 - 1180) / 2))
    expect(result.y).toBe(Math.round((1080 - 780) / 2))
    expect(result.width).toBe(1180)
    expect(result.height).toBe(780)
  })

  it('keeps position when the top-left corner still lands on a display, even near an edge', () => {
    const state: WindowState = { x: -10, y: 5, width: 800, height: 600, isMaximized: false }
    expect(clampToDisplays(state, singleDisplay)).toEqual(state)
  })

  it('caps width/height to the largest available display', () => {
    const state: WindowState = { x: 50, y: 50, width: 4000, height: 3000, isMaximized: false }
    const result = clampToDisplays(state, singleDisplay)
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
  })

  it('matches whichever display the saved corner falls on in a multi-monitor setup', () => {
    const displays = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 2560, height: 1440 },
    ]
    const state: WindowState = { x: 2000, y: 100, width: 1200, height: 800, isMaximized: false }
    expect(clampToDisplays(state, displays)).toEqual(state)
  })

  it('preserves isMaximized through both the unchanged and re-centered paths', () => {
    const onScreen: WindowState = { x: 10, y: 10, width: 800, height: 600, isMaximized: true }
    expect(clampToDisplays(onScreen, singleDisplay).isMaximized).toBe(true)
    const offScreen: WindowState = { x: 9000, y: 9000, width: 800, height: 600, isMaximized: true }
    expect(clampToDisplays(offScreen, singleDisplay).isMaximized).toBe(true)
  })

  it('returns the state unchanged when there are no displays at all', () => {
    const state: WindowState = { x: 10, y: 10, width: 800, height: 600, isMaximized: false }
    expect(clampToDisplays(state, [])).toBe(state)
  })
})

describe('loadWindowState / saveWindowState (UX-08)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vivi-window-state-'))
    file = join(dir, 'window-state.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is null when the file does not exist', () => {
    expect(loadWindowState(file)).toBeNull()
  })

  it('round-trips a saved state', () => {
    const state: WindowState = { x: 12, y: 34, width: 1000, height: 700, isMaximized: true }
    saveWindowState(file, state)
    expect(loadWindowState(file)).toEqual(state)
  })

  it('is null for a corrupt file instead of throwing', () => {
    writeFileSync(file, '{not json')
    expect(loadWindowState(file)).toBeNull()
  })

  it('is null when width/height are missing or non-positive', () => {
    writeFileSync(file, JSON.stringify({ x: 0, y: 0, width: 0, height: 600 }))
    expect(loadWindowState(file)).toBeNull()
  })

  it('defaults missing x/y to 0 and isMaximized to false', () => {
    writeFileSync(file, JSON.stringify({ width: 800, height: 600 }))
    expect(loadWindowState(file)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      isMaximized: false,
    })
  })
})
