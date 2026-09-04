# Figure safety gate

Input included:

- `<script>`;
- `onload` event attribute;
- `<foreignObject>`;
- external image URL;
- a valid `<circle>`.

The `insert_figure` tool returned `ok:true`; its stored SVG contained a bounded `viewBox`, no script/event/foreign/external content, and retained a valid schematic element. Source serialization before and after the call was identical.

Production browser sanitizer characteristics:

- 120,000-character cap;
- allowed schematic-element set;
- removes unsupported elements and `style`/event attributes;
- local fragment references only;
- rejects unsafe paint URLs and dangerous schemes;
- viewBox edge cap of 10,000 units;
- normalized responsive width/height.

Command: `node .../diagnostics/tool-contract.mjs`  
Result: `ALL PASS`.

Qualification: the isolated Node run exercised the conservative no-DOM fallback; one unrestricted-browser test should also exercise the `DOMParser` production path.
