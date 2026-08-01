/* eslint-disable no-use-before-define */
import {
  createContext, useContext, useRef, useCallback, useEffect, useReducer, useMemo, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MicVAD } from '@ricky0123/vad-web';
import { useInterrupt } from '@/components/canvas/live2d';
import { SubtitleContext } from './subtitle-context';
import { AiStateContext, AiState } from './ai-state-context';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { toaster } from '@/components/ui/toaster';
import { useWebSocket } from './websocket-context';
import { audioManager } from '@/utils/audio-manager';

export interface VADSettings {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionFrames: number;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

interface VADState {
  autoStopMic: boolean;
  micOn: boolean;
  micError: string | null;
  setMicOn: (value: boolean) => void;
  setAutoStopMic: (value: boolean) => void;
  startMic: () => Promise<void>;
  stopMic: () => void;
  previousTriggeredProbability: number;
  setPreviousTriggeredProbability: (value: number) => void;
  settings: VADSettings;
  updateSettings: (newSettings: VADSettings) => void;
  autoStartMicOn: boolean;
  setAutoStartMicOn: (value: boolean) => void;
  autoStartMicOnConvEnd: boolean;
  setAutoStartMicOnConvEnd: (value: boolean) => void;
  audioInputDevices: AudioInputDevice[];
  selectedAudioInputDeviceId: string;
  setSelectedAudioInputDeviceId: (deviceId: string) => void;
  refreshAudioInputDevices: () => Promise<void>;
}

const DEFAULT_VAD_SETTINGS: VADSettings = {
  positiveSpeechThreshold: 50,
  negativeSpeechThreshold: 35,
  redemptionFrames: 35,
};

const DEFAULT_VAD_STATE = {
  autoStopMic: false,
  autoStartMicOn: false,
  autoStartMicOnConvEnd: false,
};

const PCM_CHUNK_SAMPLES = 1600;

export const VADContext = createContext<VADState | null>(null);

function pcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, Math.round(clamped * 32767), true);
  });
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
}

function displayDeviceLabel(device: MediaDeviceInfo, index: number): string {
  const label = device.label || `Microphone ${index + 1}`;
  return /virtual|background music|blackhole|loopback/i.test(label)
    ? `⚠ ${label} (virtual)`
    : label;
}

export function VADProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const vadRef = useRef<MicVAD | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopMicRef = useRef<() => void>(() => {});
  const previousTriggeredProbabilityRef = useRef(0);
  const previousAiStateRef = useRef<AiState>('idle');
  const isProcessingRef = useRef(false);
  const pendingPcmRef = useRef(new Float32Array(0));

  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const autoStopMicRef = useRef(true);
  const [autoStopMic, setAutoStopMicState] = useLocalStorage(
    'autoStopMic',
    DEFAULT_VAD_STATE.autoStopMic,
  );
  const [settings, setSettings] = useLocalStorage<VADSettings>(
    'vadSettings',
    DEFAULT_VAD_SETTINGS,
  );
  const [autoStartMicOn, setAutoStartMicOnState] = useLocalStorage(
    'autoStartMicOn',
    DEFAULT_VAD_STATE.autoStartMicOn,
  );
  const autoStartMicRef = useRef(false);
  const [autoStartMicOnConvEnd, setAutoStartMicOnConvEndState] = useLocalStorage(
    'autoStartMicOnConvEnd',
    DEFAULT_VAD_STATE.autoStartMicOnConvEnd,
  );
  const autoStartMicOnConvEndRef = useRef(false);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceIdState] = useLocalStorage(
    'selectedAudioInputDeviceId',
    'default',
  );
  const selectedDeviceIdRef = useRef(selectedAudioInputDeviceId);
  const [, forceUpdate] = useReducer((value) => value + 1, 0);

  const { interrupt } = useInterrupt();
  const { sendMessage } = useWebSocket();
  const { setSubtitleText } = useContext(SubtitleContext)!;
  const { aiState, setAiState } = useContext(AiStateContext)!;

  const interruptRef = useRef(interrupt);
  const sendMessageRef = useRef(sendMessage);
  const aiStateRef = useRef<AiState>(aiState);
  const setSubtitleTextRef = useRef(setSubtitleText);
  const setAiStateRef = useRef(setAiState);

  useEffect(() => { aiStateRef.current = aiState; }, [aiState]);
  useEffect(() => { interruptRef.current = interrupt; }, [interrupt]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  useEffect(() => { setSubtitleTextRef.current = setSubtitleText; }, [setSubtitleText]);
  useEffect(() => { setAiStateRef.current = setAiState; }, [setAiState]);
  useEffect(() => { autoStopMicRef.current = autoStopMic; }, [autoStopMic]);
  useEffect(() => { autoStartMicRef.current = autoStartMicOn; }, [autoStartMicOn]);
  useEffect(() => { autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd; }, [autoStartMicOnConvEnd]);
  useEffect(() => { selectedDeviceIdRef.current = selectedAudioInputDeviceId; }, [selectedAudioInputDeviceId]);

  const refreshAudioInputDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioInputDevices([
      { deviceId: 'default', label: 'Default microphone' },
      ...devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: displayDeviceLabel(device, index),
        })),
    ]);
  }, []);

  useEffect(() => {
    void refreshAudioInputDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshAudioInputDevices);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshAudioInputDevices);
  }, [refreshAudioInputDevices]);

  const setPreviousTriggeredProbability = useCallback((value: number) => {
    previousTriggeredProbabilityRef.current = value;
    forceUpdate();
  }, []);

  const sendRealtimeFrame = useCallback((frame: Float32Array) => {
    const previous = pendingPcmRef.current;
    const merged = new Float32Array(previous.length + frame.length);
    merged.set(previous);
    merged.set(frame, previous.length);

    let offset = 0;
    while (offset + PCM_CHUNK_SAMPLES <= merged.length) {
      sendMessageRef.current({
        type: 'audio.append',
        audio: pcm16Base64(merged.slice(offset, offset + PCM_CHUNK_SAMPLES)),
      });
      offset += PCM_CHUNK_SAMPLES;
    }
    pendingPcmRef.current = merged.slice(offset);
  }, []);

  const handleSpeechStart = useCallback(() => {
    previousAiStateRef.current = aiStateRef.current;
    isProcessingRef.current = true;
  }, []);

  const handleSpeechRealStart = useCallback(() => {
    if (previousAiStateRef.current === 'thinking-speaking') {
      interruptRef.current();
    }
    setAiStateRef.current('listening');
  }, []);

  const handleFrameProcessed = useCallback((probs: { isSpeech: number }, frame: Float32Array) => {
    if (probs.isSpeech > previousTriggeredProbabilityRef.current) {
      setPreviousTriggeredProbability(probs.isSpeech);
    }
    if (frame?.length) sendRealtimeFrame(frame);
  }, [sendRealtimeFrame, setPreviousTriggeredProbability]);

  const handleSpeechEnd = useCallback(() => {
    isProcessingRef.current = false;
    setPreviousTriggeredProbability(0);
  }, [setPreviousTriggeredProbability]);

  const handleVADMisfire = useCallback(() => {
    if (!isProcessingRef.current) return;
    setPreviousTriggeredProbability(0);
    isProcessingRef.current = false;
    setAiStateRef.current(previousAiStateRef.current);
    setSubtitleTextRef.current(t('error.vadMisfire'));
  }, [setPreviousTriggeredProbability, t]);

  const disposeVAD = useCallback(() => {
    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) {
      vad.pause();
      vad.destroy();
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    pendingPcmRef.current = new Float32Array(0);
    isProcessingRef.current = false;
  }, []);

  const initVAD = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedDeviceIdRef.current === 'default'
          ? undefined
          : { exact: selectedDeviceIdRef.current },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    try {
      const newVAD = await MicVAD.new({
        model: 'v5',
        preSpeechPadFrames: 20,
        positiveSpeechThreshold: settings.positiveSpeechThreshold / 100,
        negativeSpeechThreshold: settings.negativeSpeechThreshold / 100,
        redemptionFrames: settings.redemptionFrames,
        baseAssetPath: './libs/',
        onnxWASMBasePath: './libs/',
        stream,
        onSpeechStart: handleSpeechStart,
        onSpeechRealStart: handleSpeechRealStart,
        onFrameProcessed: handleFrameProcessed,
        onSpeechEnd: handleSpeechEnd,
        onVADMisfire: handleVADMisfire,
      });
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        if (streamRef.current === stream) stopMicRef.current();
      }, { once: true }));
      vadRef.current = newVAD;
      newVAD.start();
    } catch (error) {
      if (streamRef.current === stream) streamRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }, [handleFrameProcessed, handleSpeechEnd, handleSpeechRealStart, handleSpeechStart, handleVADMisfire, settings]);

  const startMic = useCallback(async () => {
    try {
      void audioManager.unlockRealtimeAudio();
      sendMessageRef.current({ type: 'connect', inputEnabled: true, outputEnabled: true });
      const hasLiveInput = streamRef.current?.getAudioTracks()
        .some((track) => track.readyState === 'live');
      if (!vadRef.current || !hasLiveInput) {
        disposeVAD();
        await initVAD();
      } else {
        vadRef.current.start();
      }
      await refreshAudioInputDevices();
      setMicError(null);
      setMicOn(true);
    } catch (error) {
      console.error('Failed to start VAD:', error);
      setMicError(t('mobile.microphonePermission'));
      toaster.create({
        title: `${t('error.failedStartVAD')}: ${error}`,
        type: 'error',
        duration: 2000,
      });
    }
  }, [disposeVAD, initVAD, refreshAudioInputDevices, t]);

  const stopMic = useCallback(() => {
    disposeVAD();
    setPreviousTriggeredProbability(0);
    setMicOn(false);
  }, [disposeVAD, setPreviousTriggeredProbability]);

  useEffect(() => {
    stopMicRef.current = stopMic;
    const releaseMicrophone = () => {
      if (document.hidden) stopMic();
    };
    document.addEventListener('visibilitychange', releaseMicrophone);
    return () => {
      document.removeEventListener('visibilitychange', releaseMicrophone);
      stopMic();
    };
  }, [stopMic]);

  const updateSettings = useCallback((newSettings: VADSettings) => {
    setSettings(newSettings);
    if (vadRef.current) {
      stopMic();
      window.setTimeout(() => { void startMic(); }, 100);
    }
  }, [startMic, stopMic]);

  const setSelectedAudioInputDeviceId = useCallback((deviceId: string) => {
    if (deviceId === selectedDeviceIdRef.current) return;
    selectedDeviceIdRef.current = deviceId;
    setSelectedAudioInputDeviceIdState(deviceId);
    if (vadRef.current) {
      stopMic();
      window.setTimeout(() => { void startMic(); }, 100);
    }
  }, [startMic, stopMic]);

  const setAutoStopMic = useCallback((value: boolean) => {
    autoStopMicRef.current = value;
    setAutoStopMicState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOn = useCallback((value: boolean) => {
    autoStartMicRef.current = value;
    setAutoStartMicOnState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOnConvEnd = useCallback((value: boolean) => {
    autoStartMicOnConvEndRef.current = value;
    setAutoStartMicOnConvEndState(value);
    forceUpdate();
  }, []);

  const contextValue = useMemo(
    () => ({
      autoStopMic: autoStopMicRef.current,
      micOn,
      micError,
      setMicOn,
      setAutoStopMic,
      startMic,
      stopMic,
      previousTriggeredProbability: previousTriggeredProbabilityRef.current,
      setPreviousTriggeredProbability,
      settings,
      updateSettings,
      autoStartMicOn: autoStartMicRef.current,
      setAutoStartMicOn,
      autoStartMicOnConvEnd: autoStartMicOnConvEndRef.current,
      setAutoStartMicOnConvEnd,
      audioInputDevices,
      selectedAudioInputDeviceId,
      setSelectedAudioInputDeviceId,
      refreshAudioInputDevices,
    }),
    [
      audioInputDevices,
      micOn,
      micError,
      refreshAudioInputDevices,
      selectedAudioInputDeviceId,
      setPreviousTriggeredProbability,
      setSelectedAudioInputDeviceId,
      settings,
      startMic,
      stopMic,
      updateSettings,
    ],
  );

  return <VADContext.Provider value={contextValue}>{children}</VADContext.Provider>;
}

export function useVAD() {
  const context = useContext(VADContext);
  if (!context) throw new Error('useVAD must be used within a VADProvider');
  return context;
}
