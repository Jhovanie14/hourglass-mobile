"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  IDLE_STATE,
  isPanelCommand,
  PANEL_SOURCE,
  type PanelEvent,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { usePhone } from "@/components/calls/hooks/use-phone"
import { useRingtone } from "@/components/calls/hooks/use-ringtone"
import type { PhoneNumber } from "@/types/calls"

function post(event: PanelEvent) {
  // targetOrigin "*" is safe: payloads carry no secrets and the extension
  // shell validates event.origin before acting.
  window.parent.postMessage(event, "*")
}

/**
 * Headless phone for the extension's offscreen document. Owns THE WebRTC
 * connection (one-phone rule), plays ring + ringback audio, mirrors state to
 * the extension via postMessage, and executes remote commands.
 */
export function BackgroundPhone({ phoneNumbers }: { phoneNumbers: PhoneNumber[] }) {
  const phone = usePhone()
  const { start: startRingback, stop: stopRingback } = useRingtone("ringback")
  const [micBlocked, setMicBlocked] = useState(false)

  // ── Mic gate: probe on mount, and again on request-state ──────────────────
  const probeMic = useCallback(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop())
        setMicBlocked(false)
      })
      .catch(() => {
        setMicBlocked(true)
        post({ source: PANEL_SOURCE, type: "mic-blocked" })
      })
  }, [])

  useEffect(() => {
    probeMic()
  }, [probeMic])

  // ── Outbound ringback while dialing ───────────────────────────────────────
  const dialing =
    phone.direction === "outbound" &&
    (phone.callState === "trying" ||
      phone.callState === "requesting" ||
      phone.callState === "ringing" ||
      phone.callState === "early")
  useEffect(() => {
    if (dialing) startRingback()
    else stopRingback()
  }, [dialing, startRingback, stopRingback])

  // ── State sync to the extension ───────────────────────────────────────────
  const status: SerializedCallState["status"] = phone.incomingCall
    ? "incoming"
    : phone.activeCall
      ? phone.callState === "active"
        ? "active"
        : phone.callState === "ringing"
          ? "ringing"
          : "trying"
      : "idle"

  const state: SerializedCallState = {
    ...IDLE_STATE,
    status,
    direction: phone.direction,
    callerNumber: phone.incomingCall ? phone.callerNumber : null,
    companyLabel: phone.inboundPhoneNumber?.label ?? null,
    companyNumber: phone.inboundPhoneNumber?.phone_number ?? null,
    remoteNumber: phone.activeCall ? phone.activeNumber : null,
    muted: phone.muted,
    startedAt: phone.startedAtRef.current,
    isReady: phone.isReady,
    online: phone.online,
    signedIn: true,
    micBlocked,
  }
  const stateRef = useRef(state)
  stateRef.current = state
  const stateJson = JSON.stringify(state)
  useEffect(() => {
    post({ source: PANEL_SOURCE, type: "state-sync", state: JSON.parse(stateJson) })
  }, [stateJson])

  // ── Discrete events (v1-compatible) ───────────────────────────────────────
  useEffect(() => {
    if (phone.incomingCall && !phone.activeCall) {
      post({
        source: PANEL_SOURCE,
        type: "incoming",
        caller: phone.callerNumber,
        label: phone.inboundPhoneNumber?.label ?? null,
      })
    }
  }, [phone.incomingCall, phone.activeCall, phone.callerNumber, phone.inboundPhoneNumber])

  const everActiveRef = useRef(false)
  useEffect(() => {
    if (phone.activeCall) {
      everActiveRef.current = true
      post({ source: PANEL_SOURCE, type: "call-active" })
    } else if (everActiveRef.current) {
      everActiveRef.current = false
      post({ source: PANEL_SOURCE, type: "call-ended" })
    }
  }, [phone.activeCall])

  // ── Command execution ─────────────────────────────────────────────────────
  const phoneRef = useRef(phone)
  phoneRef.current = phone
  const phoneNumbersRef = useRef(phoneNumbers)
  phoneNumbersRef.current = phoneNumbers

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Trust boundary: commands/events only ever arrive from the extension
      // shells (frame-ancestors pins who can embed us; shape guards below).
      if (event.origin && !event.origin.startsWith("chrome-extension://")) return
      const msg = event.data
      if (!isPanelCommand(msg)) return
      const p = phoneRef.current
      switch (msg.cmd) {
        case "dial": {
          if (p.activeCall || p.incomingCall) break
          const pn = phoneNumbersRef.current.find(
            (n) => n.phone_number === msg.callerId
          )
          if (pn) p.makeCall(msg.to, pn)
          break
        }
        case "answer":
          p.handleAnswer()
          break
        case "decline":
          p.handleReject()
          break
        case "hangup":
          p.handleHangup()
          break
        case "mute":
          if (!p.muted) p.toggleMute()
          break
        case "unmute":
          if (p.muted) p.toggleMute()
          break
        case "dtmf":
          p.handleDtmf(msg.digit)
          break
        case "speak":
          p.setSpeakText(msg.text)
          // handleSpeak reads speakText from state; defer one tick so the
          // setState above lands first.
          setTimeout(() => phoneRef.current.handleSpeak(), 0)
          break
        case "set-online":
          p.setOnline(msg.online)
          break
        case "request-state":
          probeMic()
          post({ source: PANEL_SOURCE, type: "state-sync", state: stateRef.current })
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [probeMic])

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={phone.remoteAudioRef} autoPlay hidden />
    </>
  )
}
