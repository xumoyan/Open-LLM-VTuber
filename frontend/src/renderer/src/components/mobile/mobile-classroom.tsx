import {
  Box, Button, Flex, IconButton, Text, Textarea,
} from '@chakra-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiMic, FiMicOff, FiSend, FiSettings, FiStopCircle } from 'react-icons/fi';
import { useAiState } from '@/context/ai-state-context';
import { useChatHistory } from '@/context/chat-history-context';
import { useConfig } from '@/context/character-config-context';
import { useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useVAD } from '@/context/vad-context';
import { useWebSocket } from '@/context/websocket-context';
import { useTextInput } from '@/hooks/footer/use-text-input';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useMicToggle } from '@/hooks/utils/use-mic-toggle';
import { MobileSettingsSheet } from './mobile-settings-sheet';

function statusText(wsState: string, aiState: string, t: (key: string) => string): string {
  if (wsState === 'CLOSED' || wsState === 'CLOSING') return t('mobile.disconnected');
  if (wsState === 'CONNECTING') return t('mobile.connecting');
  return t(`mobile.status.${aiState}`);
}

function StatusPill(): JSX.Element {
  const { t } = useTranslation();
  const { wsState, reconnect } = useWebSocket();
  const { aiState } = useAiState();
  const { confName } = useConfig();
  const offline = wsState === 'CLOSED' || wsState === 'CLOSING';

  return (
    <Button
      aria-label={offline ? t('mobile.reconnect') : t('mobile.classroomStatus')}
      flex="1"
      minW="0"
      minH="44px"
      px="3"
      borderRadius="full"
      bg="blackAlpha.600"
      color="white"
      fontSize="sm"
      fontWeight="medium"
      _hover={{ bg: 'blackAlpha.700' }}
      onClick={offline ? reconnect : undefined}
    >
      <Box
        boxSize="8px"
        borderRadius="full"
        bg={offline ? 'red.400' : wsState === 'CONNECTING' ? 'yellow.300' : 'green.300'}
        flexShrink={0}
      />
      <Text truncate ml="2">{statusText(wsState, aiState, t)}{confName ? ` · ${confName}` : ''}</Text>
    </Button>
  );
}

function ConversationOverlay(): JSX.Element {
  const { t } = useTranslation();
  const { messages } = useChatHistory();
  const { subtitleText, showSubtitle } = useSubtitle();
  const { aiState } = useAiState();
  const listRef = useRef<HTMLDivElement>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.type !== 'tool_call_status' && message.content?.trim()),
    [messages],
  );
  const latestText = visibleMessages.length
    ? visibleMessages[visibleMessages.length - 1].content?.trim()
    : '';
  const liveCaption = showSubtitle && subtitleText.trim() !== latestText ? subtitleText.trim() : '';

  useEffect(() => {
    if (!followLatest || !listRef.current) return;
    listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [followLatest, visibleMessages, liveCaption]);

  const handleScroll = () => {
    const element = listRef.current;
    if (!element) return;
    setFollowLatest(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
  };

  return (
    <Box
      position="absolute"
      zIndex={20}
      left="3"
      right="3"
      bottom="calc(84px + env(safe-area-inset-bottom))"
      maxH="34dvh"
      minH={visibleMessages.length || liveCaption ? 'auto' : '48px'}
      pointerEvents="auto"
    >
      <Box
        ref={listRef}
        maxH="34dvh"
        overflowY="auto"
        px="1"
        pb="2"
        onScroll={handleScroll}
        css={{
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 12%, black 100%)',
          maskImage: 'linear-gradient(to bottom, transparent, black 12%, black 100%)',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {!visibleMessages.length && !liveCaption && (
          <Text
            display="inline-block"
            bg="blackAlpha.600"
            borderRadius="full"
            color="whiteAlpha.900"
            fontSize="sm"
            px="3"
            py="2"
          >
            {t('mobile.emptyConversation')}
          </Text>
        )}

        {visibleMessages.map((message) => (
          <Flex
            key={message.id}
            justify={message.role === 'human' ? 'flex-end' : 'flex-start'}
            mt="2"
          >
            <Box
              maxW="82%"
              bg={message.role === 'human' ? 'purple.600/85' : 'blackAlpha.600'}
              borderRadius="xl"
              borderBottomRightRadius={message.role === 'human' ? 'sm' : 'xl'}
              borderBottomLeftRadius={message.role === 'human' ? 'xl' : 'sm'}
              boxShadow="0 2px 12px rgba(0,0,0,0.18)"
              color="white"
              fontSize="md"
              lineHeight="1.45"
              px="3"
              py="2"
              backdropFilter="blur(10px)"
            >
              {message.content}
            </Box>
          </Flex>
        ))}

        {liveCaption && (
          <Flex mt="2" justify="flex-start">
            <Box
              maxW="82%"
              bg="blackAlpha.700"
              borderRadius="xl"
              color="whiteAlpha.900"
              fontSize="sm"
              fontStyle="italic"
              lineHeight="1.4"
              px="3"
              py="2"
            >
              {aiState === 'listening' ? t('mobile.listeningPrefix') : t('mobile.speakingPrefix')}{liveCaption}
            </Box>
          </Flex>
        )}
      </Box>

      {!followLatest && (visibleMessages.length > 0 || liveCaption) && (
        <Button
          size="sm"
          borderRadius="full"
          bg="blackAlpha.700"
          color="white"
          mt="2"
          onClick={() => {
            setFollowLatest(true);
            listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          {t('mobile.backToLatest')}
        </Button>
      )}
    </Box>
  );
}

function ClassroomComposer(): JSX.Element {
  const { t } = useTranslation();
  const { wsState } = useWebSocket();
  const { aiState, setAiState } = useAiState();
  const { micError, allowInterrupt } = useVAD();
  const { inputText, setInputText, handleSend, handleKeyPress, handleCompositionStart, handleCompositionEnd } = useTextInput();
  const { handleMicToggle, micOn } = useMicToggle();
  const { interrupt } = useInterrupt();
  const ready = wsState === 'OPEN' && aiState !== 'loading';
  const hasText = Boolean(inputText.trim());
  const answering = aiState === 'thinking-speaking';
  const answerLocked = answering && !allowInterrupt;

  return (
    <Box
      position="absolute"
      zIndex={30}
      bottom="0"
      left="0"
      right="0"
      px="3"
      pt="2"
      pb="calc(8px + env(safe-area-inset-bottom))"
      pointerEvents="auto"
      bg="linear-gradient(transparent, rgba(9, 11, 16, 0.92) 24%)"
    >
      {micError && (
        <Box bg="red.900/90" borderRadius="lg" color="white" fontSize="sm" mb="2" px="3" py="2">
          {micError}
        </Box>
      )}
      <Flex gap="2" align="flex-end">
        <Textarea
          aria-label={t('mobile.messageInput')}
          flex="1"
          minW="0"
          value={inputText}
          onChange={(event) => {
            setInputText(event);
            if (event.target.value) setAiState('waiting');
          }}
          onKeyDown={handleKeyPress}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={t('mobile.messagePlaceholder')}
          minH="48px"
          maxH="88px"
          resize="none"
          disabled={!ready || answerLocked}
          bg="blackAlpha.700"
          borderColor="whiteAlpha.300"
          borderRadius="2xl"
          color="white"
          fontSize="md"
          lineHeight="1.4"
          px="4"
          py="3"
          _placeholder={{ color: 'whiteAlpha.600' }}
          _focus={{ borderColor: 'purple.300', boxShadow: '0 0 0 1px var(--chakra-colors-purple-300)' }}
        />

        {hasText && (
          <IconButton
            aria-label={t('mobile.send')}
            minW="48px"
            h="48px"
            borderRadius="full"
            colorPalette="purple"
            disabled={!ready || answerLocked}
            onClick={() => void handleSend()}
          >
            <FiSend />
          </IconButton>
        )}

        {answering && allowInterrupt && (
          <IconButton
            aria-label={t('mobile.stopAnswer')}
            minW="48px"
            h="48px"
            borderRadius="full"
            bg="orange.500"
            color="white"
            onClick={() => interrupt()}
          >
            <FiStopCircle />
          </IconButton>
        )}

        <IconButton
          aria-label={micOn ? t('mobile.stopListening') : t('mobile.startListening')}
          minW="56px"
          h="56px"
          borderRadius="full"
          bg={micOn ? 'red.500' : 'purple.500'}
          color="white"
          disabled={!ready || (answerLocked && !micOn)}
          className={micOn ? 'mobile-mic-pulse' : undefined}
          onClick={() => void handleMicToggle()}
        >
          {micOn ? <FiMicOff size="22" /> : <FiMic size="24" />}
        </IconButton>
      </Flex>
    </Box>
  );
}

export function MobileClassroom(): JSX.Element {
  const { t } = useTranslation();
  const { modelInfo } = useLive2DConfig();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <Box
      className="mobile-classroom"
      position="absolute"
      inset="0"
      zIndex={10}
      color="white"
      fontFamily="'Hiragino Sans GB W3', 'HiraginoSansGB-W3', 'STHeitiSC-Light', 'STHeiti Light', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
      pointerEvents="none"
    >
      <Flex
        position="absolute"
        top="env(safe-area-inset-top)"
        left="3"
        right="2"
        zIndex={10}
        align="center"
        justify="space-between"
        pointerEvents="auto"
      >
        <StatusPill />
        <IconButton
          aria-label={t('mobile.openSettings')}
          minW="48px"
          h="48px"
          borderRadius="full"
          bg="blackAlpha.600"
          color="white"
          _hover={{ bg: 'blackAlpha.700' }}
          onClick={() => setSettingsOpen(true)}
        >
          <FiSettings size="22" />
        </IconButton>
      </Flex>

      {!modelInfo?.url && (
        <Flex
          position="absolute"
          zIndex={5}
          top="25%"
          left="50%"
          transform="translateX(-50%)"
          align="center"
          justify="center"
          bg="blackAlpha.500"
          borderRadius="full"
          color="whiteAlpha.900"
          px="4"
          py="2"
          pointerEvents="none"
          aria-live="polite"
        >
          {t('mobile.teacherLoading')}
        </Flex>
      )}

      <ConversationOverlay />
      <ClassroomComposer />
      <MobileSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Box>
  );
}
