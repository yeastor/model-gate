// Shared read-only checker. Import and runtime use the same validation module.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateExplicitBundle } from './explicit/contract.mjs';

export function checkCategory(bundle, { catalog, forms } = {}) {
  const structure = validateExplicitBundle(bundle);
  const references = Object.keys(structure.document_refs);
  const entries = Array.isArray(catalog) ? catalog : catalog?.document_templates ?? catalog?.templates;
  const proofs = Array.isArray(forms) ? forms : forms?.forms;
  const issues = [];
  for (const id of references) {
    const matches = entries?.filter(t => (t.document_link_id ?? t.link_id) === id && t.status === 'active');
    if (!matches || matches.length !== 1) issues.push({ code: 'ACTIVE_ADMIN_TEMPLATE_NOT_VERIFIED', document_link_id: id });
    else {
      const templateId = matches[0].generator_template_id ?? matches[0].id;
      const proof = proofs?.find(p => (p.link_id ?? p.document_link_id) === id && (p.template_id ?? p.generator_template_id) === templateId && p.status === 200);
      if (!proof) issues.push({ code: 'LIVE_FORM_OPEN_NOT_VERIFIED', document_link_id: id });
    }
  }
  return { structure: { status: 'PASS', ...structure }, document_evidence: { status: issues.length ? 'NOT_VERIFIED' : 'PROVIDED_EVIDENCE_MATCHES', issues },
    final_category_closure: 'NOT_CERTIFIED_BY_STRUCTURE_CHECK', category_closed: false,
    limitations: ['Optional catalog/form inputs are supplied evidence, not an assertion of live freshness.', 'Metadata flags do not establish full source coverage or legal/content approval.', 'Session ownership/history/budgets need runtime tests; schema alone cannot prove them.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) options.set(process.argv[i], process.argv[i + 1]);
  try {
    if (!options.get('--input')) throw new Error('Usage: node service/check-category.mjs --input category.json [--catalog synced-admin.json --forms form-proof.json]');
    const read = async p => p ? JSON.parse(await readFile(p, 'utf8')) : undefined;
    console.log(JSON.stringify(checkCategory(await read(options.get('--input')), { catalog: await read(options.get('--catalog')), forms: await read(options.get('--forms')) }), null, 2));
  } catch (e) { console.error(JSON.stringify({ structure: { status: 'FAIL', error: e.message, issues: e.report?.issues } })); process.exitCode = 1; }
}
