import { el, button } from './dom.ts';

/** The browser's localService flag is the admission boundary. Never let the
 * browser choose an implicit default voice, which can be a remote service. */
export function mountHearIt(host: HTMLElement, text: () => string, availability?: (available: boolean) => void) {
  const synth = globalThis.speechSynthesis;
  const available = !!synth && typeof globalThis.SpeechSynthesisUtterance === 'function';
  const status = el('p', '', 'm-meta'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  let active: SpeechSynthesisUtterance | undefined, disposed = false;
  let remaining = '', voice: SpeechSynthesisVoice | undefined;
  const abort = new AbortController();
  const say = (value: string) => { if (status.textContent !== value) status.textContent = value; };
  const localVoices = () => { try { return available ? synth.getVoices().filter(value => value.localService === true) : []; } catch { return []; } };
  const currentVoice = () => localVoices().find(value => value.voiceURI === voice?.voiceURI && value.lang === voice?.lang && value.name === voice?.name);
  const hear = button('Hear it', start), stopButton = button('Stop reading', () => stop()); stopButton.hidden = true;
  function refresh() {
    if (disposed) return;
    const voices = localVoices(); hear.disabled = !!active || !voices.length;
    availability?.(voices.length > 0);
    if (voices.length) { if (!hear.isConnected) host.append(hear, stopButton, status); }
    else { hear.remove(); stopButton.remove(); status.remove(); }
    if (active && !currentVoice()) { stop('The local voice is unavailable.'); return; }
    if (!active) say(!available ? 'Speech playback is unavailable in this browser.' : !voices.length ? 'A local reading voice is unavailable on this device.' : 'Ready to read with a local voice.');
  }
  function stop(message = 'Reading stopped.', cancel = true) {
    if (!active && !remaining) return;
    const ownedFocus = document.activeElement === stopButton;
    const hadActive = !!active;
    if (active) { active.onend = null; active.onerror = null; }
    active = undefined; remaining = ''; voice = undefined;
    if (cancel && hadActive) { try { synth.cancel(); } catch { message = 'The browser could not confirm that reading stopped.'; } }
    stopButton.hidden = true; hear.disabled = !localVoices().length;
    if (!disposed) { say(message); if (ownedFocus) hear.focus(); }
  }
  function next() {
    if (disposed) return;
    const current = currentVoice();
    if (!current) { stop('The local voice is unavailable.'); return; }
    // Bound each utterance, but retain every character for long captured pages.
    let end = Math.min(1200, remaining.length);
    if (end < remaining.length) { const space = remaining.lastIndexOf(' ', end); if (space > end / 2) end = space + 1; }
    const utterance = new SpeechSynthesisUtterance(remaining.slice(0, end)); remaining = remaining.slice(end);
    utterance.voice = current; utterance.lang = current.lang; active = utterance;
    utterance.onend = () => {
      if (disposed || active !== utterance) return;
      if (remaining) { try { next(); } catch { stop('Reading stopped. Try the local voice again.'); } }
      else stop('Reading finished.', false);
    };
    utterance.onerror = () => { if (!disposed && active === utterance) stop('Reading stopped. Try the local voice again.'); };
    try { synth.speak(utterance); } catch { stop('Reading stopped. Try the local voice again.'); }
  }
  function start() {
    if (disposed || active) return;
    const voices = localVoices(); voice = voices.find(value => value.default) ?? voices[0];
    if (!voice) { refresh(); return; }
    remaining = text().trim();
    if (!remaining) { say('Choose a passage to read.'); return; }
    hear.disabled = true; stopButton.hidden = false; say('Reading with a local voice.');
    try { next(); } catch { stop('Reading stopped. Try the local voice again.'); }
    if (active) stopButton.focus();
  }
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && active) { event.preventDefault(); stop(); } }, { signal: abort.signal, capture: true });
  if (available) synth.addEventListener('voiceschanged', refresh, { signal: abort.signal });
  refresh();
  return { stop, destroy() { if (disposed) return; disposed = true; stop(); abort.abort(); hear.remove(); stopButton.remove(); status.remove(); } };
}
