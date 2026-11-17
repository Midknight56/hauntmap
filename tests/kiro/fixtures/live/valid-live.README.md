# valid-live.json

Produced on 2026-11-17 by `kiro-integration` task 9:

1. Lines 3 and 13 of `samples/manor/src/notifications/receipt.ts` (the import of `describeOrder` from `../orders/checkout` and the `console.info(describeOrder(...))` call, read from `receiptToCheckout` in `public/demo/manor/before/expected.json`) were deleted.
2. `pnpm hauntmap analyze samples/manor --out tests/kiro/fixtures/live/valid-live.json` wrote this file (the CLI prints `analyze: 40 modules, 71 relations, 1 diagnostics`).
3. `pnpm demo:reset` restored `samples/manor` from `public/demo/manor/before`.

The file is the analysis output as the `analyze-live` hook would write it. The facts below are hand-authored, not taken from the analyzer, and `tests/kiro/` checks them:

- 40 modules.
- 71 distinct relation IDs (72 in `manor/before`).
- The demo relation `["src/notifications/receipt.ts",["local","src/orders/checkout.ts"],"import","value"]` is absent.
- `sourceLabel` is `live:samples/manor`.

The file holds no source text.