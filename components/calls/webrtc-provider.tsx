// components/calls/webrtc-provider.tsx
"use client"

import { createContext, useContext } from "react"
import { usePhone } from "./hooks/use-phone"
import { IncomingCallPopup } from "./ui/incoming-call-popup"
import { ActiveCallHud } from "./ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"

type WebRTCContextType = {
  isReady: boolean
  makeCall: (to: string, phoneNumber: PhoneNumber) => Promise<void>
  online: boolean
  setOnline: (next: boolean) => void
}

const WebRTCContext = createContext<WebRTCContextType>({
  isReady: false,
  makeCall: async () => {},
  online: true,
  setOnline: () => {},
})

export function useWebRTC() {
  return useContext(WebRTCContext)
}

/**
 * Local phone with UI: mounts the headless usePhone hook and renders the
 * incoming popup + active-call HUD. Used by the dashboard and by /panel when
 * opened as a normal tab. The extension uses BackgroundPhone/RemotePhone
 * instead (one-phone rule).
 */
export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const phone = usePhone()

  return (
    <WebRTCContext.Provider
      value={{
        isReady: phone.isReady,
        makeCall: phone.makeCall,
        online: phone.online,
        setOnline: phone.setOnline,
      }}
    >
      {children}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={phone.remoteAudioRef} autoPlay hidden />

      {phone.incomingCall && !phone.activeCall && (
        <IncomingCallPopup
          callerNumber={phone.callerNumber}
          companyLabel={phone.inboundPhoneNumber?.label ?? null}
          companyNumber={phone.inboundPhoneNumber?.phone_number ?? null}
          busy={phone.actionBusy}
          onAnswer={phone.handleAnswer}
          onReject={phone.handleReject}
        />
      )}

      {phone.activeCall && (
        <ActiveCallHud
          callState={phone.callState}
          duration={phone.duration}
          remoteNumber={phone.activeNumber}
          muted={phone.muted}
          speakText={phone.speakText}
          speaking={phone.speaking}
          onHangup={phone.handleHangup}
          onToggleMute={phone.toggleMute}
          onSpeakTextChange={phone.setSpeakText}
          onSpeak={phone.handleSpeak}
          onDtmf={phone.handleDtmf}
        />
      )}
    </WebRTCContext.Provider>
  )
}
