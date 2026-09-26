import workletUrl from './capture.worklet?worker&url'

/** Microphone capture: getUserMedia → AudioWorklet → MessagePort (to the voice worker). */
export class MicCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private port: MessagePort | null = null
  private deviceId = ''

  get active(): boolean {
    return this.node !== null
  }

  setPort(port: MessagePort): void {
    this.port = port
    if (this.node) this.node.port.postMessage({ port }, [port])
  }

  async start(deviceId = ''): Promise<void> {
    if (this.node && this.deviceId === deviceId) return
    await this.stop()
    this.deviceId = deviceId
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    this.ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
    await this.ctx.audioWorklet.addModule(workletUrl)
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    })
    source.connect(this.node)
    if (this.port) {
      const p = this.port
      this.port = null
      this.node.port.postMessage({ port: p }, [p])
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  setMuted(muted: boolean): void {
    this.node?.port.postMessage({ muted })
  }

  async stop(): Promise<void> {
    this.node?.disconnect()
    this.node = null
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.stream = null
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}
