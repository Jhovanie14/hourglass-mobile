// Pure first-run gate: setup is complete only once the agent has both a session
// and a persisted mic grant. Either missing → route the icon click to setup.
export function needsSetup(flags) {
  return !(Boolean(flags && flags.signedIn) && Boolean(flags && flags.micGranted))
}
