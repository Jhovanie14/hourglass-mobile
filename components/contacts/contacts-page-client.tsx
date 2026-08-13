"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { Pencil, Search, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ContactSheet } from "@/components/calls/contact-sheet"
import type { PhoneNumber } from "@/types/calls"

export type ContactRow = {
  id: string
  phone_number_id: string
  contact_number: string
  name: string
  updated_at: string
}

export function ContactsPageClient({
  phoneNumbers,
  contacts,
}: {
  phoneNumbers: PhoneNumber[]
  contacts: ContactRow[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [editFor, setEditFor] = useState<ContactRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const phoneById = useMemo(() => {
    const map: Record<string, PhoneNumber> = {}
    for (const p of phoneNumbers) map[p.id] = p
    return map
  }, [phoneNumbers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.contact_number.toLowerCase().includes(q)
    )
  }, [contacts, search])

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved names for the numbers that call your lines
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="cursor-pointer">
          <UserPlus className="h-4 w-4" /> Add contact
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or number…"
          className="w-full rounded-lg border border-border/60 bg-background/80 py-2 pr-3 pl-9 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 py-20 text-center">
          <Users className="mb-1 h-10 w-10 text-muted-foreground/40" />
          <p className="text-base font-medium text-foreground">
            {contacts.length === 0 ? "No contacts saved yet" : "No matches"}
          </p>
          <p className="text-sm text-muted-foreground">
            {contacts.length === 0
              ? "Add one here, or save a name from any call row"
              : "Try a different name or number"}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead className="hidden sm:table-cell">Line</TableHead>
                  <TableHead className="hidden md:table-cell">Updated</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((contact) => {
                  const line = phoneById[contact.phone_number_id]
                  return (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium text-foreground">
                        {contact.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {contact.contact_number}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {line && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: line.color }}
                          >
                            {line.label}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {formatDistanceToNow(new Date(contact.updated_at), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditFor(contact)}
                          aria-label={`Edit ${contact.name}`}
                          className="cursor-pointer"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">
            {filtered.length} contact{filtered.length === 1 ? "" : "s"}
          </p>
        </>
      )}

      {editFor && (
        <ContactSheet
          open={!!editFor}
          onOpenChange={(o) => !o && setEditFor(null)}
          contactNumber={editFor.contact_number}
          phoneNumbers={phoneNumbers}
          defaultPhoneNumberId={editFor.phone_number_id}
          existingName={editFor.name}
          onSaved={() => router.refresh()}
        />
      )}
      {addOpen && (
        <ContactSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          contactNumber=""
          allowNumberEdit
          phoneNumbers={phoneNumbers}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  )
}
