import test from "node:test";
import assert from "node:assert/strict";

import { cleanRulesText, localizedFieldLabel } from "../scripts/utils.js";

test("removes HTML markup from system-provided roll labels", () => {
  globalThis.game = {
    i18n: {
      localize: (value) => value
    }
  };

  const label = "<h4><strong>Arcana</strong></h4>";
  assert.equal(cleanRulesText(label), "Arcana");
  assert.equal(localizedFieldLabel(label, "arcana"), "Arcana");
});
