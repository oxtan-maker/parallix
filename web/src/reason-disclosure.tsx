/** Exact duplicate text stays reachable without repeating it in the normal view. */
export function ReasonDisclosure({ label, reason }: { readonly label: string; readonly reason: string }) {
  return <details><summary style={{ cursor: 'pointer' }}>{label}</summary><div>{reason}</div></details>;
}
