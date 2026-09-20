import { el, button } from '../dom.ts';
import { HIGHLIGHT_COLOURS, highlightColour, type HighlightColour, type Thread } from '../../contracts/reader.ts';
import type { PageSurface } from './types.ts';

const excerpt = (text: string, length = 82) => text.length > length ? text.slice(0, length) + '…' : text;
const actionButton = (key: string, text: string, run: () => unknown) => { const control = button(text, run); control.dataset.focusKey = key; return control; };
type SectionMark = { current: boolean; marks: number; notes: number; length: number; markPositions: number[] };

export function mountMarksSurface(page: PageSurface, openThread: (threadId: string, opener: HTMLElement | undefined) => void) {
  const map = el('nav', undefined, 'm-map'); map.setAttribute('aria-label', 'Page map: sections, notes and reading position');
  let railThreads: HTMLDivElement;
  const railThreadNodes = new Map<string, HTMLButtonElement>();
  return {
    map,
    mountThreadRail() { railThreads = el('div', undefined, 'm-rail-threads'); map.append(railThreads); },
    mountSections(openSection: (index: number, control: HTMLButtonElement) => void) {
      page.sections.forEach((section, index) => {
        const segment = button('', () => {
          openSection(index, segment);
        });
        segment.dataset.section = String(index); segment.className = `m-segment m-colour-${index % 6 + 1}`;
        const relativeLength = Math.max(1, section.end - section.start) / Math.max(1, ...page.sections.map(item => item.end - item.start));
        segment.style.flexGrow = String(Math.max(1, section.end - section.start));
        segment.style.flexBasis = `${Math.max(40, relativeLength * 112)}px`;
        segment.style.setProperty('--section-relative', String(relativeLength));
        const density = el('span', '', 'm-density'), marks = el('span', '', 'm-map-marks'), cue = el('span', '', 'm-map-position');
        for (const child of [density, marks, cue]) child.setAttribute('aria-hidden', 'true');
        segment.append(density, marks, cue); map.append(segment);
      });
    },
    updateSections(overview: readonly SectionMark[], position: number) {
      for (const node of Array.from(map.querySelectorAll<HTMLElement>('[data-section]'))) {
        const index = Number(node.dataset.section), item = overview[index];
        node.setAttribute('aria-current', String(item.current)); node.dataset.marked = String(item.marks > 0); node.dataset.notes = String(item.notes);
        const text = `${page.sections[index].title}${item.current ? ', current reading position' : ''}`;
        node.title = text; node.setAttribute('aria-label', text);
        const density = node.querySelector<HTMLElement>('.m-density')!; density.textContent = ''; density.hidden = true;
        node.style.setProperty('--note-density', String(Math.min(1, item.notes / Math.max(1, item.length / 500))));
        node.querySelector('.m-map-marks')!.replaceChildren(...item.markPositions.map(position => { const tick = el('span', '', 'm-map-mark'); tick.style.setProperty('--mark-position', `${position * 100}%`); return tick; }));
        const cue = node.querySelector<HTMLElement>('.m-map-position')!; cue.hidden = !item.current;
        cue.style.setProperty('--reading-position', `${Math.max(0, Math.min(1, (position - page.sections[index].start) / item.length)) * 100}%`);
      }
    },
    updateThreads(threads: Thread[]) {
      for (const [threadId, dot] of railThreadNodes) if (!threads.some(thread => thread.id === threadId)) { dot.remove(); railThreadNodes.delete(threadId); }
      threads.forEach(thread => {
        const label = thread.notes.find(note => !note.deletedAt)?.text ?? thread.anchor.exact;
        let dot = railThreadNodes.get(thread.id);
        if (!dot) {
          dot = button('', () => { openThread(thread.id, dot); });
          dot.className = 'm-rail-thread'; railThreadNodes.set(thread.id, dot);
        }
        dot.setAttribute('aria-label', 'Open saved thread: ' + excerpt(label, 66));
        dot.title = 'Saved work: ' + excerpt(label, 66);
        railThreads.append(dot);
      });
    },
    highlightControls(thread: Thread, commands: { toggle(): unknown; colour(colour: HighlightColour): unknown }) {
      const highlightToggle = actionButton(thread.id + ':highlight', thread.highlighted ? 'Remove highlight' : 'Highlight', commands.toggle);
      if (thread.anchor.kind === 'whole-page') highlightToggle.disabled = true;
      const colourPicker = el('div', undefined, 'm-highlight-colours'); colourPicker.setAttribute('role', 'group'); colourPicker.setAttribute('aria-label', 'Highlight colour');
      if (thread.highlighted) for (const colour of HIGHLIGHT_COLOURS) {
        const swatch = actionButton(thread.id + ':highlight-colour:' + colour, '', () => commands.colour(colour));
        swatch.className = 'm-highlight-swatch'; swatch.dataset.highlightColour = colour;
        swatch.setAttribute('aria-label', colour[0].toUpperCase() + colour.slice(1));
        swatch.setAttribute('aria-pressed', String(highlightColour(thread.highlightColour) === colour));
        colourPicker.append(swatch);
      }
      return { highlightToggle, colourPicker };
    },
  };
}
