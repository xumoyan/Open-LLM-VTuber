type RealtimePlaybackCallbacks = {
  onStarted?: (responseId: string) => void
  onEnded?: (responseId: string) => void
  onCancelled?: (responseId: string, reason: string) => void
};

type RealtimeResponse = {
  sources: Set<AudioBufferSourceNode>
  done: boolean
  started: boolean
};

/** Separate from RealtimePlaybackCallbacks (which setRealtimeCallbacks replaces
 * wholesale) so the dh_live avatar can observe PCM/clear/emotion without
 * clobbering websocket-handler's onStarted/onEnded/onCancelled registration. */
type AvatarObserver = {
  onPcm?: (pcm: Float32Array, sampleRate: number, responseId: string) => void
  onClear?: (reason: string) => void
  onEmotion?: (emotion: string, responseId: string) => void
};

/** Shared audio owner for the legacy WAV player and Qwen PCM stream player. */
class AudioManager {
  private currentAudio: HTMLAudioElement | null = null;

  private currentModel: any | null = null;

  private realtimeContext: AudioContext | null = null;

  private realtimeGain: GainNode | null = null;

  private realtimeAnalyser: AnalyserNode | null = null;

  private realtimeCursor = 0;

  private realtimeResponses = new Map<string, RealtimeResponse>();

  private activeRealtimeResponseId = '';

  private realtimeCallbacks: RealtimePlaybackCallbacks = {};

  private avatarObserver: AvatarObserver = {};

  private rmsFrame: number | null = null;

  setCurrentAudio(audio: HTMLAudioElement, model: any) {
    this.currentAudio = audio;
    this.currentModel = model;
  }

  stopCurrentAudioAndLipSync() {
    this.clearRealtime('legacy_interrupt');
    if (!this.currentAudio) return;

    const audio = this.currentAudio;
    audio.pause();
    audio.src = '';
    audio.load();

    const model = this.currentModel;
    if (model?._wavFileHandler) {
      try {
        model._wavFileHandler.releasePcmData();
        model._wavFileHandler._lastRms = 0.0;
        model._wavFileHandler._sampleOffset = 0;
        model._wavFileHandler._userTimeSeconds = 0.0;
      } catch (error) {
        console.warn('[AudioManager] Could not reset legacy lip sync', error);
      }
    }
    this.currentAudio = null;
    this.currentModel = null;
  }

  clearCurrentAudio(audio: HTMLAudioElement) {
    if (this.currentAudio === audio) {
      this.currentAudio = null;
      this.currentModel = null;
    }
  }

  hasCurrentAudio(): boolean {
    return this.currentAudio !== null;
  }

  setRealtimeCallbacks(callbacks: RealtimePlaybackCallbacks) {
    this.realtimeCallbacks = callbacks;
  }

  setAvatarObserver(observer: AvatarObserver) {
    this.avatarObserver = observer;
  }

  emitEmotion(emotion: string, responseId: string) {
    this.avatarObserver.onEmotion?.(emotion, responseId);
  }

  unlockRealtimeAudio() {
    return this.ensureRealtimeContext();
  }

  beginRealtimeResponse(responseId: string) {
    if (!responseId || responseId === this.activeRealtimeResponseId) return;
    this.clearRealtime('response_replaced');
    this.activeRealtimeResponseId = responseId;
    this.realtimeResponses.set(responseId, {
      sources: new Set(),
      done: false,
      started: false,
    });
  }

  async playRealtimePcm(audioBase64: string, sampleRate: number, responseId: string) {
    if (!responseId) return;
    this.beginRealtimeResponse(responseId);
    if (responseId !== this.activeRealtimeResponseId) return;

    const context = await this.ensureRealtimeContext();
    const response = this.realtimeResponses.get(responseId);
    if (!response) return;

    const pcm = this.decodePcm16(audioBase64);
    if (!pcm.length) return;
    this.avatarObserver.onPcm?.(pcm, sampleRate, responseId);
    const buffer = context.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.realtimeGain!);
    response.sources.add(source);

    const startAt = Math.max(context.currentTime + 0.02, this.realtimeCursor);
    this.realtimeCursor = startAt + buffer.duration;
    source.onended = () => {
      response.sources.delete(source);
      this.finishRealtimeResponse(responseId);
    };
    source.start(startAt);
    this.startRmsLoop();

    if (!response.started) {
      response.started = true;
      window.setTimeout(() => {
        if (this.activeRealtimeResponseId === responseId) {
          this.realtimeCallbacks.onStarted?.(responseId);
        }
      }, Math.max(0, (startAt - context.currentTime) * 1000));
    }
  }

  markRealtimeAudioDone(responseId: string) {
    const response = this.realtimeResponses.get(responseId);
    if (!response) return;
    response.done = true;
    this.finishRealtimeResponse(responseId);
  }

  clearRealtime(reason: string) {
    const cancelled = [...this.realtimeResponses.entries()];
    this.realtimeResponses.clear();
    this.activeRealtimeResponseId = '';
    this.realtimeCursor = this.realtimeContext?.currentTime || 0;
    cancelled.forEach(([responseId, response]) => {
      response.sources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // A source may already have finished between clear and stop.
        }
      });
      this.realtimeCallbacks.onCancelled?.(responseId, reason);
    });
    this.avatarObserver.onClear?.(reason);
    this.stopRmsLoop();
  }

  private async ensureRealtimeContext(): Promise<AudioContext> {
    if (!this.realtimeContext) {
      this.realtimeContext = new AudioContext();
      this.realtimeGain = this.realtimeContext.createGain();
      this.realtimeAnalyser = this.realtimeContext.createAnalyser();
      this.realtimeAnalyser.fftSize = 512;
      this.realtimeGain.connect(this.realtimeAnalyser);
      this.realtimeAnalyser.connect(this.realtimeContext.destination);
    }
    if (this.realtimeContext.state === 'suspended') {
      await this.realtimeContext.resume();
    }
    return this.realtimeContext;
  }

  private decodePcm16(audioBase64: string): Float32Array {
    const binary = window.atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const view = new DataView(bytes.buffer);
    const pcm = new Float32Array(bytes.byteLength / 2);
    for (let index = 0; index < pcm.length; index += 1) {
      pcm[index] = view.getInt16(index * 2, true) / 32768;
    }
    return pcm;
  }

  private finishRealtimeResponse(responseId: string) {
    const response = this.realtimeResponses.get(responseId);
    if (!response || !response.done || response.sources.size) return;
    this.realtimeResponses.delete(responseId);
    if (this.activeRealtimeResponseId === responseId) {
      this.activeRealtimeResponseId = '';
      this.realtimeCallbacks.onEnded?.(responseId);
    }
    if (!this.realtimeResponses.size) this.stopRmsLoop();
  }

  private startRmsLoop() {
    if (this.rmsFrame !== null || !this.realtimeAnalyser) return;
    const samples = new Float32Array(this.realtimeAnalyser.fftSize);
    const tick = () => {
      if (!this.realtimeAnalyser || !this.realtimeResponses.size) {
        this.stopRmsLoop();
        return;
      }
      this.realtimeAnalyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      const adapter = (window as any).getLAppAdapter?.();
      adapter?.setRealtimeLipSyncRms(Math.min(1, rms * 3));
      this.rmsFrame = window.requestAnimationFrame(tick);
    };
    this.rmsFrame = window.requestAnimationFrame(tick);
  }

  private stopRmsLoop() {
    if (this.rmsFrame !== null) window.cancelAnimationFrame(this.rmsFrame);
    this.rmsFrame = null;
    const adapter = (window as any).getLAppAdapter?.();
    adapter?.setRealtimeLipSyncRms(null);
  }
}

export const audioManager = new AudioManager();
