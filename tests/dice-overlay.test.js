import test from "node:test";
import assert from "node:assert/strict";

import { rollMessageLabel } from "../scripts/dice-overlay.js";

test("turns an HTML-rich roll flavor into a safe dice-overlay label", () => {
  const label = rollMessageLabel({
    speaker: { alias: "Wolf" },
    flavor: '<h4 class="action"><strong>Melee Strike: Jaws</strong></h4><div class="target-dc">Target: Ezren (AC 15)</div><span data-visibility="gm">Modifier +7</span>'
  });

  assert.match(label, /Melee Strike: Jaws/);
  assert.match(label, /Target: Ezren/);
  assert.doesNotMatch(label, /<h4|<div|Modifier \+7/);
});
