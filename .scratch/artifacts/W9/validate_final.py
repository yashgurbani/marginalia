import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


base_url = sys.argv[1].rstrip("/")
output_dir = Path(__file__).resolve().parent
capture = len(sys.argv) > 2 and sys.argv[2] == "--capture"


def require(condition, message):
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda message: print(f"BROWSER {message.type}: {message.text}") if message.type in ("error", "warning") else None)
    page.on("pageerror", lambda error: print(f"BROWSER PAGE ERROR: {error}"))

    for name in ("render", "tools", "e2e"):
        page.goto(f"{base_url}/tests/{name}.test.html", wait_until="domcontentloaded")
        selector = "#final-result" if name == "tools" else "#result" if name == "e2e" else "#results"
        page.wait_for_function("([selector]) => /ALL PASS|FAIL/.test(document.querySelector(selector)?.textContent || '')", arg=[selector], timeout=15000)
        result = page.locator(selector).inner_text()
        require("ALL PASS" in result and "FAIL:" not in result and "FAILURES: 0" in result if name == "e2e" else "ALL PASS" in result and "FAIL:" not in result, f"{name} test page: {result.splitlines()[-1]}")

    if capture:
        page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
        page.wait_for_function("window.marginaliaTools && document.querySelectorAll('.document-section').length === 7", timeout=15000)
        fixture = page.evaluate("""
          async () => {
            const tools = window.marginaliaTools;
            const reading = await tools.get_reading_state.execute({ include_text: true });
            const first = reading.sections[0];
            const second = reading.sections[1];
            await tools.annotate.execute({ section_id: first.id, kind: 'expand', text: 'The inverse-square field makes rare, large deflexions possible.', reason: 'Connects the model to the observed scattering.' });
            await tools.highlight.execute({ section_id: first.id, quote: first.text.slice(0, 48), reason: 'This sentence frames the experimental problem.' });
            await tools.insert_figure.execute({ section_id: first.id, svg: '<svg viewBox="0 0 240 90"><line x1="10" y1="45" x2="230" y2="45" stroke="#7a5fc9"/><circle cx="120" cy="45" r="13" fill="#eef7f6" stroke="#7a5fc9"/><path d="M15 72 Q105 68 120 45 Q145 18 225 14" fill="none" stroke="#4a5fa8"/></svg>', caption: 'A close encounter bends the particle path.', reason: 'Shows the scattering geometry without changing the paper.' });
            await tools.set_section_depth.execute({ section_id: second.id, level: 'stub', reason: 'The reader already knows the model setup.', knowledge_refs: [], apply: 'now' });
            window.marginaliaVault.indexEntries([{ path: 'physics/rutherford.md', text: '# Rutherford notes\\nGold foil, Coulomb force, and nuclear scattering.' }]);
            const search = await tools.search_notes.execute({ query: 'gold foil', limit: 3 });
            await tools.annotate.execute({ section_id: first.id, kind: 'connection', target: search.results[0].path, relation: 'bridge', reason: 'The local note covers the same gold-foil evidence.' });
            return { title: reading.title, sections: reading.sections.length, search };
          }
        """)
        require(fixture["sections"] == 7, "full Rutherford fixture has seven sections")
        require(fixture["search"]["results"][0]["path"] == "physics/rutherford.md", "local vault search returns a path with provenance")
        require(page.locator(".artifact-figure svg").count() == 1, "sanitized figure appears in the margin")
        require(page.locator(".artifact-connection").count() == 1, "connection appears as a margin artifact")

        page.locator("#notes-toggle").click()
        tabs = page.locator(".tab-button").all_inner_texts()
        require(tabs == ["Knowledge", "Activity", "Vault", "Connections"], "Notes drawer exposes all four views")
        page.locator('[data-marginalia-aux="vault"]').click()
        require(page.locator('[data-marginalia-aux-panel="vault"]').count() == 1, "Vault view mounts")
        page.locator('[data-marginalia-aux="connections"]').click()
        require(page.locator('[data-marginalia-aux-panel="connections"]').count() == 1, "Connections view mounts")
        page.wait_for_timeout(1000)
        page.screenshot(path=str(output_dir / "drawer.png"), full_page=False)
        page.locator(".drawer-close").click()
        page.wait_for_timeout(300)

        page.screenshot(path=str(output_dir / "desktop.png"), full_page=False)
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
        page.wait_for_function("document.querySelectorAll('.document-section').length === 7", timeout=15000)
        page.evaluate("""
          async () => {
            document.querySelectorAll('.document-section')[1].click();
            const tools = window.marginaliaTools;
            const reading = await tools.get_reading_state.execute({ include_text: true });
            const first = reading.sections[0];
            await tools.set_section_depth.execute({ section_id: first.id, level: 'stub', reason: 'Known setup; expand for the full original section.', knowledge_refs: [], apply: 'now' });
            await tools.annotate.execute({ section_id: first.id, kind: 'question', text: 'Why can many small deflexions not explain the rare 90-degree events?', reason: 'Keeps the central interview question next to the passage.' });
          }
        """)
        require(page.evaluate("document.body.scrollWidth <= innerWidth"), "narrow reader has no horizontal overflow")
        page.wait_for_timeout(300)
        page.screenshot(path=str(output_dir / "narrow.png"), full_page=False)

    browser.close()
