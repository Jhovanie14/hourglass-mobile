"use client"

export default function TestPage() {
  async function sendSMS() {
    try {
      // Fixed URL path to match where your API route actually lives!
      const res = await fetch("/api/webhooks/tylnex", { method: "POST" })

      const data = await res.json()
      console.log("Response data:", data)
    } catch (err) {
      console.error("Failed parsing browser network response:", err)
    }
  }
  return (
    <div className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Test Page</h1>
      <button
        onClick={sendSMS}
        className="rounded bg-blue-500 px-4 py-2 text-white transition hover:bg-blue-600"
      >
        Send Test SMS
      </button>
    </div>
  )
}
