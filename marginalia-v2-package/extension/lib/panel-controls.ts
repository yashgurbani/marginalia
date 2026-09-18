export function connectionControls(controls: ParentNode, embedded: boolean, enabled: boolean) {
  const connect = controls.querySelector<HTMLElement>('#connect'), disconnect = controls.querySelector<HTMLElement>('#disconnect'), open = controls.querySelector<HTMLElement>('#trusted-open');
  if (connect) connect.hidden = embedded || enabled;
  if (disconnect) disconnect.hidden = embedded || !enabled;
  if (open) open.hidden = !embedded;
}
