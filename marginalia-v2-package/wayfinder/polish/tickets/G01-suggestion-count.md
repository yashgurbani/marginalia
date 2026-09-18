# Suggestion count decision

status: resolved 2026-09-18 by Yash
type: grilling, Yash
blocked by: none

## Question
The whitepaper says Ask opens "at most three suggestions" (`docs/sources/RESEARCH-WHITEPAPER-v3.md:125`). On 2026-09-18 three kinds were added at Yash's request, so a selection now shows six offers (`ui/margin.ts:19`).

1. Does the three-suggestion rule stand, with the rest under More? Fable's recommendation is yes, because the founding document says so and a six-button row reads like a toolbar.
2. Which three lead? Today's first three are See it, What supports this, Define this.
3. The sixth label is lowercase "diagram", taken from the whitepaper's list of kinds. What does the button say?

## Resolution
Yash, 2026-09-18: "three with rest under more, which three lead? we had a whole equation for that buddy, on fit between the transform and the block?"

Decision: three offers, the rest under More, plus the line to type your own. The three that lead come from the whitepaper's additive score (`docs/sources/RESEARCH-WHITEPAPER-v3.md:131` to `:145`): fit to the block, plus fit to the page, plus stated preference, plus a useful reply nearby, minus a penalty for a just-dismissed repeat. Eligibility is the only hard filter. Cost is a word on the chip. Positions stay fixed once drawn; better ideas arrive as a quiet "more ideas" line. A note changes the score. No fixed trio is hardcoded. The ticket "Three offers plus More" implements this score. The sixth button label stays open.
