# Marginalia feature video

Length: about three minutes, plus a 45-second cut. Voice-over by Yash. Two public pages:

1. https://openai.com/index/navier-stokes-solution/ for the hard-reading story and "Simulate it".
2. https://science.nasa.gov/earth/facts/ for the everyday story: quick definitions, a worked example, a claim check, and the Library. NASA text is public domain, so it is safe on screen.

Between them the two pages show every kind of help the margin offers. `DEMO-SCRIPT.md` stays as the two-minute version with no live reply.

## Rule for every shot

Record only what happens live in the released build. A reply on screen is a reply that arrived during that take. Waits can be cut, and each cut gets a small "time cut" caption. Reply footage is never sped up. If a feature fails in rehearsal, drop its shot. Do not stage it.

## Coverage map

| Kind of help | On-screen label | Page | Live status on 2026-09-18 |
|---|---|---|---|
| instant definition | click an underlined term | both | proven, first text in 1.8 s |
| simulate | Simulate it | Navier-Stokes | proven |
| define | Define | Navier-Stokes | proven |
| derive | Step by step | Navier-Stokes | proven |
| diagram | Diagram | Navier-Stokes | proven |
| explore | Explore | Navier-Stokes | proven on retry |
| unsure | Not sure | Navier-Stokes | proven |
| instantiate | Give an example | NASA | proven |
| evidence | Check this claim | NASA | delivered live once, in 149 s. That reply said the support was insufficient and showed no citations. Show citations only if they arrive live in the take. |

Check each label against the build before recording. If a label differs, the build wins and this table gets corrected.

## Act 1. The problem (0:00 to 0:15)

| On screen | Say |
|---|---|
| The Navier-Stokes article, full width. Slow scroll. Stop on a dense paragraph. | "I read hard things on the web. Halfway down a page like this, I have six questions and nowhere to put them." |

## Act 2. The margin and my own notes (0:15 to 0:45)

| On screen | Say | Do |
|---|---|---|
| The margin opens on the right. The article does not move or change. | "Marginalia is a personalized, agentic and dynamic margin, right in your browser. It is my research assistant for the web. It opens beside the page. The page itself is never rewritten." | Click the toolbar icon. |
| Select a sentence. The selection card appears. | "I select a passage and get small choices. Keep, Highlight, Ask, or write a note." | Select, pause one second. |
| Type a short note. It saves beside the quoted passage. | "My own note comes first. It stays above anything a model says later." | Type one real sentence of your own. |

## Act 3. Instant help (0:45 to 1:05)

| On screen | Say | Do |
|---|---|---|
| Click the term "singularity". A short definition appears in about two seconds. | "For a quick question I just click the word. The definition uses this page as context, and it arrives in about two seconds." | One click. No cut. The speed is the point. |
| The usage line in Settings, if ticket A25 has landed. | "It runs on my own Codex plan. The margin tells me how much it used today, and I can turn it off." | Open Settings, hold two seconds. |

## Act 4. Simulate it (1:05 to 1:50). The centre of the video.

| On screen | Say | Do |
|---|---|---|
| Select the passage about viscosity smoothing out motion. "Simulate it" shows among the suggestions. | "This passage says viscosity smooths motion while the fluid amplifies itself. I want to feel that, so I pick Simulate it." | Click "Simulate it". |
| The review screen with the outgoing text. | "Before anything leaves my machine, I see exactly what will be sent." | Hold two seconds. Approve. |
| Waiting state. Cut with a "time cut" caption. | | |
| The reply: one line saying it is an illustration, then sliders, a curve and a classification. | "A Codex agent built me a small model. It says plainly that this is an illustration and does not solve the real equations." | Let the reply sit for two seconds. |
| Drag the damping slider down. The curve bends upward and the classification changes. Drag it back. | "Less damping, and the disturbance runs away. More damping, and it settles. That is the tension in the passage, in my hands." | Two slow drags. No narration over the second one. |

## Act 5. The other kinds of help, as a montage (1:50 to 2:25)

Record each as its own take on the Navier-Stokes page. In the edit, show three to four seconds of each finished reply, with its label as a caption.

| Caption | What to show |
|---|---|
| Define | The definition with its source line. |
| Step by step | The derivation, scrolled once. |
| Diagram | The diagram, with its note that arrows show relationships the page states. |
| Explore | The five-item reading shelf. |
| Not sure | The reply that first works out what I am asking. |

Say once, over the montage: "The same margin can define a term, walk through the steps, draw the relationships, suggest what to read next, or help when I cannot even phrase the question."

## Act 6. A second, ordinary page (2:25 to 2:50)

| On screen | Say | Do |
|---|---|---|
| The NASA Earth facts page. Click a term for an instant definition. | "It is the same on an ordinary page." | One click. |
| Select a fact. Pick "Give an example". Reply arrives (time cut). | "Here I ask for a worked example of one fact." | |
| Select a numeric claim. Pick "Check this claim". Reply arrives (time cut). | "And here I ask it to check a claim. It tells me plainly what it could and could not verify." | Say "with the citations shown" only if citations arrive in this take. Skip the row if the reply fails in rehearsal. |

## Act 7. It is all mine (2:50 to 3:10)

| On screen | Say | Do |
|---|---|---|
| Park the thread. Open the Library. Show saved threads from both pages, search, the recap, Export. | "Everything I keep lands in a local library on my own disk. I can search it, export it, or share one thread." | Type one search word. |
| Settings: excluded sites, and "forget this page". | "I choose which sites are never sent anywhere, and I can make the margin forget a page." | Hold two seconds each. |
| End card. | "Marginalia is an open-source alpha. No API keys. It uses your own Codex sign-in. The code and the research paper are linked below." | |

End card text:

Marginalia
A personalized, agentic and dynamic margin, right in your browser. Your research assistant for the web.
github.com/yashgurbani/marginalia

## The 45-second cut

Order: margin opens, instant definition (uncut), "Simulate it" reply with one slider drag, two montage replies, the Library, end card. On-screen text replaces most narration.

## Never on screen

- The pairing code, the helper terminal, or any path under the user folder.
- A reply that did not arrive live in that take.
- PDF reading or "Hear it".
- Any request for upvotes.
- Bookmarks, other tabs, the Windows taskbar, notifications.

## Test and recording environment

The demo runs in its own sandboxed copy of everything, so the recording starts clean each time and Yash's real library is untouched.

| Part | Setting |
|---|---|
| Helper data | `MARGINALIA_DATA_DIR=D:\Projects\Marginalia\.local\demo-env\data` |
| Helper port | `MARGINALIA_PORT` set to a free port that differs from the everyday helper |
| Browser | The Chrome for Testing build already downloaded for ticket A4, with a fresh profile folder under `.local\demo-env\chrome-profile` |
| Extension | Unpacked from `extension/.output/chrome-mv3` at the v1.1 commit |
| Window | 1920x1080, 100 percent zoom, bookmarks bar hidden, one tab |
| Codex | Yash's ordinary sign-in. Pairing is done by hand, off camera. |
| Reset | One command wipes the demo data and profile folders and nothing else |

Planned files, owned by Astra (`scripts/**` is its lane):

- `scripts/demo-env.ps1 -Start` starts the helper on the demo port and data folder, then opens Chrome for Testing on the Navier-Stokes page with the extension loaded. It prints no pairing code to any log file.
- `scripts/demo-env.ps1 -Reset` stops both and deletes only `.local\demo-env\data` and `.local\demo-env\chrome-profile`.
- `scripts/demo-env.ps1 -Check` confirms the helper answers, the extension is loaded, and both pages are reachable.

## How the video gets made

1. **Rehearsal by Astra.** After the v1.1 commit, an Astra worker drives the demo environment through every shot in this script with computer use. It records pass or fail per shot, the wait time per reply, and a screenshot of each finished reply. Shots that fail get dropped or fixed before Yash records. This doubles as the final check of the real browser journey.
2. **Recording by Yash.** OBS Studio is installed. One scene, window capture of Chrome for Testing only, 1920x1080, 60 frames a second, high-bitrate MKV. Record each act as its own take. Move the mouse slowly and pause one second after every click. Replies differ between runs, so Yash reads each reply once before recording the slider drag.
3. **Voice-over.** Record it separately after the picture is cut, in a quiet room. The "Say" lines are a draft. Yash puts them in his own words.
4. **Edit by Astra.** `ffmpeg` is installed. An Astra worker writes a cut list from the rehearsal timings, then assembles: trims, "time cut" captions, montage labels, the end card, loudness normalised to about -16 LUFS, export as 1080p H.264 MP4. It also renders the 45-second cut, a silent looping GIF of the slider drag for the Product Hunt gallery, and a thumbnail. Every edit decision lives in a text cut list, so Yash can change one line and re-render.
5. **Review by Yash.** Yash watches both cuts. His verdict is the gate. Nothing is posted by an agent.

Optional polish, only if time allows: a subtle zoom on the slider during Act 4, soft background music under 10 percent volume from a licence-free source Yash picks, and burned-in captions for silent autoplay.
