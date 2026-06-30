"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import * as React from "react"
import PhoneInput from "react-phone-number-input"
import "react-phone-number-input/style.css"
import { isValidE164 } from "@/lib/phone"
import {
  getOrCreateConversation,
  sendMessage,
} from "@/app/dashboard/conversations/actions"
import type { PhoneNumber } from "@/types/conversations"

const PhoneTextInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>((props, ref) => <Input {...props} ref={ref} />)
PhoneTextInput.displayName = "PhoneTextInput"

export function ComposeModal({
  open,
  onOpenChange,
  phoneNumbers,
  onSent,
  prefillContact,
  prefillInbox,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  phoneNumbers: PhoneNumber[]
  /** Called with the (new or existing) conversation id after a successful send. */
  onSent: (conversationId: string) => void
  prefillContact?: string
  prefillInbox?: string
}) {
  const [to, setTo] = useState("")
  const [inboxId, setInboxId] = useState(phoneNumbers[0]?.id ?? "")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Apply prefill values whenever the modal is opened with them.
  useEffect(() => {
    if (open) {
      if (prefillContact) setTo(prefillContact)
      if (prefillInbox) setInboxId(prefillInbox)
    }
  }, [open, prefillContact, prefillInbox])

  async function handleSend() {
    setError(null)

    const contact = to.trim()
    if (!contact) return setError("Enter a recipient number.")
    if (!isValidE164(contact)) {
      return setError("Enter a valid phone number with country code.")
    }
    if (!inboxId) return setError("Select an inbox to send from.")
    if (!body.trim()) return setError("Enter a message.")

    setPending(true)

    const conv = await getOrCreateConversation(inboxId, contact)
    if (!conv.ok) {
      setPending(false)
      return setError(conv.error)
    }

    const res = await sendMessage({
      conversationId: conv.conversationId,
      phoneNumberId: inboxId,
      to: contact,
      body,
    })

    setPending(false)

    if (!res.ok) return setError(res.error)

    // Reset + close.
    setTo("")
    setBody("")
    setError(null)
    onSent(conv.conversationId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Send a text to a contact from one of your inboxes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="compose-to"
              className="text-sm font-medium text-foreground/80"
            >
              Recipient number
            </label>
            <PhoneInput
              id="compose-to"
              international
              defaultCountry="US"
              value={to || undefined}
              onChange={(value) => setTo(value ?? "")}
              inputComponent={PhoneTextInput}
              className="phone-input flex items-center gap-2"
              placeholder="Enter phone number"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="compose-inbox"
              className="text-sm font-medium text-foreground/80"
            >
              Send from
            </label>
            <select
              id="compose-inbox"
              value={inboxId}
              onChange={(e) => setInboxId(e.target.value)}
              className="w-full cursor-pointer rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm text-foreground transition-colors duration-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"
            >
              {phoneNumbers.map((pn) => (
                <option key={pn.id} value={pn.id}>
                  {pn.label} ({pn.phone_number})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="compose-body"
              className="text-sm font-medium text-foreground/80"
            >
              Message
            </label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message…"
              rows={4}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={pending}
            className="cursor-pointer"
          >
            {pending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
