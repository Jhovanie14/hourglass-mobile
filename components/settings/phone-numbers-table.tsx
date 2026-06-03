"use client"

import { useState } from "react"
import { format, parseISO } from "date-fns"
import {
  Pencil,
  Phone,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { updatePhoneNumber } from "@/app/dashboard/settings/phone-numbers/actions"
import { AddPhoneNumberModal } from "./add-phone-number-modal"
import { EditPhoneNumberModal } from "./edit-phone-number-modal"
import { DeletePhoneNumberDialog } from "./delete-phone-number-dialog"
import type { PhoneNumberRecord } from "@/types/conversations"

export function PhoneNumbersTable({
  phoneNumbers,
}: {
  phoneNumbers: PhoneNumberRecord[]
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<PhoneNumberRecord | null>(null)
  const [deleting, setDeleting] = useState<PhoneNumberRecord | null>(null)
  const [deactivating, setDeactivating] = useState<PhoneNumberRecord | null>(
    null
  )
  const [pending, setPending] = useState(false)

  const usedColors = phoneNumbers.map((p) => p.color)

  async function reactivate(pn: PhoneNumberRecord) {
    const res = await updatePhoneNumber(pn.id, { is_active: true })
    if (res.error) toast.error(res.error)
    else toast.success("Number reactivated successfully")
  }

  async function confirmDeactivate() {
    if (!deactivating) return
    setPending(true)
    const res = await updatePhoneNumber(deactivating.id, { is_active: false })
    setPending(false)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success("Number deactivated")
    }
    setDeactivating(null)
  }

  function onToggle(pn: PhoneNumberRecord) {
    if (pn.is_active) {
      setDeactivating(pn) // needs confirmation
    } else {
      reactivate(pn) // immediate
    }
  }

  if (phoneNumbers.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 py-20 text-center">
          <Phone className="mb-1 h-10 w-10 text-muted-foreground/40" />
          <p className="text-base font-medium text-foreground">
            No phone numbers added yet
          </p>
          <p className="text-sm text-muted-foreground">
            Add your first Telnyx number to get started
          </p>
          <Button onClick={() => setAddOpen(true)} className="mt-3 cursor-pointer gap-1.5">
            <Plus className="h-4 w-4" />
            Add Phone Number
          </Button>
        </div>
        <AddPhoneNumberModal
          open={addOpen}
          onOpenChange={setAddOpen}
          usedColors={usedColors}
        />
      </>
    )
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)} className="cursor-pointer gap-1.5">
          <Plus className="h-4 w-4" />
          Add Phone Number
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Inbox</TableHead>
              <TableHead>Phone Number</TableHead>
              <TableHead className="hidden md:table-cell">Color</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {phoneNumbers.map((pn) => (
              <TableRow
                key={pn.id}
                className={cn(!pn.is_active && "opacity-60")}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: pn.color }}
                    />
                    <span className="font-medium text-foreground">
                      {pn.label}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {pn.phone_number}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-5 w-5 rounded border border-border/60"
                      style={{ backgroundColor: pn.color }}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {pn.color}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      pn.is_active
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {pn.is_active ? "Active" : "Inactive"}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                  {pn.created_at ? format(new Date(pn.created_at), "MMM d, yyyy") : "---"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(pn)}
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onToggle(pn)}
                          aria-label={pn.is_active ? "Deactivate" : "Reactivate"}
                        >
                          {pn.is_active ? (
                            <ToggleRight className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {pn.is_active ? "Deactivate" : "Reactivate"}
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(pn)}
                          aria-label="Delete"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Modals */}
      <AddPhoneNumberModal
        open={addOpen}
        onOpenChange={setAddOpen}
        usedColors={usedColors}
      />
      <EditPhoneNumberModal
        phoneNumber={editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        usedColors={usedColors.filter(
          (c) => c.toLowerCase() !== editing?.color.toLowerCase()
        )}
      />
      <DeletePhoneNumberDialog
        phoneNumber={deleting}
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      />

      {/* Deactivate confirmation */}
      <AlertDialog
        open={deactivating !== null}
        onOpenChange={(o) => !o && setDeactivating(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this number?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents won&apos;t be able to see conversations or calls for this
              inbox until it&apos;s reactivated. Existing data is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeactivating(null)}
              disabled={pending}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeactivate}
              disabled={pending}
              className="cursor-pointer"
            >
              Deactivate
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
