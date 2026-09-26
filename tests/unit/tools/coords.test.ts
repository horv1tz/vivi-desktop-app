import { describe, expect, it } from 'vitest'
import { imageToLogical } from '../../../src/main/agent/tools/screen'

describe('imageToLogical', () => {
  it('maps downscaled screenshot pixels back to logical display coordinates', () => {
    const shot = { scale: 2560 / 1568, displayBounds: { x: 100, y: 0, width: 2560, height: 1440 } }
    expect(imageToLogical({ x: 784, y: 441 }, shot)).toEqual({ x: 100 + 1280, y: 720 })
  })
  it('accounts for a crop region offset', () => {
    const shot = { scale: 1, displayBounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    expect(imageToLogical({ x: 10, y: 20 }, shot, { x: 500, y: 300 })).toEqual({ x: 510, y: 320 })
  })
})
