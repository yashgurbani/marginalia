# Gates: Marginalia hackathon submission (chief-of-staff ledger)

OWNS: (integrator) git, deploy, .scratch/bridge/CONTRACT.md, GATES.md

Scope: A submittable WebMCP Challenge entry by 10:00 CEST 2026-09-04: live URL with WebMCP tools, public MIT repo, video, description.

- [x] G1: Public repo exists with MIT license and first commit inside the submission window
  CHECK: node -e "const {execSync:x}=require('child_process');const r=x('gh repo view yashgurbani/marginalia --json visibility,licenseInfo').toString();if(!/PUBLIC/.test(r)||!/MIT/.test(r))process.exit(1);console.log('REPO_OK')"
  EXPECT: REPO_OK
  EVIDENCE: https://github.com/yashgurbani/marginalia commit e25c242 08:31 CEST
- [ ] G2: src/state.js and src/tools.js exist and tests/tools.test.html exercises every tool through window.marginaliaTools
  CHECK: node -e "const fs=require('fs');for(const f of ['src/state.js','src/tools.js','tests/tools.test.html'])if(!fs.existsSync(f))process.exit(1);const t=fs.readFileSync('src/tools.js','utf8');for(const n of ['get_reading_state','set_section_depth','annotate','upsert_knowledge','search_notes','insert_figure'])if(!t.includes(n))process.exit(2);console.log('CORE_OK')"
  EXPECT: CORE_OK
  EVIDENCE: pending
- [ ] G3: index.html renders three fixtures with layers, stubs, knowledge panel (W2 report + Yash screenshot)
  EVIDENCE: pending
- [ ] G4: fixtures/index.json lists 3 fixtures and fixtures/ATTRIBUTION.md exists; README has Prior work vs new work + license
  CHECK: node -e "const fs=require('fs');const i=JSON.parse(fs.readFileSync('fixtures/index.json','utf8'));if(i.length<3)process.exit(1);for(const e of i)if(!fs.existsSync(e.path))process.exit(2);if(!fs.existsSync('fixtures/ATTRIBUTION.md'))process.exit(3);const r=fs.readFileSync('README.md','utf8');if(!/Prior work/i.test(r)||!/MIT/.test(r))process.exit(4);console.log('CONTENT_OK')"
  EXPECT: CONTENT_OK
  EVIDENCE: pending
- [ ] G5: Tools visible and callable in the ChatGPT desktop in-app browser on the live URL (Yash, screenshot)
  EVIDENCE: pending
- [ ] G6: Video < 3:00, public on YouTube, no music/logos (Yash)
  EVIDENCE: pending
- [ ] G7: Devpost submission confirmed before 10:00 CEST (Yash, confirmation email)
  EVIDENCE: pending
- [ ] G8: Agora tickets for GPT-5.6 Pro pushed to GitHub under .scratch/agora/
  CHECK: node -e "const fs=require('fs');const d='.scratch/agora/TICKETS';if(!fs.existsSync(d)||fs.readdirSync(d).length<1)process.exit(1);console.log('TICKETS_OK')"
  EXPECT: TICKETS_OK
  EVIDENCE: pending
