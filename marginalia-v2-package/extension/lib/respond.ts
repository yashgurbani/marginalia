/** Chrome versions before promise-returning listeners require an explicit channel. */
export function respondAsync(operation: () => unknown, respond: (value: unknown) => void): true {
  Promise.resolve().then(operation).then(respond, () => respond(null));
  return true;
}
