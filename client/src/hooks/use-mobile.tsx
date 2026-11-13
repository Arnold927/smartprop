import * as React from "react"

const MOBILE_BREAKPOINT = 768
// The app shell (sidebar, top bar, content offset) switches at Tailwind's `lg`
// (1024px). Phones, tablets and phones held sideways must all use the compact
// layout (header + drawer + bottom bar), so the shell uses this hook rather
// than the 768px one below. Initial state is read synchronously to avoid a
// one-frame flash of the desktop layout.
const COMPACT_BREAKPOINT = 1024

function useMaxWidth(max: number) {
  const get = () => (typeof window === "undefined" ? false : window.innerWidth < max)
  const [match, setMatch] = React.useState<boolean>(get)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${max - 1}px)`)
    const onChange = () => setMatch(window.innerWidth < max)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [max])

  return match
}

export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT)
}

/** True below 1024px: phones, tablets, landscape phones. */
export function useIsCompact() {
  return useMaxWidth(COMPACT_BREAKPOINT)
}
