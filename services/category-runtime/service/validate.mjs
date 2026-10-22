import { validateCategoryBundle, bytesHash } from "./bundle/core.mjs";
import canonical from "./contracts/pps-canonical.json" with { type: "json" };
import { FORMAT, validateExplicitBundle } from './explicit/contract.mjs';

export function validateSource(text) {
  if (Buffer.byteLength(text) > 8 * 1024 * 1024)
    throw new Error("Файл превышает 8 МБ.");
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    throw new Error("Некорректный JSON: проверьте файл.");
  }
  if (bundle?.metadata?.format_version === FORMAT) {
    const report = validateExplicitBundle(bundle);
    return { bundle, report: { ...report, sha256: bytesHash(Buffer.from(text)), category: bundle.category,
      stages_detail: bundle.subcategories.map(s => ({ id: s.stage.id, name: s.stage.name, variants: s.variants.length })) } };
  }
  if (bundle?.metadata?.format_version !== "category-bundle/v1") {
    throw new Error(
      "Нужен самодостаточный category-bundle/v1. Старый v4 не содержит всех документов: экспортируйте category bundle в генераторе.",
    );
  }
  const report = validateCategoryBundle(bundle);
  if (bundle.category.id !== "pps")
    throw new Error("Сейчас включён режим проверки только PPS.");
  const actual = bundle.subcategories.map((s) => ({
    stage: s.stage.id,
    fields: s.context_fields.map((f) => f.id),
  }));
  if (JSON.stringify(actual) !== JSON.stringify(canonical))
    throw new Error("Нарушен канонический порядок ситуаций или полей PPS.");
  if (
    report.variants !== 290 ||
    report.stages !== 8 ||
    report.document_templates !== 3 ||
    report.document_uses !== 80
  )
    throw new Error("Неполная поставка PPS.");
  for (const stage of bundle.subcategories)
    for (const row of stage.variants) {
      const next = row.payload.next;
      if (next && (Object.keys(next.facts).length || next.history?.length))
        throw new Error(
          "Исходный пакет не должен содержать пользовательские факты/историю.",
        );
    }
  return {
    bundle,
    report: {
      ...report,
      sha256: bytesHash(Buffer.from(text)),
      category: bundle.category,
      stages_detail: bundle.subcategories.map((s) => ({
        id: s.stage.id,
        name: s.stage.name,
        variants: s.variants.length,
      })),
    },
  };
}
