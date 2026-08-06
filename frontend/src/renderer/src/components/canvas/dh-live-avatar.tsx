import { useEffect, useRef } from 'react';
import { audioManager } from '@/utils/audio-manager';
import { resampleTo16k, encodeWav16Mono } from '@/utils/audio-resample';

declare global {
  interface Window {
    __dhLiveAssetDir?: string;
    __dhLiveMiniInit?: () => Promise<void>;
    __dhLiveScriptsLoaded?: boolean;
    Module?: {
      _malloc: (size: number) => number
      _free: (ptr: number) => void
      _setAudioBuffer: (ptr: number, byteLength: number) => void
      _clearAudio: () => void
      HEAPU8: Uint8Array
    };
  }
}

const RUNTIME_BASE = '/digital-human/runtime/dh-live';
const SCRIPTS = ['pako.min.js', 'DHLiveMini.js', 'MiniMateLoader.js', 'MiniLive2.js'];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.body.appendChild(script);
  });
}

async function loadScriptsInOrder(): Promise<void> {
  for (const file of SCRIPTS) {
    // Each vendored script relies on globals the previous one defines
    // (Module, qtLoad, CONFIG), so they must load one at a time, in order.
    // eslint-disable-next-line no-await-in-loop
    await loadScript(`${RUNTIME_BASE}/${file}`);
  }
}

/**
 * Renders DH_live's mini WASM talking-head avatar, driven by the same Qwen
 * PCM stream the Live2D lip-sync uses (see AudioManager.setAvatarObserver).
 * Falls back is implicit: character-config-context defaults to live2d, and
 * any error here is caught and logged rather than thrown, so the caller can
 * keep the character on Live2D if this never becomes ready.
 */
export function DhLiveAvatar({ assetId }: { assetId?: string }) {
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    window.__dhLiveAssetDir = `/digital-human/${assetId || 'test_avatar'}`;

    async function boot() {
      // ponytail: MiniLive2.js/MiniMateLoader.js declare top-level let/const
      // globals (CONFIG, Module, ...), so loading them twice in one page
      // throws "already declared". Scripts load once per page session;
      // revisit with an iframe or module wrapper if the UI ever needs to
      // toggle dh_live on/off repeatedly without a full page reload.
      if (!window.__dhLiveScriptsLoaded) {
        window.__dhLiveScriptsLoaded = true;
        try {
          await loadScriptsInOrder();
        } catch (error) {
          console.error('[DhLiveAvatar] failed to load runtime', error);
          return;
        }
      }
      if (cancelled) return;
      try {
        await window.__dhLiveMiniInit?.();
        readyRef.current = true;
      } catch (error) {
        console.error('[DhLiveAvatar] init failed', error);
      }
    }

    boot();

    // iOS/WKWebView can silently block MiniLive2.js's autoplay call for
    // #background_video on cold launch (no user gesture yet). Retry once
    // a gesture happens -- play() inside a gesture handler is allowed even
    // when the earlier unprompted call was rejected.
    const retryBackgroundVideoPlay = () => {
      const bgVideo = document.getElementById('background_video') as HTMLVideoElement | null;
      if (bgVideo?.paused) bgVideo.play().catch(() => {});
    };
    document.addEventListener('touchstart', retryBackgroundVideoPlay, { once: true, passive: true });
    document.addEventListener('pointerdown', retryBackgroundVideoPlay, { once: true });

    audioManager.setAvatarObserver({
      onPcm: (pcm, sampleRate) => {
        const { Module } = window;
        if (!Module || !readyRef.current) return;
        try {
          const resampled = resampleTo16k(pcm, sampleRate);
          const wav = new Uint8Array(encodeWav16Mono(resampled, 16000));
          const ptr = Module._malloc(wav.byteLength);
          Module.HEAPU8.set(wav, ptr);
          Module._setAudioBuffer(ptr, wav.byteLength);
          Module._free(ptr);
        } catch (error) {
          console.error('[DhLiveAvatar] failed to push audio', error);
        }
      },
      onClear: () => {
        try {
          window.Module?._clearAudio();
        } catch (error) {
          console.error('[DhLiveAvatar] failed to clear audio', error);
        }
      },
      onEmotion: (emotion) => {
        // Only one placeholder/test avatar exists so far; once per-emotion
        // base videos are recorded, switch videoProcessor.init() here.
        console.log('[DhLiveAvatar] emotion tag (not yet wired to a video):', emotion);
      },
    });

    return () => {
      cancelled = true;
      document.removeEventListener('touchstart', retryBackgroundVideoPlay);
      document.removeEventListener('pointerdown', retryBackgroundVideoPlay);
      audioManager.setAvatarObserver({});
    };
  }, [assetId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <figure id="loadingSpinner"><strong>MatesX: loading...</strong></figure>
      <canvas
        id="canvasEl"
        style={{ position: 'absolute', left: -9999, top: -9999, width: 300, height: 150 }}
      />
      <video
        id="background_video"
        muted
        loop
        playsInline
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 0,
        }}
      />
      <canvas
        id="canvas_video"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1,
        }}
      />
      <canvas
        id="canvas_gl"
        width={184}
        height={184}
        style={{ position: 'absolute', left: -9999, top: -9999, width: 184, height: 184 }}
      />
      {/* ponytail: the "MatesX" watermark is burned into test_avatar's video
          pixels, not a layer we control, so this masks the fixed screen
          position it happens to sit at for THIS one placeholder clip. It
          won't line up for any other asset/aspect ratio -- drop it once
          real (unwatermarked) footage replaces the demo asset. */}
      {(assetId || 'test_avatar') === 'test_avatar' && (
        <div
          style={{
            position: 'absolute',
            left: '45%',
            top: '47%',
            width: '18%',
            height: '3.4%',
            background: '#28374d',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
      )}
      <div id="screen" />
      <div id="screen2" style={{ display: 'none' }} />
      <div
        id="startMessage"
        style={{ position: 'absolute', top: '60%', left: '50%', transform: 'translate(-50%, -50%)' }}
      >
        加载中
      </div>
    </div>
  );
}
