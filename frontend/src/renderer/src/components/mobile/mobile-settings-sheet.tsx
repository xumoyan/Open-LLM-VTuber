import {
  Box, Button, DrawerBody, DrawerFooter, DrawerHeader, DrawerRoot, DrawerTitle, Flex, Text,
} from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiRefreshCw } from 'react-icons/fi';
import { useConfig } from '@/context/character-config-context';
import { useSidebar } from '@/hooks/sidebar/use-sidebar';
import { useSwitchCharacter } from '@/hooks/utils/use-switch-character';
import { useSubtitle } from '@/context/subtitle-context';
import { useVAD } from '@/context/vad-context';
import { useWebSocket } from '@/context/websocket-context';
import {
  DrawerBackdrop, DrawerCloseTrigger, DrawerContent,
} from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';

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

  return (
    <DrawerRoot open={open} onOpenChange={(details) => !details.open && onClose()} placement="bottom">
      <DrawerBackdrop bg="blackAlpha.700" />
      <DrawerContent
        className="mobile-settings-sheet"
        bg="gray.900"
        color="white"
        fontFamily="'Hiragino Sans GB W3', 'HiraginoSansGB-W3', 'STHeitiSC-Light', 'STHeiti Light', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
        borderTopRadius="2xl"
        maxH="min(78dvh, 620px)"
        pb="env(safe-area-inset-bottom)"
      >
        <DrawerHeader borderBottomWidth="1px" borderColor="whiteAlpha.200">
          <DrawerTitle fontSize="lg">{t('mobile.settingsTitle')}</DrawerTitle>
          <DrawerCloseTrigger aria-label={t('mobile.closeSettings')} color="white" />
        </DrawerHeader>

        <DrawerBody overflowY="auto" py="4">
          <Text color="whiteAlpha.700" fontSize="sm" mb="2">
            {t('mobile.chooseTeacher')}
          </Text>
          <Flex direction="column" gap="2">
            {configFiles.map((config) => (
              <Button
                key={config.filename}
                justifyContent="flex-start"
                minH="48px"
                variant={config.name === confName ? 'solid' : 'outline'}
                colorPalette={config.name === confName ? 'purple' : 'gray'}
                onClick={() => {
                  switchCharacter(config.filename);
                  onClose();
                }}
              >
                {config.name}
              </Button>
            ))}
            {!configFiles.length && (
              <Text color="whiteAlpha.600" fontSize="sm">{t('mobile.teacherLoading')}</Text>
            )}
          </Flex>

          <Flex align="center" justify="space-between" minH="56px" mt="5">
            <Box>
              <Text fontWeight="medium">{t('mobile.showLiveCaption')}</Text>
              <Text color="whiteAlpha.600" fontSize="sm">{t('mobile.showLiveCaptionHelp')}</Text>
            </Box>
            <Switch
              aria-label={t('mobile.showLiveCaption')}
              checked={showSubtitle}
              colorPalette="purple"
              onCheckedChange={(details) => setShowSubtitle(details.checked)}
            />
          </Flex>

          <Flex align="center" justify="space-between" minH="56px" mt="5" gap="3">
            <Box>
              <Text fontWeight="medium">{t('mobile.allowTeacherInterrupt')}</Text>
              <Text color="whiteAlpha.600" fontSize="sm">{t('mobile.allowTeacherInterruptHelp')}</Text>
            </Box>
            <Switch
              aria-label={t('mobile.allowTeacherInterrupt')}
              checked={allowInterrupt}
              colorPalette="purple"
              onCheckedChange={(details) => setAllowInterrupt(details.checked)}
            />
          </Flex>

          <Flex align="center" justify="space-between" mt="5" gap="3">
            <Box>
              <Text fontWeight="medium">{t('mobile.connection')}</Text>
              <Text color={wsState === 'OPEN' ? 'green.300' : 'orange.300'} fontSize="sm">
                {wsState === 'OPEN' ? t('mobile.connected') : t('mobile.connectionUnavailable')}
              </Text>
            </Box>
            <Button
              minH="48px"
              variant="outline"
              onClick={reconnect}
              loading={wsState === 'CONNECTING'}
            >
              <FiRefreshCw />
              {t('mobile.reconnect')}
            </Button>
          </Flex>

          <Box borderTopWidth="1px" borderColor="whiteAlpha.200" mt="5" pt="5">
            <Text color="whiteAlpha.700" fontSize="sm" mb="2">{t('mobile.lesson')}</Text>
            <Button
              colorPalette={confirmNewLesson ? 'red' : 'purple'}
              minH="48px"
              width="full"
              onClick={startNewLesson}
            >
              {confirmNewLesson ? t('mobile.confirmNewLesson') : t('mobile.newLesson')}
            </Button>
          </Box>
        </DrawerBody>

        <DrawerFooter borderTopWidth="1px" borderColor="whiteAlpha.200">
          <Text color="whiteAlpha.600" fontSize="xs">AI 外教</Text>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}
