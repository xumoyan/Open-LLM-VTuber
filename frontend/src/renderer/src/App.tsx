/* eslint-disable no-shadow */
// import { StrictMode } from 'react';
import { Box, Flex, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useState, useRef } from "react";
// import Canvas from './components/canvas/canvas'; // Likely unused now
import Sidebar from "./components/sidebar/sidebar";
import Footer from "./components/footer/footer";
import { AiStateProvider } from "./context/ai-state-context";
import { Live2DConfigProvider } from "./context/live2d-config-context";
import { SubtitleProvider } from "./context/subtitle-context";
import { BgUrlProvider } from "./context/bgurl-context";
import { layoutStyles } from "./layout";
import WebSocketHandler from "./services/websocket-handler";
import { CameraProvider } from "./context/camera-context";
import { ChatHistoryProvider } from "./context/chat-history-context";
import { CharacterConfigProvider } from "./context/character-config-context";
import { Toaster } from "./components/ui/toaster";
import { VADProvider } from "./context/vad-context";
import { Live2D } from "./components/canvas/live2d";
import { DhLiveAvatar } from "./components/canvas/dh-live-avatar";
import { useConfig } from "./context/character-config-context";
import TitleBar from "./components/electron/title-bar";
import { InputSubtitle } from "./components/electron/input-subtitle";
import { ProactiveSpeakProvider } from "./context/proactive-speak-context";
import { ScreenCaptureProvider } from "./context/screen-capture-context";
import { GroupProvider } from "./context/group-context";
import { BrowserProvider } from "./context/browser-context";
// eslint-disable-next-line import/no-extraneous-dependencies, import/newline-after-import
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Background from "./components/canvas/background";
import WebSocketStatus from "./components/canvas/ws-status";
import Subtitle from "./components/canvas/subtitle";
import { ModeProvider, useMode } from "./context/mode-context";
import { MobileClassroom } from "./components/mobile/mobile-classroom";

const isMobileApp = import.meta.env.VITE_MOBILE_APP === '1';

function AppContent(): JSX.Element {
  const [showSidebar, setShowSidebar] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  );
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);
  const { mode } = useMode();
  const isElectron = window.api !== undefined;
  const live2dContainerRef = useRef<HTMLDivElement>(null);
  const { avatarRenderer } = useConfig();
  const isDhLive = avatarRenderer.mode === 'dh_live';

  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';
  document.documentElement.style.position = 'fixed';
  document.body.style.position = 'fixed';
  document.documentElement.style.width = '100%';
  document.body.style.width = '100%';

  // Define base style properties shared across modes/breakpoints
  const live2dBaseStyle = {
    position: "absolute" as const,
    overflow: "hidden",
    transition: "all 0.3s ease-in-out", // Optional transition
    pointerEvents: "auto" as const,
  };

  // Define styles specifically for the "window" mode, using responsive syntax
  const getResponsiveLive2DWindowStyle = (sidebarVisible: boolean) => ({
    ...live2dBaseStyle,
    top: isElectron ? "30px" : "0px",
    height: `calc(100% - ${isElectron ? "30px" : "0px"})`,
    zIndex: 5, // Ensure it's layered correctly below UI but above background
    left: {
      base: "0px", // Column layout (base): Start from left edge
      md: sidebarVisible ? "440px" : "24px", // Row layout (md+): Offset by sidebar width
    },
    width: {
      base: "100%", // Column layout (base): Full width
      md: `calc(100% - ${sidebarVisible ? "440px" : "24px"})`, // Row layout (md+): Adjust width based on sidebar
    },
  });

  // Define styles specifically for the "pet" mode
  const live2dPetStyle = {
    ...live2dBaseStyle,
    top: 0, // Override position for pet mode
    left: 0,
    width: "100vw", // Full viewport
    height: "100vh",
    zIndex: 15, // Higher zIndex for pet mode overlay
  };

  if (isMobileApp) {
    return (
      <Box position="fixed" inset="0" width="100vw" height="100dvh" overflow="hidden" bg="gray.900">
        <Box position="absolute" inset="0" zIndex={0}>
          <Background />
        </Box>
        <Box position="absolute" inset="0" zIndex={1}>
          {isDhLive
            ? <DhLiveAvatar assetId={avatarRenderer.assetId} />
            : <Live2D showSidebar={false} />}
        </Box>
        <MobileClassroom />
      </Box>
    );
  }

  return (
    <>
      <Box
        ref={live2dContainerRef}
        // Apply styles conditionally based on mode
        // Use the function to get dynamic responsive styles for window mode
        {...(mode === "window"
          ? getResponsiveLive2DWindowStyle(showSidebar)
          : live2dPetStyle)}
      >
        {isDhLive
          ? <DhLiveAvatar assetId={avatarRenderer.assetId} />
          : <Live2D />}
      </Box>

      {/* Conditional Rendering of Window UI */}
      {mode === "window" && (
        <>
          {isElectron && <TitleBar />}
          {/* Apply styles by spreading */}
          <Flex {...layoutStyles.appContainer}>
            <Box
              {...layoutStyles.sidebar}
              {...(!showSidebar && { width: { base: "44px", md: "24px" } })}
            >
              <Sidebar
                isCollapsed={!showSidebar}
                onToggle={() => setShowSidebar(!showSidebar)}
              />
            </Box>
            <Box {...layoutStyles.mainContent}>
              <Background />
              <Box
                position="absolute"
                top="calc(20px + env(safe-area-inset-top))"
                left="20px"
                zIndex={10}
              >
                <WebSocketStatus />
              </Box>
              <Box
                position="absolute"
                bottom={isFooterCollapsed
                  ? "calc(39px + env(safe-area-inset-bottom))"
                  : "calc(135px + env(safe-area-inset-bottom))"}
                left="50%"
                transform="translateX(-50%)"
                zIndex={10}
                width="60%"
              >
                <Subtitle />
              </Box>
              <Box
                {...layoutStyles.footer}
                zIndex={10}
                paddingBottom="env(safe-area-inset-bottom)"
                {...(isFooterCollapsed && layoutStyles.collapsedFooter)}
              >
                <Footer
                  isCollapsed={isFooterCollapsed}
                  onToggle={() => setIsFooterCollapsed(!isFooterCollapsed)}
                />
              </Box>
            </Box>
          </Flex>
        </>
      )}

      {/* Conditional Rendering of Pet Mode UI */}
      {mode === "pet" && <InputSubtitle />}
    </>
  );
}

function App(): JSX.Element {
  return (
    <ChakraProvider value={defaultSystem}>
      {/* ModeProvider needs to wrap AppContent to provide mode to getGlobalStyles */}
      <ModeProvider>
        <AppWithGlobalStyles />
      </ModeProvider>
    </ChakraProvider>
  );
}

// New component to access mode for global styles
function AppWithGlobalStyles(): JSX.Element {
  return (
    <>
      <CameraProvider>
        <ScreenCaptureProvider>
          <CharacterConfigProvider>
            <ChatHistoryProvider>
              <AiStateProvider>
                <ProactiveSpeakProvider>
                  <Live2DConfigProvider>
                    <SubtitleProvider>
                      <VADProvider>
                        <BgUrlProvider>
                          <GroupProvider>
                            <BrowserProvider>
                              <WebSocketHandler>
                                <Toaster />
                                <AppContent />
                              </WebSocketHandler>
                            </BrowserProvider>
                          </GroupProvider>
                        </BgUrlProvider>
                      </VADProvider>
                    </SubtitleProvider>
                  </Live2DConfigProvider>
                </ProactiveSpeakProvider>
              </AiStateProvider>
            </ChatHistoryProvider>
          </CharacterConfigProvider>
        </ScreenCaptureProvider>
      </CameraProvider>
    </>
  );
}

export default App;
