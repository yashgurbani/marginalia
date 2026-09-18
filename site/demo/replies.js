/* Marginalia site demo data.
 * Every reply below is a replay of a reply recorded live on 18 September 2026.
 * The text is copied from the recorded evidence files and must not be edited,
 * extended or paraphrased. The demo margin never calls a model.
 * Sources: .local/redesign/demo-evidence/READ-ME-FIRST-replies.md and the
 * A2-*-readable.md files beside it.
 */
window.MARGINALIA_DEMO = {
  recordedOn: "2026-09-18",
  replayNote: "Recorded live.",
  demoNote: "This is a demo margin, replaying replies recorded on 18 September 2026.",

  passage: {
    text: "The development of a singularity would have to happen despite the presence of viscosity, which tends to smooth out motion.",
    sourceUrl: "https://openai.com/index/navier-stokes-solution/",
    sourceLabel: "OpenAI",
    capturedCharacters: 122,
    instantTerms: ["viscosity", "singularity"]
  },

  instant: {
    viscosity: {
      term: "viscosity",
      lead: "In this passage.",
      text: "Viscosity is a fluid’s resistance to flowing or changing shape. In this passage, it represents the smoothing force that opposes abrupt, concentrated motion, making the formation of a singularity more difficult.",
      waitSeconds: 4,
      waitNote: "first text in under 4 seconds"
    },
    singularity: {
      term: "singularity",
      lead: "Simply put.",
      text: "A singularity is a point or condition where a physical quantity becomes infinitely large or the usual equations stop working. Here, it likely means an extremely concentrated feature in motion, such as a point where velocity or another fluid property becomes unbounded.",
      waitSeconds: 4,
      waitNote: "first text in under 4 seconds"
    }
  },

  replies: {
    simulate: {
      kind: "simulate",
      label: "Simulate it",
      waitSeconds: 164,
      title: "Try growth against smoothing",
      summary: "Move the damping control gamma and watch the disturbance curve bend and the scalar classification change. Start with the drive f and initial disturbance y0 at their defaults; then vary them separately.",
      illustrationNote: "This scalar model illustrates competition between self-amplification and damping, inspired by the passage's description of viscosity. It does not solve the Navier–Stokes equations, establish fluid regularity, or reproduce a proof or the source's result.",
      blocks: [
        { type: "model", text: "" },
        {
          type: "plot",
          text: "",
          equationTex: "\\frac{dy}{dt}=y^2-\\gamma y+f,\\qquad y(0)=y_0",
          seconds: 8,
          sliderKeys: ["gamma", "f", "y0"]
        },
        {
          type: "classification",
          text: "Apply growth-v1 to y' = y^2 - gamma*y + f with y(0) = y0. If gamma squared minus 4f is negative, the scalar solution diverges. Otherwise, initial values above the larger root diverge, values at a root are equilibria, and remaining nonnegative initial values settle toward the smaller root, including the repeated-root case from below.",
          rule: "growth-v1"
        },
        { type: "equation", tex: "\\frac{dy}{dt}=y^2-\\gamma y+f,\\qquad y(0)=y_0" },
        { type: "text", text: "Try raising gamma toward 1, then lowering it toward 0.4 while leaving f and y0 at their defaults. Compare the curve and the scalar classification beside it. Next, hold gamma fixed and move f; finally, vary y0 to change the starting disturbance. The term y² supplies self-amplification, −gamma·y supplies damping, and f supplies a constant drive. These are chosen ingredients of the analogy. Sliders and bound numeric assumptions update this example locally. To change the equation or replace the scalar proxy with a spatial model, use Ask again." },
        {
          type: "text",
          text: "The captured passage says that viscosity \"tends to smooth out motion\". The damping term borrows that idea: it opposes an increase in the disturbance proxy. Exploring competition with self-amplification gives a small way to think about the passage, while leaving the fluid question unresolved.",
          link: { label: "Source passage", href: "https://openai.com/index/navier-stokes-solution/" }
        }
      ],
      sliders: [
        { key: "gamma", label: "Damping strength gamma", symbol: "gamma", value: 0.5, min: 0.4, max: 1, unit: "1/s" },
        { key: "f", label: "Added drive f", symbol: "f", value: 0.07, min: 0, max: 0.08, unit: "1/s²" },
        { key: "y0", label: "Initial disturbance y0", symbol: "y0", value: 0, min: 0, max: 0.1, unit: "1/s" }
      ],
      assumptions: [
        "A single nonnegative quantity y represents a disturbance proxy, measured in 1/s. The illustrative time scale in seconds is not calibrated to a fluid.",
        "Self-amplification is represented by y squared with coefficient one; spatial structure is omitted.",
        "Damping is linear with a constant rate gamma, initially 0.5 1/s. This number is chosen for the illustration.",
        "A constant added drive f, initially 0.07 1/s², supplies disturbance. The passage does not specify such a drive.",
        "The initial disturbance y0 is chosen as zero and can be varied up to 0.1 1/s. It is not supplied by the passage."
      ],
      limits: [
        "Actual fluid computation would require a spatial velocity field, pressure, incompressibility, viscous spatial derivatives, a domain, boundary conditions, and initial data. This scalar model contains none of that fluid structure.",
        "The linked growth-v1 criterion concerns only the declared scalar equation and its current parameters. Neither its classification nor the plotted curve establishes a Navier–Stokes singularity or regularity.",
        "The plot shows only the first eight illustrative seconds. The allowed parameter ranges keep this window before any scalar singularity; a finite curve over this window alone does not determine long-term behavior."
      ]
    },

    define: {
      kind: "define",
      label: "Define",
      waitSeconds: 130.4,
      question: "In this passage, what does viscosity mean and why does it matter to the claim about a singularity?",
      title: "Viscosity smooths motion, making a singularity harder to form",
      summary: "Here, viscosity means the effect that resists abrupt changes in motion by tending to smooth it out. It matters because the passage presents singularity formation as something that would have to occur despite this opposing, smoothing influence.",
      blocks: [
        { type: "text", text: "In this passage, viscosity is the effect that tends to smooth out motion, resisting abrupt or sharply concentrated changes. That matters because the sentence treats viscosity as an opposing influence: a singularity would have to develop despite this smoothing tendency, rather than in an environment with no resistance to such motion." }
      ],
      limits: [
        "The packet includes only the selected sentence and no wider page context, so this explanation is limited to the role viscosity plays in that sentence."
      ],
      staticFallback: "Viscosity here is the effect that smooths out motion. It matters because the passage says a singularity would have to develop despite that smoothing influence."
    },

    derive: {
      kind: "derive",
      label: "Step by step",
      waitSeconds: 134.2,
      title: "Why a singularity would have to overcome smoothing",
      summary: "The passage's phrase “despite the presence of viscosity” presents viscosity's smoothing tendency as an obstacle to a singularity. If a singularity developed, that tendency would have failed to prevent it; the sentence does not establish that a singularity actually develops.",
      blocks: [
        { type: "text", text: "The passage presents viscosity's smoothing tendency as an obstacle to a singularity through the word “despite”. Combined with “tends to smooth out motion”, this means that if a singularity developed, it would do so even with that smoothing tendency present. That is the sense in which it would have to “overcome” smoothing: the smoothing would not have prevented its development. The wording does not say that viscosity disappears or that a singularity is certain to occur." },
        {
          type: "note",
          label: "From the recorded evidence, not the reply text",
          text: "The reply also contains three source-bound wording steps: identify viscosity's smoothing tendency; read “despite” as keeping viscosity present; and keep the conclusion conditional. Its limitation says the sentence supplies no mathematical mechanism or proof that a singularity can or must develop."
        }
      ],
      limits: []
    },

    diagram: {
      kind: "diagram",
      label: "Diagram",
      waitSeconds: 125.2,
      title: "Viscosity, smoothing, and singularity formation",
      summary: "Viscosity tends to smooth out motion. Singularity formation, if it occurred, would have to happen despite viscosity and its smoothing tendency.",
      blocks: [
        { type: "text", text: "Viscosity tends to smooth out motion. Singularity formation, if it occurred, would have to happen despite viscosity's presence and smoothing tendency. The sentence leaves open whether a singularity actually forms." },
        {
          type: "diagram",
          nodes: [
            { id: "viscosity", label: "Viscosity" },
            { id: "smoothing", label: "Smoothing" },
            { id: "motion", label: "Motion" },
            { id: "singularity", label: "Singularity formation (conditional)" }
          ],
          edges: [
            { from: "viscosity", to: "smoothing", label: "tends to" },
            { from: "smoothing", to: "motion", label: "acts on" },
            { from: "singularity", to: "viscosity", label: "would have to occur despite" }
          ]
        }
      ],
      limits: [
        "The sentence gives no mechanism or conditions for singularity formation.",
        "The “despite” arrow expresses the sentence's contrast; its direction is an authored representation of the passage."
      ]
    },

    explore: {
      kind: "explore",
      label: "Explore",
      waitSeconds: 134.5,
      title: "From viscous smoothing to possible singularities",
      summary: "Start with diffusion, compare it with nonlinear steepening, then examine vortex stretching and the regularity problem and scaling. This reading path addresses the passage's central gap: why a smoothing mechanism does not by itself establish that a flow stays smooth.",
      blocks: [
        { type: "text", text: "Read next to separate two questions: how viscosity smooths motion, and what would be needed to prove that this smoothing always controls nonlinear growth. Follow the shelf from diffusion through a simple steepening model to three-dimensional vortex stretching; then turn to the precise regularity problem and scaling. Keep asking which quantity is controlled: total kinetic energy, local velocity gradients, or vorticity. Control of one is not automatically control of all three. Start with the first two items for intuition, or with Fefferman's problem statement if you already know the equations." },
        {
          type: "shelf",
          items: [
            { label: "Heat equation — Wikipedia" },
            { label: "Burgers' equation — Wikipedia" },
            { label: "Vorticity equation — Wikipedia" },
            { label: "Charles Fefferman — Existence and Smoothness of the Navier–Stokes Equation (PDF)" },
            { label: "Terence Tao — Why global regularity for Navier–Stokes is hard" }
          ]
        }
      ],
      limits: [
        "These are suggested destinations, not retrieved or verified resources; their current availability and contents have not been checked.",
        "Only the selected sentence was supplied.",
        "This shelf does not assess the surrounding article or any claim of a solution."
      ]
    },

    unsure: {
      kind: "unsure",
      label: "Not sure",
      waitSeconds: 95.6,
      title: "Viscosity tends to smooth motion; the outcome remains open",
      summary: "The sentence presents viscosity as tending to smooth motion and says any singularity would have to develop despite it. It does not establish whether a singularity can or cannot occur, and it leaves the meaning of singularity unspecified.",
      blocks: [
        { type: "text", label: "Supported interpretation", text: "The sentence presents viscosity as a smoothing influence: if a singularity developed, it would do so despite that influence. It leaves open whether a singularity actually occurs, is possible, or is ruled out. The precise meaning of singularity and the conditions under discussion are missing." },
        { type: "text", label: "Wording limits", text: "The phrase “tends to smooth out motion” describes a tendency; it does not by itself guarantee that motion always stays smooth. The phrase “would have to happen despite” frames singularity formation conditionally; it does not establish that formation happens. A firmer conclusion would require a definition of singularity, the relevant conditions, and an argument showing whether viscosity prevents its development under those conditions." },
        { type: "text", label: "Useful next kind", text: "A define reply focused on “singularity” would be a useful next step once the relevant definition or context is supplied, because the sentence leaves unclear exactly what the term denotes." }
      ],
      limits: []
    }
  },

  askOrder: ["simulate", "define", "derive", "diagram", "explore", "unsure"]
};
