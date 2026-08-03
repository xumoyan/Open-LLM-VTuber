/**
 * Converts Qwen's 24kHz PCM16 output into the 16kHz mono WAV chunks the
 * DH_live avatar renderer expects. Linear interpolation is enough for a
 * lip-sync-driving signal; no external resampling library needed.
 */
export function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  const outputSampleRate = 16000
  if (inputSampleRate === outputSampleRate) return input
  if (input.length === 0) return new Float32Array(0)

  const ratio = inputSampleRate / outputSampleRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, input.length - 1)
    const frac = sourceIndex - lower
    output[i] = input[lower] * (1 - frac) + input[upper] * frac
  }
  return output
}

/** Wraps 32-bit float samples in a minimal 16-bit PCM mono WAV container. */
export function encodeWav16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAsciiString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAsciiString(view, 8, 'WAVE')
  writeAsciiString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAsciiString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }
  return buffer
}

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

/** Qwen 24kHz PCM16 delta -> 16kHz WAV chunk, in one call. */
export function qwenDeltaToWav16(pcm16: Int16Array, inputSampleRate: number): ArrayBuffer {
  const floatSamples = new Float32Array(pcm16.length)
  for (let i = 0; i < pcm16.length; i += 1) {
    floatSamples[i] = pcm16[i] / 0x8000
  }
  const resampled = resampleTo16k(floatSamples, inputSampleRate)
  return encodeWav16Mono(resampled, 16000)
}

function selfCheck(): void {
  const inputSampleRate = 24000
  const durationSeconds = 1
  const frequencyHz = 440
  const input = new Float32Array(inputSampleRate * durationSeconds)
  for (let i = 0; i < input.length; i += 1) {
    input[i] = Math.sin((2 * Math.PI * frequencyHz * i) / inputSampleRate)
  }

  const resampled = resampleTo16k(input, inputSampleRate)
  const expectedLength = 16000
  if (Math.abs(resampled.length - expectedLength) > 1) {
    throw new Error(`resample length off: got ${resampled.length}, want ~${expectedLength}`)
  }

  const wav = encodeWav16Mono(resampled, 16000)
  const view = new DataView(wav)
  const readAscii = (offset: number, len: number): string =>
    String.fromCharCode(...new Uint8Array(wav, offset, len))

  if (readAscii(0, 4) !== 'RIFF') throw new Error('missing RIFF header')
  if (readAscii(8, 4) !== 'WAVE') throw new Error('missing WAVE header')
  if (view.getUint16(22, true) !== 1) throw new Error('wrong channel count in header')
  if (view.getUint32(24, true) !== 16000) throw new Error('wrong sample rate in header')
  if (view.getUint16(34, true) !== 16) throw new Error('wrong bit depth in header')
  const dataSize = view.getUint32(40, true)
  if (dataSize !== resampled.length * 2) throw new Error('wrong data chunk size in header')
  if (wav.byteLength !== 44 + dataSize) throw new Error('wrong total wav byte length')

  // eslint-disable-next-line no-console
  console.log(`ok: resampled ${input.length} -> ${resampled.length} samples, wav ${wav.byteLength} bytes`)
}

// Run directly with: node frontend/src/renderer/src/utils/audio-resample.ts
if (
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  import.meta.url === `file://${process.argv[1]}`
) {
  selfCheck()
}
