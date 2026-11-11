/** A small wait in place, beside what it waits for. A whole view waiting uses the meld loop. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
