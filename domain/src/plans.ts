// GLOSSARY 6 / DATA_MODEL `plan_inclusions` and `entitlement_inclusions`: what a plan or custom grant unlocks.
// "Covers" (GLOSSARY 7.1): one scope rule matches (product P, variant kind K).
import { z } from 'zod';
import { InclusionTarget, type ProductKind, ProductKind as ProductKindSchema, VariantKind } from './enums';
import { ProductId, type TemplateId } from './ids';

export const InclusionRule = z
  .strictObject({
    targetType: InclusionTarget,
    productId: ProductId.nullable(),
    productKind: ProductKindSchema.nullable(),
    variantKind: VariantKind,
  })
  .superRefine((r, ctx) => {
    const ok =
      (r.targetType === 'product' && r.productId !== null && r.productKind === null) ||
      (r.targetType === 'template_sections' &&
        r.productId !== null &&
        r.productId.startsWith('tpl_') &&
        r.productKind === null) ||
      (r.targetType === 'product_kind' && r.productId === null && r.productKind !== null) ||
      (r.targetType === 'all_products' && r.productId === null && r.productKind === null);
    if (!ok) ctx.addIssue({ code: 'custom', message: `invalid shape for inclusion target ${r.targetType}` });
  });
export type InclusionRule = z.infer<typeof InclusionRule>;

export interface CoverageTarget {
  productId: ProductId;
  productKind: ProductKind;
  /** Templates whose relationship to this section has `included_with_template = 1`. Empty for templates. */
  includedWithTemplates: readonly TemplateId[];
}

/** True when one rule of `scope` covers (product, variantKind). Pure configuration; nothing is implied (ENTITLEMENTS 1.6). */
export function scopeCovers(
  scope: readonly InclusionRule[],
  target: CoverageTarget,
  variantKind: z.infer<typeof VariantKind>,
): boolean {
  return scope.some((r) => {
    if (r.variantKind !== variantKind) return false;
    switch (r.targetType) {
      case 'product':
        return r.productId === target.productId;
      case 'template_sections':
        return (
          target.productKind === 'section' &&
          r.productId !== null &&
          target.includedWithTemplates.includes(r.productId as TemplateId)
        );
      case 'product_kind':
        return r.productKind === target.productKind;
      case 'all_products':
        return true;
    }
  });
}
