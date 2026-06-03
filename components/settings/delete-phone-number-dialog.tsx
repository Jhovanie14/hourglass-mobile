"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deletePhoneNumber } from "@/app/dashboard/settings/phone-numbers/actions"
import type { PhoneNumberRecord } from "@/types/conversations"

export function DeletePhoneNumberDialog({
  phoneNumber,
  open,
  onOpenChange,
}: {
  phoneNumber: PhoneNumberRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [confirmText, setConfirmText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setConfirmText("")
      setError(null)
    }
  }, [open])

  const matches = confirmText.trim() === phoneNumber?.label

  async function handleDelete() {
    if (!phoneNumber || !matches) return
    setError(null)
    setPending(true)

    const res = await deletePhoneNumber(phoneNumber.id)

    setPending(false)

    if (res.error) {
      setError(res.error)
      return
    }

    toast.success("Phone number deleted")
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this phone number?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
                This will permanently delete the{" "}
                <strong>{phoneNumber?.label}</strong> inbox and ALL its
                conversations, messages, and call history. This cannot be undone.
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="delete-confirm"
                  className="block text-sm text-foreground"
                >
                  Type{" "}
                  <span className="font-semibold">{phoneNumber?.label}</span> to
                  confirm
                </label>
                <Input
                  id="delete-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  placeholder={phoneNumber?.label}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!matches || pending}
            className="cursor-pointer"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete Permanently
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
