// Export handoff: assemble one ZIP from a compiled result. Pure except for the
// injected getCropBytes(sourceId) -> Uint8Array|null, so it's testable in Node.
// Reference filenames/IDs come straight from compiled.resolved.refs, so they
// match DESIGN.md, PROMPT.txt, and resolved-spec.json exactly.
import { zipStore } from "./zip.js";
import { renderTokenCss, renderBoard, KIT_README } from "./design-assets.js";
import { DESIGN_SYSTEM_INSTRUCTION, renderBuildPlan, renderReviewChecklist } from './design-guidance.js';

const enc = new TextEncoder();

export async function buildBundle(compiled, getCropBytes) {
  if (!compiled?.resolved) throw new Error("Compile before exporting.");
  if (typeof getCropBytes !== "function") throw new Error("buildBundle needs a getCropBytes(sourceId) function.");
  const files = [
    { name: "DESIGN.md", data: enc.encode(compiled.designMd) },
    { name: "PROMPT.txt", data: enc.encode(compiled.prompt) },
    { name: "resolved-spec.json", data: enc.encode(compiled.specJson) },
    { name: "tokens.css", data: enc.encode(renderTokenCss(compiled.resolved)) },
    { name: "reference-styles.css", data: enc.encode(compiled.referenceCss || '/* Compile again to include per-reference CSS. */') },
    { name: "BOARD.html", data: enc.encode(renderBoard(compiled)) },
    { name: "KIT-README.md", data: enc.encode(KIT_README) },
    { name: "SYSTEM.md", data: enc.encode(DESIGN_SYSTEM_INSTRUCTION) },
    { name: "BUILD-PLAN.md", data: enc.encode(renderBuildPlan(compiled)) },
    { name: "REVIEW-CHECKLIST.md", data: enc.encode(renderReviewChecklist(compiled)) },
  ];
  for (const r of compiled.resolved.refs) {
    const bytes = await getCropBytes(r.sourceId);
    if (!bytes || !bytes.length) {
      throw new Error(`Missing crop for ${r.id} (${r.host}) — cannot export a complete package. Re-pick or remove that reference.`);
    }
    files.push({ name: r.imageFile, data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) });
  }
  return { filename: "design-claw-handoff.zip", bytes: zipStore(files) };
}
