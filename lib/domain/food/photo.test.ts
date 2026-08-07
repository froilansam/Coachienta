import { describe, expect, it } from 'vitest'
import { base64Bytes, fitWithin, stripDataUrl } from './photo'

describe('fitWithin', () => {
  it('scales a landscape photo by its longest edge', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1024, height: 768 })
  })
  it('scales a portrait photo by its longest edge', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 768, height: 1024 })
  })
  it('never upscales a small image', () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 })
  })
  it('leaves an exactly-sized image alone', () => {
    expect(fitWithin(1024, 1024)).toEqual({ width: 1024, height: 1024 })
  })
  it('preserves aspect ratio within a rounding pixel', () => {
    const { width, height } = fitWithin(1999, 1000)
    expect(Math.abs(width / height - 1999 / 1000)).toBeLessThan(0.01)
  })
})

describe('stripDataUrl', () => {
  it('removes a jpeg prefix', () => {
    expect(stripDataUrl('data:image/jpeg;base64,AAAB')).toBe('AAAB')
  })
  it('leaves bare base64 untouched', () => {
    expect(stripDataUrl('AAAB')).toBe('AAAB')
  })
})

describe('base64Bytes', () => {
  it('approximates the decoded size', () => {
    expect(base64Bytes('AAAA')).toBe(3)
  })
})
