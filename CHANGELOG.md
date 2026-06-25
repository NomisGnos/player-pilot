# Changelog

## v0.2.10

- Added conservative Sneak Attack applicability checks for finesse/ranged weapons, the selected target, disadvantage, advantage, and a non-incapacitated ally near the target.
- Sneak Attack now reads `Apply Sneak Attack`, `Apply Sneak Attack (if applicable)`, or `Sneak Attack not applicable` with a short explanation, while noting that once-per-turn use cannot be confirmed automatically.
- Stopped redistributing copied D&D5e SVGs and moved shared interface artwork away from installed-system asset paths.
- Replaced system and Font Awesome dice dependencies with a complete module-local CC BY 3.0 dice set from Game-icons.net.
- Removed remaining D&D5e/PF2e asset-path dependencies, made shared roll visuals use Foundry core assets, and prevented the generic adapter from inheriting D&D preparation, equipment, advantage, and spell-scaling gates.
- Added conservative singular-target inference when structured counts are blank, while leaving ambiguous and cast-level-dependent target limits to the player and GM.
- Fixed D&D5e healing activities such as Cure Wounds so they remain healing, retain the spellcasting modifier, and preview the correct higher-slot dice.
- Standardized roll-instruction copy width for cleaner alignment and made the no-qualifier Sneak Attack state a prominent warning while retaining an explicit table-ruling override.
- Reworked PF2e strikes into the staged target-to-roll flow, limited PF2e cast-rank prompts to real rank choices, and expanded target lists with visible combatants plus target effect badges.
- Matched PF2e strike roll cards to the shared spell roll-card formatting so attack, MAP, damage, and critical controls align consistently.
- PF2e strike damage and critical cards now preview the native PF2e damage formula when available instead of showing only generic reminder text.
- Matched PF2e spell attack MAP labels to weapon strikes by showing the final modifier first, then the MAP note.

## v0.2.9

- Replaced the unsupported animated CSS percentage with ordinary text that visibly counts upward one number at a time, pauses at safe stage ceilings, and resumes without milestone jumps.
- Increased Player Pilot's base font size and substantially enlarged the Upcast Preview heading, explanation, effect label, formula, and increase text.

## v0.2.8

- Made the plain loading percentage count upward on the same animated timeline as the progress bar.
- Aligned roll instruction copy and action buttons into consistent columns, with responsive stacking on smaller screens.
- Added flat formula modifiers beside dice icons and visually separated attack, damage, healing, and save roll cards.
- Added full PF2e skill/save icon mappings and their underlying ability metadata so rolls no longer fall back to one repeated icon.

## v0.2.7

- Replaced the loading-percentage odometer with a normal, stable percentage label while retaining the smooth progress-bar animation.

## v0.2.6

- Synchronized the visible loading percentage with the compositor-driven progress bar using an animated odometer, so the number continues advancing during hard-refresh startup stalls.

## v0.2.5

- Reframed the cast-level damage display as an informational Upcast Preview, including the additional dice gained at the selected level.
- Added a clear Rolls Still Required step and renamed the cast button so players know attack, save, damage, or healing rolls still follow.
- Moved estimated loader motion to a monotonic compositor-driven transform so the bar can continue gliding during hard-refresh startup stalls.

## v0.2.4

- Smoothed the startup loader with device-paced progress between real Foundry milestones.
- Added stage ceilings and monotonic progress so estimated loading never races ahead and then moves backward.
- Kept the progress bar visibly active while a slow startup stage is waiting.

## v0.2.3

- Added compact GM-only action notices for spells, weapons, items, and features with prominent cast level and named targets.
- Added a player-facing concentration gate that requires confirming the current spell will end before another concentration spell can be used.

## v0.2.2

- Updated rules-text enrichment to use Foundry V14's namespaced TextEditor implementation without triggering the deprecated global warning.
- Fixed the Player Pilot loading screen startup race by identifying the current user from Foundry's pre-document world data, then reconciling the overlay against authoritative user settings during setup.
- Removed Foundry's unusable-window-dimensions notice immediately for Player Pilot users and gave every other non-progress Foundry notification a ten-second timeout, using the notification API so dismissed notices no longer occupy an internal notification slot.

## v0.2.1

- Restored the loading screen as the first full-screen view for players, kept it outside Foundry's replaceable page body, and held it through a confirmed painted Player Pilot handoff so the Pilot page and black background cannot flash between startup stages.

## v0.2.0

- Made selected-player loading deterministic from saved activation data, enabled Foundry no-canvas mode before first canvas initialization, and removed the first-load canvas-then-reload penalty.
- Reduced startup mutation-observer overhead by watching only direct body/document changes instead of every Player Pilot subtree repaint.
- Limited the Player Pilot loading screen to activated non-GM Player Pilot users; GMs and unselected players no longer receive the startup overlay.
- Surfaced important Foundry, D&D5e, and automation confirmation dialogs above the Player Pilot shell with Player Pilot styling while preserving their original buttons and callbacks.
- Fixed D&D5e 5.3.3 skill, ability-check, saving-throw, and death-save calls to use the current roll API and skip the obscured native configuration dialog.
- Added immediate D&D roll-total feedback after native rolls and corrected exhaustion refreshes that could display one change behind.
- Rebuilt the D&D death-save Details control into two readable success/failure blocks with a separate reset action.
- Promoted PF2e from generic fallback behavior to a native system adapter while leaving the D&D5e adapter behavior intact.
- Added PF2e one-, two-, and three-action grouping plus reactions, free actions, passive abilities, and native Strike cards.
- Added PF2e Strike attack variants for multiple-attack penalties, target prompting, damage, and critical-damage rolls.
- Added PF2e spellcasting through spellcasting entries so prepared slots, spontaneous slots, signature heightening, innate uses, cantrips, rituals, and Focus Points use the system's own casting logic.
- Added PF2e spell attack, multiple-attack, damage, heightening, defense, rank, range, area, target, trait, and duration presentation.
- Consolidated PF2e spell attacks and their MAP -5/-10 choices into one roll card, and collapsed multi-component spell damage into one native Damage action.
- Added PF2e Perception, skill, save, initiative, and recovery rolls through native statistics.
- Added a PF2e initiative picker for Perception or any actor skill and made quick-roll buttons bypass hidden native modifier dialogs.
- Replaced D&D-only status controls in PF2e worlds with Hero Points, Focus Points, Dying, Wounded, Doomed, Recovery Check, and Rest for the Night controls.
- Made PF2e Dying, Wounded, Doomed, recovery DC, ability labels, and Land/Climb/Fly/Swim speeds mirror the prepared actor data used by the native sheet.
- Routed PF2e Rest for the Night to the connected GM so its native confirmation appears on the GM screen, with a Player Pilot confirmation fallback when no GM is connected.
- Added PF2e-native inventory carry changes with one-hand, two-hand, worn/equipped, carried, stowed, and dropped choices, plus consumable use, quantity handling, containers, and coin adjustments.
- Added PF2e spell/action use counters beside Use and added the same counter to D&D5e feature cards shown in Actions.
- Added PF2e-specific action, spell, feature, and inventory filters.
- Added system-logo and world-title loading branding, a warning that the screen may briefly go blank, and automatic closing of the stray User Configuration window for Player Pilot users.
- Kept movement, targeting, GM proxying, map snapshots, and table controls shared across both supported systems.

## v0.1.30

- Kept the startup loader attached when Foundry replaces or repaints its page body during a hard refresh.
- Re-mounted Player Pilot when its early shell was detached during Foundry startup.
- Delayed loader dismissal until a rendered Player Pilot top bar is confirmed across two animation frames.

## v0.1.29

- Underlined clickable card titles and strengthened their hover/focus treatment.
- Added an immediate Player Pilot loading screen with phased progress and mounted the shell during Foundry setup to reduce the blank startup interval.
- Moved the prepared-spell count into each sticky spell-level header.
- Darkened and lightly blurred the modal backdrop for Use and information dialogs.
- Moved ability icons beside their labels and simplified ability scores to plain text.

## v0.1.28

- Increased menu item text size and lightened the open navigation background.
- Opened the Skills roll category by default.
- Removed the redundant top-level spell-slot bank and per-card spell-level pills from the Spells page.
- Increased prepared-spell contrast and brightness.
- Tightened and strengthened quantity minus/plus controls around the quantity value.
- Moved limited-use feature counters into the left control column beside Use.
- Suppressed range pills that contained only a bare unit such as Feet.

## v0.1.27

- Fixed narrow-screen preparation switches whose knob inherited title-span layout rules and distorted the control.
- Hardened switch width, height, appearance, overflow, and knob sizing against Foundry mobile button styles.
- Replaced inventory Equip/Unequip buttons with the same compact title-line toggle switch.
- Added accessible switch state and labels for both preparation and equipment controls.

## v0.1.26

- Removed the visible Info button from item, spell, feature, and action cards while preserving title and image access to details.
- Replaced the spell preparation button with a compact title-line toggle switch.
- Kept the lock icon in the same title position for cantrips and always-available spells.
- Restricted Actions to ready spells, equipped equippable items, features, and usable items that do not require equipment.
- Combined quantity controls and Use into a compact two-column row beneath each card.
- Reserved the left control column for quantity and the right column for Use, even when quantity is unavailable.
- Reduced the height and padding of quantity and Use controls.

## v0.1.25

- Removed the background and border from the always-available spell lock icon.
- Restored strict left alignment for spell and item titles at mobile widths.
- Suppressed Foundry's permanent minimum-window warning after Player Pilot loads for a pilot user.
- Removed the 30-second player scene-state polling loop and the GM's unsolicited startup scene broadcast.
- Added event-driven scene refresh when a pilot returns to a stale backgrounded session.
- Deduplicated GM scene snapshots by per-player fingerprints and stopped sending snapshots to offline pilot users.
- Removed full scene refresh requests after ordinary command results and player-authorized movement.
- Updated local movement coordinates immediately instead of asking the GM for a replacement scene snapshot.
- Added cached actor view models so filter, tab, and layout rerenders do not repeatedly normalize every actor item.
- Limited actor-driven GM scene broadcasts to actors represented by tokens on the viewed scene.
- Replaced the recurring audio-suppression scan with one startup cleanup plus lightweight playback guards.

## v0.1.24

- Recognized modern D&D's `prepared: 2` state so always-prepared spells remain locked at every spell level.
- Replaced the red unprepared X with a neutral gray checkmark toggle.
- Removed redundant Ready, At Will, Unprepared, Equipped, and Not Equipped pills from item cards.
- Moved useful spell and inventory metadata pills onto a dedicated line below each item title.
- Kept metadata wrapping on larger screens and changed it to a horizontally scrollable strip on narrow screens.
- Added a compact lock icon for spells that are always available and cannot be unprepared.
- Restyled Foundry notifications for Player Pilot and raised them above the full-screen interface.

## v0.1.23

- Added selected-target condition checks to attack instructions for common D&D advantage and disadvantage sources, including prone distance handling and cancellation.
- Added target condition data to scene snapshots so player-facing attack guidance can reflect the selected token.
- Unified spell-level and section header styling with a smaller, consistent header font.
- Added a scroll-to-top control for long pages that automatically hides whenever a Player Pilot dialog is open.
- Locked cantrips, at-will spells, innate spells, and always-prepared spells against unpreparing and labeled them with an always-available lock state.
- Filtered hidden, rider, automation-only, and duplicate activities so repeated Midi Use entries do not clutter player choices.
- Added player skill and ability choices for Guidance and similarly worded D&D effects, with the selection included in the GM notification and private chat request.

## v0.1.22

- Fixed modern D&D saving throw modifiers by reading each ability save's prepared value.
- Made secondary action, inventory, and feature funnel filters multi-select with active-filter count badges.
- Added icons to inventory and feature filter choices and aligned funnel controls to the top edge.
- Replaced separate action and subsection sticky bars with one updating combined header such as Actions - Weapons.
- Applied the same combined sticky-header pattern to Inventory and Features.
- Added GM notifications and private chat records for every requested item, spell, weapon, and feature activity.
- Changed target confirmation to trigger non-spell use immediately, removing the redundant later Use step.
- Kept selected targets active through spell confirmation and final roll instructions.
- Closed utility spell flows immediately when no player roll is required.
- Replaced the browser-native search clear control with a synchronized Player Pilot clear button.
- Added horizontal padding to selected-target count pills.
- Compressed Exhaustion and Death Saves into icon-driven single-line controls.

## v0.1.21

- Read Sneak Attack dice from the actor's live D&D rogue scale before falling back to the feature text.
- Moved secondary action filters into a compact funnel popover.
- Replaced Prepare, Unprepare, Equip, and Unequip text controls with persistent icon toggles.
- Removed yellow inactive-state borders and changed inactive status pills to red tones.
- Added persistent GM chat and notification messages for player-selected spell cast levels.
- Resolved modern D&D roll-data references such as `@scale.monk.die` and `@mod` for player instructions.
- Cleared action targets at the start and completion of each use flow.
- Improved roll-instruction spacing, formula contrast, and dice alignment.
- Added advantage and disadvantage labels, reasons when detectable, and two-d20 formula displays.
- Added a clickable initiative d20 beside the Details initiative modifier.
- Added a player-facing activity selector for items, features, weapons, and spells with multiple Foundry activities.

## v0.1.20

- Merged duplicate weapon and spell damage instructions so only the most complete typed formula is shown.
- Replaced base spell damage with its scaled cast-level formula instead of displaying both.
- Limited Special Feature emphasis to features explicitly marked special by Foundry item or activity data.

## v0.1.19

- Added an initiative-modifier strip directly below hit points on the Details page.
- Separated ability scores from modifiers with distinct score icons and spacing.
- Muted unequipped inventory and action cards to match unprepared spells.
- Snapped target-distance displays down to the scene grid step so adjacent diagonal targets count as 5 feet.
- Added child filters for Action, Bonus Action, and Reaction, plus Concentration and Ritual spell-action filters.
- Removed Initiative and standalone Death Save groups from the Rolls page.
- Replaced D&D ability artwork on roll cards with clearer Font Awesome ability and skill symbols.
- Added a Sneak Attack choice to weapon use for actors with a Sneak Attack feature and included its current dice in roll instructions.
- Preserved damage-type labels from modern D&D activity damage parts.
- Removed manual-roll buttons from action and spell roll instructions.
- Added prepared-spell totals and enforced live D&D class preparation maximums.
- Fixed movement waypoint labels rendering as `[object Object]` and placed totals on white, player-colored badges.
- Standardized feature-use labels as `Uses Available current / max`.
- Added stronger visual emphasis for triggered and special features.

## v0.1.18

- Added cumulative movement totals and waypoint traces for the GM canvas and connected display clients.
- Made Ping On Map require and capture the requesting player's selected token view while preserving the GM's prior canvas controls.
- Split Actions, Bonus Actions, Reactions, and Other actions into sticky weapon, spell, item, and class-feature subcategories.
- Added icon quick filters for action item categories.
- Made weapons enter the target-selection flow.
- Changed major action-header colors so they stand apart from the surrounding interface.
- Limited roll grids to two columns, kept long roll names visible, and added portable ability and d20 icons.
- Combined each D&D ability check and saving throw into one compact card with separate modifiers and roll controls.
- Made unprepared spells substantially more muted than usable spells.
- Included eligible player-character tokens in spell and feature target choices when the activity can affect self.
- Added cast-level previews with scaled damage/healing formulas and matching dice icons.
- Started delegated spell use after cast-level confirmation, then kept manual and automatic roll instructions as the final player step.
- Applied the selected cast level to the GM-side D&D spell-use dialog when the system presents one.
- Added activity-derived range labels for features and modern D&D item activities.
- Bundled the D&D ability, activity, item, damage, and dice SVG assets used by Player Pilot.

## v0.1.17

- Blocked player actions, movement, pings, targeting changes, rests, rolls, item use, and actor/item updates while the game is paused.
- Made the Use button inside item and spell info dialogs open the normal use flow, including target selection.
- Reduced visual weight for Unprepare and Unequip buttons.
- Added a few more compact tags for features, including passive and feature-type hints when system data exposes them.
- Added a Foundry v14 chat mode bridge for roll workflows that still call the deprecated roll-mode helper.
- Expanded spell upcast preview reading for newer D&D activity scaling data.
- Changed Ready and At Will spell flags to use light text on a darker prepared-state background.

## v0.1.16

- Renamed Gear to Inventory in the player navigation and README.
- Made target choices in the use dialog apply to the current player's targets immediately, then sync to the GM client.
- Changed target dialog counts to show selected targets against the allowed target count.
- Made dialog action buttons stick to the bottom of the dialog while scrolling.
- Added last-move distance feedback to the Controls page.
- Added D&D Hit Dice availability under hit points on the Details page.
- Tightened Details and Rolls layouts to reduce scrolling on narrow screens.
- Made item images and item titles open the item info dialog.
- Updated D&D spell preparation reads and writes to prefer modern `system.method` and `system.prepared` data.
- Improved saving throw roll instructions.
- Improved contrast for Ready and At Will spell flags.

## v0.1.15

- Removed the standalone Targets tab; target choices now stay inside actions and spells that need them.
- Applied player target selections on the GM client as soon as they are chosen in the use dialog.
- Fixed search clear buttons so they empty the search field and reset the visible list.
- Improved D&D roll handling for ability checks, saving throws, and skills across more actor roll APIs.
- Added PF2e roll categories so saves and skills appear in the grouped Rolls page.
- Tightened the Rolls page into a compact two-column layout with the d20 formula shown inside each card.

## v0.1.14

- Renamed the Stats tab to Details and made the character portrait/name open that tab.
- Removed spell detail tables from spell cards while keeping them in item info dialogs.
- Changed spell details into a compact table layout.
- Changed temporary hit points to use blue bar styling.
- Tightened the Details page stat layout so Armor Class, Speed, Level, and Proficiency share a row on wider screens, with Exhaustion and Death Saves paired below.
- Reworked roll cards so the dice image performs the roll and the preview shows only the compact d20 formula.
- Changed target-required actions and spells to choose targets first, then continue to roll/use details.
- Disabled out-of-range target choices in the use dialog.
- Improved limited-use labels for features by including named consumed resources when Foundry exposes them.
- Pruned duplicate base damage/healing prompts when a more specific or scaled roll is available.

## v0.1.13

- Removed the compact stat panel from the header flow.
- Cleaned up the Controls page by removing the Your Tokens section, removing extra header-side labels, and moving ping instructions into the snapshot placeholder.
- Added mouse-wheel zoom for Ping On Map snapshots.
- Restored sticky styling for shared page and section headers, including Actions and Rolls.
- Made item and spell labels read more like passive labels instead of action buttons.

## v0.1.12

- Rebuilt the header so compact stats are hidden by default and only open from the clickable character portrait/name area.
- Moved detailed character stats into their own Stats tab instead of using an overlay-style drawer.
- Reduced scene-state polling and GM scene broadcasts to lower battery use and reduce load on the GM client.
- Avoided repeated player re-renders when incoming scene state has not meaningfully changed.
- Limited player-side actor and item re-renders to the currently selected actor.
- Fixed spell detail rendering from normalized item data so casting time, range, target, components, and duration can appear on cards and info dialogs.
- Fixed spell-level slot matching so spell-level headers can show the matching slot pips.
- Replaced the Rolls header expand/collapse glyph with plain text markers to avoid missing icon squares.
- Refreshed exhaustion and death-save displays immediately after updates.

## v0.1.11

- Protected the compact stat strip on narrow phones so the scrolling body cannot cover it.
- Updated cast-level roll prompts so upcast spell damage or healing reflects the selected Cast Level when scaling data is available.
- Prevented unprepared spells from showing Use actions, and blocked them again at use time.
- Added stronger prepared, unprepared, equipped, and not-equipped card states with brighter borders and clearer action buttons.
- Added Equip and Unequip controls for gear that Foundry exposes as equippable, and hides Use until that gear is equipped.
- Added visible spell slot status directly inside each spell-level header.
- Expanded short rest and long rest recovery labels in item-use text.
- Moved the GM Player Pilot controls toggle to the left side of the screen.
- Added visible open and close chevrons to the Rolls section headers.

## v0.1.10

- Changed the small-phone compact stat layout so Hit Points gets a readable full-width row, with Armor Class, Level, Initiative, and Show Stats arranged below it instead of being squeezed too small.
- Renamed the player-facing Map tab to Controls.
- Improved spell metadata reading from Foundry item activity data so casting time, range, target, components, and duration appear more reliably on spell cards and item details.

## v0.1.9

- Changed the compact stat strip on very small screens to a horizontal scroll row so Hit Points, Armor Class, Level, Initiative, and Show Stats always display instead of being hidden by competing mobile grid rules.

## v0.1.8

- Fixed the narrow-phone compact stat layout so Hit Points no longer gets forced onto its own covered row at around 360px wide.
- Shortened the compact Hit Points label to HP and tightened the compact stat sizing for small screens.

## v0.1.7

- Rebuilt the compact stat strip so Hit Points, Armor Class, Level, and Initiative stay on one line on narrow phones.
- Added icons to the compact Hit Points, Armor Class, Level, and Initiative stats.
- Moved the Show Stats button below the compact stat row so it does not cover Hit Points.
- Tightened compact stat spacing and type sizes for 360px-wide screens.

## v0.1.6

- Expanded player audio suppression to cover Foundry sound playback, positioned sound playback, internal sound playback, autoplay loads, playlist sounds, AudioHelper, game audio, HTML audio, and Howler.
- Added an early canvas-hide class during startup and released it for non-Player-Pilot clients after ready.
- Added a dedicated Spell Slots Available bank above the spell list.
- Improved spell slot reading for slot data stored with override/string values.
- Added icons and color styling for prepared, concentration, ritual, action, range, target, uses, and spell-level labels.
- Changed ability score labels to spell out the full ability names.
- Hardened text rendering so Foundry Set/object values do not display as object labels.
- Made player ping color use the user's profile color when Foundry supports it.
- Tightened filter/action button sizing and strengthened the visual connection between the stat button, compact stats, and expanded stats drawer.

## v0.1.5

- Changed the hamburger button to open and close the main navigation instead of keeping the tab bar visible all the time.
- Made panel corners tighter and adjusted surfaces so cards, nav, and stat panels read less like one large set of buttons.
- Improved offline target fallback by building local scene target data when no GM is connected.
- Changed the Spells tab to show the full spell list instead of prepared spells only.
- Added unprepared labels on spell cards while keeping ready/at-will labels for usable spells.
- Improved spell detail extraction from D&D activity data for casting time, range, target, and duration.
- Limited ammo prompts to items that appear to use ammunition and narrowed ammo choices by weapon type when possible.
- Made item uses read as Uses Available instead of shorthand fractions.
- Added target count enforcement in the Use dialog when Foundry exposes a target count.
- Made Use-dialog target rows more compact and removed result toasts while modals are open.
- Added item artwork to item, spell, and gear info dialogs.
- Reused the clearer roll-choice dialog for spell, weapon, and item roll prompts.

## v0.1.4

- Fixed header stacking so top-level tab headers do not cover the stat area or spell-level headers while scrolling.
- Gave the compact stats, expanded stats, and navigation separate surfaces so they read as different UI areas.
- Added player-owned token detection to the GM scene snapshot so the Targets tab can show player tokens even when the current user does not own them.
- Grouped Features into class, subclass, ancestry/lineage, background, feats, actions, and other feature sections.
- Improved Gear grouping headers with icon labels and counts.
- Simplified currency cards to use Adjust instead of plus/minus controls.
- Added distinct currency colors and icons for platinum, gold, electrum, silver, and copper.

## v0.1.3

- Added icons to the main tabs and made the navigation larger and more button-like on phones.
- Kept Armor Class and level visible beside the compact hit point bar while the stat drawer is closed.
- Added ability scores to the expanded stats drawer.
- Reworked major headers for actions, rolls, spells, gear, targets, movement, and Ping On Map with larger sticky icon headers.
- Changed roll rows to one Roll button that opens a clearer choice between table die entry, table total entry, and automatic Foundry rolling.
- Reduced duplicate damage prompts by merging damage entries that use the same formula.
- Added GM-side token HUD controls for adding or removing tokens from the Player Pilot Targets/Ping list for the scene.
- Added a GM-side phone toggle for enabling or disabling player map controls.
- Added Ping On Map instructions, zoom controls, reset, and drag panning on the snapshot.
- Improved search clearing with a dedicated clear button and native search clear handling.

## v0.1.2

- Added stronger player-client audio suppression for browser audio, Foundry sounds, playlist sounds, and Howler playback paths.
- Added earlier no-canvas hiding for enabled player clients and kept the Player Pilot shell as the main mobile surface.
- Moved ability checks, saving throws, skills, initiative, and death saves into a dedicated Rolls tab.
- Reworked the top character area into a compact HP bar with temporary HP support and an expandable stats/rest drawer.
- Rebuilt the spell list around visual spell-level sections, sticky headers, slot icons, ready indicators, and spell details for casting time, range, target, components, and duration.
- Added clearer roll prompts for attacks, damage, and saving throws when using actions or spells, with table-roll entry support.
- Added bulk currency adjustment so players can add or subtract larger coin amounts in one step.
- Tightened target list fallback so it only shows player-owned map tokens unless combat or GM-selected tokens provide a target list.
- Improved movement feedback with a last-move distance badge and Foundry ruler movement options.
- Improved Ping On Map snapshots by capturing the PIXI stage while hiding noisy canvas layers.

## v0.1.1

- Added currency controls to the Gear tab for actor currency fields such as platinum, gold, electrum, silver, and copper.
- Reworked the phone layout so the stat cards, item buttons, quantity controls, and tags have more room on 430px-wide devices.
- Replaced shorthand labels with clearer text for proficiency, exhaustion, death saves, spell levels, abilities, and skill names.
- Added quick filter buttons for Actions, Spells, Features, and Gear.
- Improved item and feature description rendering for Foundry links, inline roll text, paragraphs, lists, and tables.
- Fixed scene ownership data so target lists do not mark GM-owned NPCs as player-owned.
- Changed GM-executed item targeting to apply a player's selected targets only for the action, then restore the GM's previous targets.
- Improved target refresh, ping drawing, Ping On Map coordinate mapping, and movement distance feedback.

## v0.1.0

- Initial Player Pilot module scaffold.
- Adds a mobile-first player interface separate from Sheet Sidekick.
- Includes actor switching, action/spell/feature/inventory views, movement controls, targeting, map pings, rest controls, recent roll display, journal image sharing, and GM/player socket routing.
- Starts with D&D5e-focused behavior and a PF2e/generic adapter fallback.
