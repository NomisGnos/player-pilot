import test from "node:test";
import assert from "node:assert/strict";

import { dnd5eResourceDetails } from "../scripts/dnd5e-resources.js";

test("reads a shared item-use pool and recovery period from D&D activity consumption", () => {
  const channelDivinity = {
    id: "channel",
    name: "Channel Divinity",
    system: {
      uses: {
        max: 3,
        spent: 1,
        value: 2,
        recovery: [{ period: "sr", type: "recoverAll" }]
      }
    }
  };
  const actor = { items: new Map([[channelDivinity.id, channelDivinity]]) };
  const item = { id: "guided", name: "Guided Strike", type: "feat", actor, system: {} };
  const activity = {
    name: "Guided Strike",
    actor,
    item,
    system: {
      activation: { type: "reaction" },
      consumption: {
        targets: [{ type: "itemUses", target: "channel", value: "1" }]
      }
    }
  };

  const details = dnd5eResourceDetails(activity);
  assert.deepEqual(details, [
    {
      kind: "item",
      label: "Channel Divinity",
      value: "2 / 3 available",
      reset: "Reset with Short Rest on the Stats page"
    },
    {
      kind: "reaction",
      label: "Timing",
      value: "Reaction",
      reset: "This is an out-of-turn action"
    }
  ]);
});

test("identifies a cantrip as unlimited from its Foundry spell data", () => {
  const guidance = {
    id: "guidance",
    name: "Guidance",
    type: "spell",
    system: { level: 0 }
  };

  assert.deepEqual(dnd5eResourceDetails(guidance), [{
    kind: "cantrip",
    label: "Cantrip",
    value: "Unlimited casting",
    reset: "No spell slot required"
  }]);
});

test("shows an item's own uses only once", () => {
  const feature = {
    id: "feature",
    name: "Limited Feature",
    type: "feat",
    system: {
      uses: {
        max: 2,
        value: 1,
        recovery: [{ period: "lr" }]
      }
    }
  };

  assert.deepEqual(dnd5eResourceDetails(feature), [{
    kind: "item",
    label: "Limited Feature",
    value: "1 / 2 available",
    reset: "Reset with Long Rest on the Stats page"
  }]);
});

test("reads activity-local uses", () => {
  const item = { name: "Special Defense", type: "feat", system: {} };
  const activity = {
    name: "Reduce Damage",
    item,
    system: {
      uses: {
        max: 4,
        spent: 3,
        recovery: [{ period: "lr" }]
      },
      consumption: {
        targets: [{ type: "activityUses", value: "1" }]
      }
    }
  };

  assert.deepEqual(dnd5eResourceDetails(activity), [{
    kind: "activity",
    label: "Reduce Damage",
    value: "1 / 4 available",
    reset: "Reset with Long Rest on the Stats page"
  }]);
});

test("supports legacy D&D item consumption used by v13-compatible system data", () => {
  const resource = {
    id: "superiority",
    name: "Superiority Dice",
    system: {
      uses: {
        max: 4,
        value: 3,
        recovery: [{ period: "sr" }]
      }
    }
  };
  const actor = { items: new Map([[resource.id, resource]]) };
  const maneuver = {
    id: "maneuver",
    name: "Maneuver",
    type: "feat",
    actor,
    system: {
      consume: {
        type: "charges",
        target: "superiority",
        amount: 1
      }
    }
  };

  assert.deepEqual(dnd5eResourceDetails(maneuver), [{
    kind: "item",
    label: "Superiority Dice",
    value: "3 / 4 available",
    reset: "Reset with Short Rest on the Stats page"
  }]);
});
