import { button } from '../dom.ts';

/** The implemented page-save controls. Journey recording is separately owned future work. */
export function mountSaveJourneySurface(reading: HTMLElement, save: (parked: boolean) => unknown) {
  const savePageButton = button('Save page', () => save(false)), parkPageButton = button('Read later', () => save(true));
  reading.append(savePageButton);
  savePageButton.disabled = true; parkPageButton.disabled = true;
  return {
    savePageButton, parkPageButton,
    update(hydrated: boolean, saving: boolean) {
      savePageButton.disabled = !hydrated || saving; parkPageButton.disabled = !hydrated || saving;
    },
  };
}
