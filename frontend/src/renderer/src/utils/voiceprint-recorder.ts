// Records a short 16kHz mono WAV sample of one speaker, used to lock Qwen's
// realtime turn detection onto that voice (see server realtime/qwen_realtime.py).
//
// ponytail: ScriptProcessorNode is deprecated but still universally supported
// (incl. iOS/Android WebViews); upgrade to AudioWorklet if it's ever removed.
function encodeWav16Mono(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Records `seconds` of mono audio from the mic and resolves to a 16kHz WAV blob.
 * `onTick` fires roughly every audio-processing frame with elapsed seconds.
 */
export async function recordVoiceSample(
  seconds: number,
  onTick?: (elapsedSeconds: number) => void,
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext: AudioContext = new AudioContextCtor({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  const cleanup = () => {
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
  };

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(total);
      let writeOffset = 0;
      chunks.forEach((chunk) => {
        merged.set(chunk, writeOffset);
        writeOffset += chunk.length;
      });
      resolve(encodeWav16Mono(merged, audioContext.sampleRate));
    };

    processor.onaudioprocess = (event) => {
      if (settled) return;
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      const elapsed = (Date.now() - startedAt) / 1000;
      onTick?.(elapsed);
      if (elapsed >= seconds) finish();
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Voice sample recording timed out'));
    }, (seconds + 5) * 1000);
  });
}
