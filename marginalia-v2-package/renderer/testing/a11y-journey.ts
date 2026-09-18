/** Real UI composition; only the helper boundary and library host navigation use fixtures. */
import { mountMargin } from '../../ui/margin.ts';
import { localPersistence, documentJournal } from '../../ui/persistence.ts';
import { mountLibrary } from '../../ui/library/index.ts';
import { attachmentTextHash } from '../../ui/helper.ts';
import type { Thread, SourceCapture, SourceVersion, ReaderMutation } from '../../contracts/reader.ts';
import type { PrepareJobInput } from '../../contracts/jobs.ts';
import type { AskingPreparation } from '../../ui/asking/types.ts';
import '../../ui/margin.css';
import '../../ui/consent.css';
import '../../ui/library/library.css';

export async function mountKeyboardJourney() {
  document.body.replaceChildren();
  const reading = document.createElement('div'), libraryRoot = document.createElement('div'); libraryRoot.hidden = true;
  document.body.append(reading, libraryRoot);
  const namespace = `p17-${crypto.randomUUID()}`, persistence = localPersistence(namespace);
  const journal = documentJournal(namespace, persistence.journal);
  // Synthetic credential belongs only to this fresh fixture IndexedDB. It is never sent.
  await persistence.write('pairing', { origin: location.origin, token: 'p17-controlled-fixture-credential' });
  const remote = new Map<string, Thread>(), captures = new Map<string, SourceCapture>();
  const requests: string[] = [], refused: string[] = [];
  const sourceFor = async (thread: Thread): Promise<SourceVersion> => {
    const capture = captures.get(thread.id)!;
    return { ...capture, id: thread.sourceVersionId, sourceId: 'fixture-source', hash: await attachmentTextHash(capture.text), metadataStatus: 'provided' };
  };
  const exported = async (id: string) => {
    const thread = remote.get(id); if (!thread) throw new Error('Fixture thread missing.');
    return { thread: structuredClone(thread), source: await sourceFor(thread), replies: [], replyViews: [] };
  };
  const prepare = async (input: PrepareJobInput): Promise<AskingPreparation> => {
    const thread = remote.get(input.threadId)!; const source = await sourceFor(thread);
    const note = input.answeredNote && thread.notes.find(n => n.id === input.answeredNote!.noteId && n.revision === input.answeredNote!.revision);
    const packet = { schema: 'marginalia.job-packet.v1', intent: input.intent, question: input.question,
      source: { url: thread.sourceUrl, title: source.title, pageType: source.pageType, capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id },
      selection: { ...thread.anchor, originalEnd: thread.anchor.end, omittedCharacters: 0 },
      adjacentContext: { before: '', after: '', basis: 'bounded-character-context' },
      ...(note ? { answeredNote: { noteId: note.id, revision: note.revision, text: note.text, originalCharacters: note.text.length, omittedCharacters: 0 } } : {}),
      availableCapabilities: [], omissions: [],
    };
    const text = JSON.stringify(packet), digest = await attachmentTextHash(text), policy = 'b'.repeat(64);
    return { unverified: [], disclosureVersion: null, job: { ...input, provider: 'app-server', model: 'fixture-host', mode: 'structured-final', policyKey: policy, preparedPayloadDigest: digest, capabilities: [] },
      preview: { id: `preview-${input.id}`, revision: 1, requestId: input.id, site: new URL(thread.sourceUrl).origin,
        scope: 'cloud-inference', scopeLabel: 'Controlled fixture review', recipient: 'fixture-provider', recipientLabel: 'Fixture recipient, no provider connection', provider: 'app-server', policyKey: policy,
        outgoing: [{ label: 'Bounded reading packet', text, sha256: digest }], payloadDigest: digest, bindingDigest: digest, expiresAt: new Date(Date.now() + 600000).toISOString(), state: 'ready' } };
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    const method = init?.method ?? 'GET'; const path = url.pathname; requests.push(`${method} ${path}`);
    const data = init?.body ? JSON.parse(String(init.body)) : undefined;
    let response: unknown;
    if (url.origin !== location.origin) { refused.push('external'); throw new Error('External request refused by fixture.'); }
    if (path === '/api/change' && method === 'POST') {
      const change = data as ReaderMutation;
      const saved = journal.state.threads.find(thread => thread.id === change.threadId);
      if (!saved) throw new Error('Fixture mutation lacks a local saved thread.');
      if (change.kind === 'keep') captures.set(change.threadId, structuredClone(change.capture));
      remote.set(saved.id, { ...structuredClone(saved), sourceVersionId: 'fixture-source-version' }); response = {};
    } else if (path === '/api/read/threads') response = { threads: [...remote.values()] };
    else if (path === '/api/read/replies') {
      const thread = remote.get(String(data?.thread));
      response = thread ? { replies: [], views: [], source: await sourceFor(thread) } : { replies: [], views: [] };
    } else if (path === '/api/read/export' && method === 'POST') response = await exported(url.searchParams.get('thread')!);
    else if (path === '/api/read/jobs' && method === 'POST') response = { configured: true, available: true, unverified: [], disclosureVersion: null, jobs: [] };
    else if (path === '/api/jobs/prepare' && method === 'POST') response = await prepare(data);
    else if (path === '/api/reattach') response = { state: 'exact', candidates: [] };
    else { refused.push(`${method} ${path}`); throw new Error(`Unexpected fixture route: ${method} ${path}`); }
    return Response.json(response);
  };
  let margin: Awaited<ReturnType<typeof mountMargin>>;
  let library: ReturnType<typeof mountLibrary> | undefined;
  let returnFocus: HTMLElement | undefined;
  const closeLibrary = () => {
    library?.destroy(); library = undefined; libraryRoot.hidden = true; reading.hidden = false; margin.resume();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
  margin = await mountMargin(reading, { storageName: namespace, helperOrigin: location.origin, initialOpen: true,
    readPosition: async () => undefined, writePosition: async () => {},
    onLibrary: () => {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      margin.suspend(); reading.hidden = true; libraryRoot.hidden = false;
      library = mountLibrary(libraryRoot, { listThreads: async () => [...remote.values()], exportThread: exported, onOpenThread: closeLibrary, onClose: closeLibrary });
      // Same entry focus policy as webapp/main.ts.
      libraryRoot.querySelector<HTMLElement>('button')?.focus();
    },
  });
  await margin.drain();
  const source = reading.querySelector('.m-source')!; const sourceSnapshot = source.innerHTML;
  Object.assign(globalThis, { p17Journey: {
    requests, refused, sourceUnchanged: () => source.innerHTML === sourceSnapshot,
    drain: () => margin.drain(),
    destroy: async () => { library?.destroy(); margin.destroy(); await margin.drain(); globalThis.fetch = originalFetch; },
  } });
}
