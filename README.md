# Player Pilot

[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v13--v14.363-orange?style=for-the-badge)](https://foundryvtt.com/)
[![D&D5e](https://img.shields.io/badge/D%26D5e-native-red?style=for-the-badge)](https://foundryvtt.com/packages/dnd5e)
[![PF2e](https://img.shields.io/badge/PF2e-native-blue?style=for-the-badge)](https://foundryvtt.com/packages/pf2e)
[![SWADE](https://img.shields.io/badge/SWADE-native-blue?style=for-the-badge)](https://foundryvtt.com/packages/swade)
[![Patreon](https://img.shields.io/badge/Patreon-drop%20a%20goodberry-F96854?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/cw/nomisDM)

Player Pilot is a mobile-first character control module for Foundry VTT.

It is meant for players using a phone or tablet at the table. Players still log in through the normal Foundry page. Once they are logged in, Player Pilot gives selected users a clean character interface for actions, spells, features, inventory, rests, token movement, action targeting, and map pings.

Sheet Sidekick can stay installed for older worlds or reference. Player Pilot is a new module with a new UI and cleaner internals.

## Installation

Install this module from Foundry's **Add-on Modules** screen using the manifest URL:

```text
https://github.com/NomisGnos/player-pilot/releases/latest/download/module.json
```

Or install it manually:

1. Download the release zip.
2. Extract the module folder into your Foundry `Data/modules` folder.
3. Make sure the folder name matches the module id.
4. Restart Foundry if it was already running.
5. Enable the module inside your world from **Manage Modules**.


## Setup

1. Follow instructions under Installation
2. Restart Foundry or use Foundry's module refresh if your hosting setup supports it.
3. Enable `Player Pilot` in your world.
4. Open `Game Settings -> Configure Settings -> Module Settings`.
5. Open `Player Pilot Access`.
   
   <img width="761" height="662" alt="image" src="https://github.com/user-attachments/assets/818a4135-f5ad-4fc2-b228-35f2c950d8d2" />
   
7. Check the players who should use the mobile interface.
8. Have those players log in from their phone or tablet.
9. Give each player owner permission on their character actor.
10. Keep a GM client connected for movement fallback, map snapshots, shared pings, and GM-authoritative actions.

## Main Flow

Players log in normally. If they are enabled for Player Pilot, the module covers the normal Foundry interface with a phone-friendly shell.

The shell has tabs for:

- `Actions`: quick rolls and usable actions.

<img width="751" height="857" alt="image" src="https://github.com/user-attachments/assets/f4771512-385e-45de-a30c-a5d50dbd8f91" />
<img width="676" height="247" alt="image" src="https://github.com/user-attachments/assets/c080a999-991a-4f01-bd2f-e2ad9c294f69" />
<img width="686" height="324" alt="image" src="https://github.com/user-attachments/assets/7ac76199-db3d-4983-bcd8-32905919f512" />

- `Rolls`: system-native checks, saves, skills, Perception, and similar statistics.
- `Spells`: actor spells, grouped from the system item data.
- `Features`: class features, feats, actions, and similar actor abilities.
- `Inventory`: inventory items, equipment, consumables, tools, and weapons.
- `Controls`: token movement, token pings, and Ping On Map snapshots.

## What Works Now

- Mobile shell for selected non-GM users.
- Owned actor switching.
- HP, AC, system-native speed breakdowns, level, initiative, and system-specific character resources.
- D&D5e exhaustion and death-save controls.
- PF2e Hero Points, Focus Points, Dying, Wounded, Doomed, recovery DC, and Recovery Check controls.
- D&D5e-focused item use through `item.use()` when available.
- PF2e-native actions, reactions, free actions, feats, and consumable use.
- PF2e-native Strikes with multiple-attack variants, damage, critical damage, and target proxying.
- PF2e spellcasting through the actor's spellcasting entries, including prepared, spontaneous, innate, focus, cantrip, ritual, and signature-spell behavior.
- Skill, save, ability, death-save, and initiative roll buttons where the system exposes roll methods, including PF2e initiative selection by Perception or skill.
- Manual d20 entry for table dice rolls, with the modifier shown before the player submits.
- D&D5e short-rest and long-rest controls.
- PF2e Rest for the Night with its confirmation routed to the connected GM.
- D-pad token movement.
- GM-calibrated seat-relative D-pad movement for flat-table party displays, including rotated or flipped displays.
- Player-first movement with GM fallback.
- GM-authoritative socket routing when player-side execution is not available.
- Target selection inside actions and spells that need a target.
- Target proxying for GM-executed item use.
- Ping the active token and use Ping On Map snapshots.
- Ping On Map snapshot request and tap-to-ping workflow.
  <img width="768" height="716" alt="image" src="https://github.com/user-attachments/assets/9987b983-53c1-4588-8bde-4d44f9e627d5" />

- D&D5e prepared-spell toggles.
- PF2e prepared-slot availability and native slot expenditure without applying D&D preparation rules.
- Optional combat-turn lock for tables that only want the active combatant acting.
- Prepared spells, cantrips, at-will, innate, pact, and always-available spells are shown in the Spells tab.
- Spell slots are shown in the Spells tab.
- Inventory with quantity can be adjusted from the Inventory tab.
- PF2e inventory carry choices for held in one hand, held in two hands, worn/equipped, carried, stowed, or dropped.
- Limited-use counters beside Use for PF2e spells/actions and D&D5e feature cards in Actions.
- Items inside containers are grouped by container name when the system data exposes that link.
- Optional shared journal and image popups for enabled Player Pilot users.
- Optional player audio suppression.
- Optional no-canvas mode for enabled players.
- A branded startup screen showing the active system logo and world title, including a note that the display may briefly go blank while Foundry loads.

## Settings

- `Player Pilot Access`: choose which players get the mobile shell, set the party-display orientation, and calibrate where each player sits.
- `Activation Mode`: off, selected players only, or all non-GM players.
- `Use No-Canvas Mode`: reduces player client rendering. This is recommended for phones.
- `Movement Authority`: player-first with GM fallback, or always GM-authoritative.
- `Ping Snapshot Approval`: manual GM approval or automatic snapshot sending.
- `Show Shared Journals and Images`: allows shared journals and image popouts to appear above the mobile interface.
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

Player Pilot has native adapters for D&D5e and PF2e. The D&D path remains isolated from PF2e-specific actions, spellcasting, recovery, resources, equipment, and currency behavior.

The current compatibility targets are D&D5e 5.3.3 and PF2e 8.2.0 on Foundry VTT 14.363. The shared movement, targeting, map, and GM-proxy features are system-independent; actor mechanics are routed through the active system adapter.

Neither system is an installation dependency of the module. A PF2e world does not need D&D5e installed, and a D&D5e world does not need PF2e installed. Shared interface assets come from Player Pilot or Foundry core; only the active system's document APIs and actor/item images are used.

Other systems may show actors and items through the generic adapter, but they are not complete yet.

## Known Limits

- This is a first build of a large replacement module.
- D&D5e and PF2e both require in-world testing after system updates because their public document APIs can change.
- Rare PF2e subsystems such as complex crafting abilities, eidolons, companions, vehicles, armies, and campaign-specific sheets may still fall back to item chat cards.
- Ping On Map is approximate. It is for "around here" pings, not precision measurement.
- Player-first movement depends on token permissions and the system/world setup. If local movement fails, the request goes to the GM.
- A connected GM client is still recommended for the best experience.
- Shared journal and image popups are optional because the Player Pilot shell otherwise remains the main player-facing surface.

## Support

Please visit my Patreon and drop me a goodberry:

```text
https://www.patreon.com/cw/nomisDM
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Credits

Some icons are from [game-icons.net](https://game-icons.net/) and are used under the Creative Commons Attribution 3.0 license. Icons are credited to their respective authors where applicable.

Special thanks to [ddbrown30](https://github.com/ddbrown30) for contributing the system interface rework and SWADE support.
