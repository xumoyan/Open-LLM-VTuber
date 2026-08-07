import {
  Box, Button, DrawerBody, DrawerFooter, DrawerHeader, DrawerRoot, DrawerTitle, Flex, Text,
} from '@chakra-ui/react';
import {
  ReactNode, useEffect, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiBookOpen, FiCheck, FiMessageCircle, FiMic, FiRefreshCw, FiUsers, FiWifi, FiWifiOff, FiZap,
} from 'react-icons/fi';
import { useConfig } from '@/context/character-config-context';
import { useSidebar } from '@/hooks/sidebar/use-sidebar';
import { useSwitchCharacter } from '@/hooks/utils/use-switch-character';
import { useSubtitle } from '@/context/subtitle-context';
import { useVAD } from '@/context/vad-context';
import { useWebSocket } from '@/context/websocket-context';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { recordVoiceSample } from '@/utils/voiceprint-recorder';
import {
  DrawerBackdrop, DrawerCloseTrigger, DrawerContent,
} from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';

const VOICE_SAMPLE_SECONDS = 8;

interface MobileSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSettingsSheet({ open, onClose }: MobileSettingsSheetProps): JSX.Element {
  const { t } = useTranslation();
  const { configFiles, confName } = useConfig();
  const { switchCharacter } = useSwitchCharacter();
  const { createNewHistory } = useSidebar();
  const { showSubtitle, setShowSubtitle } = useSubtitle();
  const { allowInterrupt, setAllowInterrupt } = useVAD();
  const { wsState, reconnect } = useWebSocket();
  const [confirmNewLesson, setConfirmNewLesson] = useState(false);

  const startNewLesson = () => {
    if (!confirmNewLesson) {
      setConfirmNewLesson(true);
      return;
    }
    createNewHistory();
    setConfirmNewLesson(false);
    onClose();
  };

  const connected = wsState === 'OPEN';

  return (
    <DrawerRoot open={open} onOpenChange={(details) => !details.open && onClose()} placement="bottom">
      <DrawerBackdrop bg="blackAlpha.700" />
      <DrawerContent
        className="mobile-settings-sheet"
        bg="#14161c"
        color="white"
        fontFamily="'Hiragino Sans GB W3', 'HiraginoSansGB-W3', 'STHeitiSC-Light', 'STHeiti Light', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
        borderTopRadius="2xl"
        maxH="min(82dvh, 660px)"
        pb="env(safe-area-inset-bottom)"
      >
        <Flex justify="center" pt="2.5" pb="1">
          <Box w="36px" h="4px" borderRadius="full" bg="whiteAlpha.300" />
        </Flex>

        <DrawerHeader pt="1" pb="3" borderBottomWidth="1px" borderColor="whiteAlpha.100">
          <DrawerTitle fontSize="lg" fontWeight="bold">{t('mobile.settingsTitle')}</DrawerTitle>
          <DrawerCloseTrigger aria-label={t('mobile.closeSettings')} color="whiteAlpha.700" />
        </DrawerHeader>

        <DrawerBody overflowY="auto" py="5">
          <SectionLabel icon={<FiUsers size={14} />}>{t('mobile.chooseTeacher')}</SectionLabel>
          <Flex direction="column" gap="2" mb="6">
            {configFiles.map((config) => {
              const selected = config.name === confName;
              return (
                <Button
                  key={config.filename}
                  variant="plain"
                  aria-pressed={selected}
                  justifyContent="flex-start"
                  gap="3"
                  minH="56px"
                  px="3"
                  borderRadius="xl"
                  bg={selected ? 'purple.600' : 'whiteAlpha.50'}
                  border="1px solid"
                  borderColor={selected ? 'purple.400' : 'whiteAlpha.100'}
                  boxShadow={selected ? '0 4px 14px rgba(124, 58, 237, 0.35)' : 'none'}
                  transition="background 0.15s ease, border-color 0.15s ease"
                  _active={{ bg: selected ? 'purple.700' : 'whiteAlpha.100' }}
                  onClick={() => {
                    switchCharacter(config.filename);
                    onClose();
                  }}
                >
                  <Flex
                    boxSize="36px"
                    flexShrink={0}
                    borderRadius="full"
                    align="center"
                    justify="center"
                    fontSize="sm"
                    fontWeight="bold"
                    bg={selected ? 'whiteAlpha.300' : 'whiteAlpha.200'}
                    color="white"
                  >
                    {config.name.trim().charAt(0).toUpperCase()}
                  </Flex>
                  <Text flex="1" truncate fontWeight="medium" color="white">
                    {config.name}
                  </Text>
                  {selected && (
                    <Flex
                      boxSize="24px"
                      flexShrink={0}
                      borderRadius="full"
                      bg="whiteAlpha.300"
                      align="center"
                      justify="center"
                      color="white"
                    >
                      <FiCheck size={14} />
                    </Flex>
                  )}
                </Button>
              );
            })}
            {!configFiles.length && (
              <Text color="whiteAlpha.600" fontSize="sm">{t('mobile.teacherLoading')}</Text>
            )}
          </Flex>

          <SectionLabel icon={<FiZap size={14} />}>{t('mobile.preferences')}</SectionLabel>
          <Box bg="whiteAlpha.50" border="1px solid" borderColor="whiteAlpha.100" borderRadius="xl" mb="6" overflow="hidden">
            <Flex align="center" gap="3" px="4" py="4">
              <Box color="purple.300" flexShrink={0}><FiMessageCircle size={18} /></Box>
              <Box flex="1" minW="0">
                <Text fontWeight="medium">{t('mobile.showLiveCaption')}</Text>
                <Text color="whiteAlpha.600" fontSize="xs" mt="0.5">{t('mobile.showLiveCaptionHelp')}</Text>
              </Box>
              <Switch
                aria-label={t('mobile.showLiveCaption')}
                checked={showSubtitle}
                colorPalette="purple"
                onCheckedChange={(details) => setShowSubtitle(details.checked)}
              />
            </Flex>
            <Box borderTopWidth="1px" borderColor="whiteAlpha.100" />
            <Flex align="center" gap="3" px="4" py="4">
              <Box color="purple.300" flexShrink={0}><FiZap size={18} /></Box>
              <Box flex="1" minW="0">
                <Text fontWeight="medium">{t('mobile.allowTeacherInterrupt')}</Text>
                <Text color="whiteAlpha.600" fontSize="xs" mt="0.5">{t('mobile.allowTeacherInterruptHelp')}</Text>
              </Box>
              <Switch
                aria-label={t('mobile.allowTeacherInterrupt')}
                checked={allowInterrupt}
                colorPalette="purple"
                onCheckedChange={(details) => setAllowInterrupt(details.checked)}
              />
            </Flex>
          </Box>

          <VoiceLockSection />

          <SectionLabel icon={<FiWifi size={14} />}>{t('mobile.connection')}</SectionLabel>
          <Flex
            align="center"
            gap="3"
            mb="6"
            px="4"
            py="4"
            bg="whiteAlpha.50"
            border="1px solid"
            borderColor="whiteAlpha.100"
            borderRadius="xl"
          >
            <Box color={connected ? 'green.300' : 'orange.300'} flexShrink={0}>
              {connected ? <FiWifi size={18} /> : <FiWifiOff size={18} />}
            </Box>
            <Box flex="1" minW="0">
              <Text fontWeight="medium">{t('mobile.connection')}</Text>
              <Text color={connected ? 'green.300' : 'orange.300'} fontSize="xs" mt="0.5">
                {connected ? t('mobile.connected') : t('mobile.connectionUnavailable')}
              </Text>
            </Box>
            <Button
              size="sm"
              minH="40px"
              borderRadius="full"
              variant="outline"
              borderColor="whiteAlpha.300"
              color="white"
              _hover={{ bg: 'whiteAlpha.100' }}
              onClick={reconnect}
              loading={wsState === 'CONNECTING'}
            >
              <FiRefreshCw />
              {t('mobile.reconnect')}
            </Button>
          </Flex>

          <SectionLabel icon={<FiBookOpen size={14} />}>{t('mobile.lesson')}</SectionLabel>
          <Button
            colorPalette={confirmNewLesson ? 'red' : 'purple'}
            minH="52px"
            width="full"
            borderRadius="xl"
            fontWeight="semibold"
            onClick={startNewLesson}
          >
            {confirmNewLesson ? t('mobile.confirmNewLesson') : t('mobile.newLesson')}
          </Button>
        </DrawerBody>

        <DrawerFooter borderTopWidth="1px" borderColor="whiteAlpha.100" justifyContent="center">
          <Text color="whiteAlpha.500" fontSize="xs">AI 外教</Text>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}

function VoiceLockSection(): JSX.Element {
  const { t } = useTranslation();
  const { baseUrl } = useWebSocket();
  const [deviceId, setDeviceId] = useLocalStorage('voiceprintDeviceId', '');
  const [voiceprintUrl, setVoiceprintUrl] = useLocalStorage('voiceprintUrl', '');
  const [status, setStatus] = useState<'idle' | 'recording' | 'uploading' | 'error'>('idle');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!deviceId) setDeviceId(crypto.randomUUID());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    if (!deviceId || status === 'recording' || status === 'uploading') return;
    setStatus('recording');
    setElapsed(0);
    try {
      const blob = await recordVoiceSample(VOICE_SAMPLE_SECONDS, setElapsed);
      setStatus('uploading');
      const formData = new FormData();
      formData.append('file', blob, 'voiceprint.wav');
      const response = await fetch(`${baseUrl}/voiceprint/${deviceId}`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error(`upload failed: ${response.status}`);
      const data = await response.json();
      setVoiceprintUrl(data.url);
      setStatus('idle');
    } catch (error) {
      console.error('[VoiceLock] recording/upload failed', error);
      setStatus('error');
    }
  };

  const label = (() => {
    if (status === 'recording') {
      return t('mobile.voiceLockRecording', {
        elapsed: Math.min(VOICE_SAMPLE_SECONDS, Math.ceil(elapsed)),
        total: VOICE_SAMPLE_SECONDS,
      });
    }
    if (status === 'uploading') return t('mobile.voiceLockUploading');
    return voiceprintUrl ? t('mobile.voiceLockReRecord') : t('mobile.voiceLockRecord');
  })();

  return (
    <>
      <SectionLabel icon={<FiMic size={14} />}>{t('mobile.voiceLock')}</SectionLabel>
      <Box bg="whiteAlpha.50" border="1px solid" borderColor="whiteAlpha.100" borderRadius="xl" mb="6" px="4" py="4">
        <Text color="whiteAlpha.600" fontSize="xs" mb="3">{t('mobile.voiceLockHelp')}</Text>
        <Button
          width="full"
          minH="48px"
          borderRadius="xl"
          fontWeight="medium"
          colorPalette={voiceprintUrl ? 'gray' : 'purple'}
          variant={voiceprintUrl ? 'outline' : 'solid'}
          borderColor={voiceprintUrl ? 'whiteAlpha.300' : undefined}
          color={voiceprintUrl ? 'white' : undefined}
          loading={status === 'recording' || status === 'uploading'}
          disabled={status === 'recording' || status === 'uploading'}
          onClick={() => void startRecording()}
        >
          <FiMic />
          {label}
        </Button>
        {status === 'error' && (
          <Text color="red.300" fontSize="xs" mt="2">{t('mobile.voiceLockError')}</Text>
        )}
      </Box>
    </>
  );
}

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <Flex align="center" gap="1.5" color="whiteAlpha.600" fontSize="xs" fontWeight="semibold" letterSpacing="wide" textTransform="uppercase" mb="2.5">
      {icon}
      <Text>{children}</Text>
    </Flex>
  );
}
