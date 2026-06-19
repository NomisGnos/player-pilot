# Player Pilot

[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v13--v14.360-orange?style=for-the-badge)](https://foundryvtt.com/)
[![D&D5e](https://img.shields.io/badge/D%26D5e-first-red?style=for-the-badge)](https://foundryvtt.com/packages/dnd5e)
[![PF2e](https://img.shields.io/badge/PF2e-starter%20support-blue?style=for-the-badge)](https://foundryvtt.com/packages/pf2e)
[![Patreon](https://img.shields.io/badge/Patreon-drop%20a%20goodberry-F96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/nomisDM)

Player Pilot is a mobile-first character control module for Foundry VTT.

It is meant for players using a phone or tablet at the table. Players still log in through the normal Foundry page. Once they are logged in, Player Pilot gives selected users a clean character interface for actions, spells, features, inventory, rests, token movement, action targeting, and map pings.

Sheet Sidekick can stay installed for older worlds or reference. Player Pilot is a new module with a new UI and cleaner internals.

## Setup

1. Copy the `player-pilot` folder into your Foundry `Data/modules` folder.
2. Restart Foundry or use Foundry's module refresh if your hosting setup supports it.
3. Enable `Player Pilot` in your world.
4. Open `Game Settings -> Configure Settings -> Module Settings`.
5. Open `Player Pilot Access`.
6. Check the players who should use the mobile interface.
7. Have those players log in from their phone or tablet.
8. Give each player owner permission on their character actor.
9. Keep a GM client connected for movement fallback, map snapshots, shared pings, and GM-authoritative actions.

## Main Flow

Players log in normally. If they are enabled for Player Pilot, the module covers the normal Foundry interface with a phone-friendly shell.

The shell has tabs for:

- `Actions`: quick rolls and usable actions.
- `Spells`: actor spells, grouped from the system item data.
- `Features`: class features, feats, actions, and similar actor abilities.
- `Inventory`: inventory items, equipment, consumables, tools, and weapons.
- `Controls`: token movement, token pings, and Ping On Map snapshots.

## What Works Now

- Mobile shell for selected non-GM users.
- Owned actor switching.
- HP, AC, speed, level, proficiency, exhaustion, and death-save status.
- Exhaustion and death-save counters can be adjusted from the mobile shell.
- D&D5e-focused item use through `item.use()` when available.
- PF2e/generic fallback item use through `item.use()`, `item.roll()`, or chat output.
- Skill, save, ability, death-save, and initiative roll buttons where the system exposes roll methods.
- Manual d20 entry for table dice rolls, with the modifier shown before the player submits.
- Short rest and long rest controls in the Actions tab.
- D-pad token movement.
- Player-first movement with GM fallback.
- GM-authoritative socket routing when player-side execution is not available.
- Target selection inside actions and spells that need a target.
- Target proxying for GM-executed item use.
- Ping the active token and use Ping On Map snapshots.
- Ping On Map snapshot request and tap-to-ping workflow.
- Prepared spell toggle where the system exposes prepared spell state.
- Optional combat-turn lock for tables that only want the active combatant acting.
- Prepared spells, cantrips, at-will, innate, pact, and always-available spells are shown in the Spells tab.
- Spell slots are shown in the Spells tab.
- Inventory with quantity can be adjusted from the Inventory tab.
- Items inside containers are grouped by container name when the system data exposes that link.
- Shift-click or Alt-click a journal image as GM to share it with Player Pilot users.
- Optional player audio suppression.
- Optional no-canvas mode for enabled players.

## Settings

- `Player Pilot Access`: choose which players get the mobile shell.
- `Activation Mode`: off, selected players only, or all non-GM players.
- `Use No-Canvas Mode`: reduces player client rendering. This is recommended for phones.
- `Movement Authority`: player-first with GM fallback, or always GM-authoritative.
- `Ping Snapshot Approval`: manual GM approval or automatic snapshot sending.
- `Journal Image Duration`: how long shared journal images stay on player screens.
- `Suppress Player Audio`: stops local audio playback on enabled player clients.
- `Respect Combat Turns`: blocks movement and action buttons when it is not the actor's turn.

## Table Use

The intended table setup is:

- GM runs the normal Foundry client on a computer.
- Players open the Foundry world URL on their phone.
- Players use Player Pilot for character actions and movement.
- The GM client remains the reliable canvas authority.

Players are not treated as beginners. The UI keeps common choices close by, but it does not hide normal game concepts like targets, spell levels, rests, saves, or inventory.

## Compatibility

Player Pilot starts with D&D5e as the strongest system target.

PF2e has starter support through a system adapter. It reads common actor/item structures and tries public roll/use methods when the PF2e system exposes them. Some PF2e action details will need table testing and follow-up passes.

Other systems may show actors and items through the generic adapter, but they are not complete yet.

## Known Limits

- This is a first build of a large replacement module.
- D&D5e should be tested first.
- PF2e support is present, but not yet as deep as D&D5e.
- Ping On Map is approximate. It is for "around here" pings, not precision measurement.
- Player-first movement depends on token permissions and the system/world setup. If local movement fails, the request goes to the GM.
- A connected GM client is still recommended for the best experience.
- Journal image sharing uses Shift-click or Alt-click on a journal image from the GM client.

## Support

Please visit my Patreon and drop me a goodberry:

```text
https://www.patreon.com/cw/nomisDM
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
