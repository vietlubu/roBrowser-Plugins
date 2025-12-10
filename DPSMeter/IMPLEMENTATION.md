# DPS Meter Plugin - Implementation Documentation

## Overview

The DPS Meter plugin is a real-time damage tracking system for ROBrowser that intercepts server packets to accurately track damage and skill usage. This document provides technical details about the implementation.

## Architecture

### Component Structure

```
DPSMeter/
├── DPSMeter.js          # Main plugin logic (AMD module)
├── DPSMeter.html        # UI template
├── DPSMeter.css         # Styling
├── README.md            # User documentation
├── IMPLEMENTATION.md    # This file
└── example-config.js    # Configuration example
```

### Module Pattern

The plugin follows ROBrowser's AMD (Asynchronous Module Definition) pattern using RequireJS:

```javascript
define(function (require) {
	"use strict";

	var UIComponent = require("UI/UIComponent");
	var Network = require("Network/NetworkManager");
	var PACKET = require("Network/PacketStructure");
	// ... other dependencies

	var DPSMeter = new UIComponent("DPSMeter", htmlText, cssText);

	// ... component methods

	return DPSMeter;
});
```

## Core Functionality

### 1. Packet-Based Tracking Architecture

**Major Design Change:** The plugin now uses **server packet interception** instead of client-side rendering hooks. This provides:

- Accurate source attribution (player vs others)
- Precise skill identification via SKID
- Support for ground/persistent skills (Fire Wall, Storm Gust, etc.)
- No ambiguity about damage source

### 2. Damage Packet Interception

The plugin hooks into incoming damage packets from the server:

```javascript
Network.hookPacket(PACKET.ZC.NOTIFY_ACT, function (pkt) {
	// Normal attack damage
	self.handleDamagePacket(pkt, "NOTIFY_ACT");
});

Network.hookPacket(PACKET.ZC.NOTIFY_SKILL, function (pkt) {
	// Skill damage
	self.handleDamagePacket(pkt, "NOTIFY_SKILL");
});

Network.hookPacket(PACKET.ZC.NOTIFY_SKILL_POSITION, function (pkt) {
	// Ground skill damage
	self.handleDamagePacket(pkt, "NOTIFY_SKILL");
});
```

**Hooked Packets:**

- `ZC.NOTIFY_ACT` (0x8a) - Normal attack damage
- `ZC.NOTIFY_ACT2` (0x2e1) - Normal attack damage (variant)
- `ZC.NOTIFY_ACT3` (0x8c8) - Normal attack damage (variant)
- `ZC.NOTIFY_SKILL` (0x114) - Skill damage with target
- `ZC.NOTIFY_SKILL2` (0x1de) - Skill damage (variant)
- `ZC.NOTIFY_SKILL_POSITION` (0x115) - Ground skill damage
- `ZC.NOTIFY_GROUNDSKILL` (0x117) - Ground skill placement notification

### 3. Skill Cast Tracking

Outgoing skill usage is tracked by hooking `Network.sendPacket`:

```javascript
Network.sendPacket = function (packet) {
	if (packet.SKID && packet.SKID > 0) {
		// Skill cast detected
		recordSkillCast(skillName);

		// Track for damage attribution
		_recentSkills[packet.SKID] = {
			ownerGID: playerGID,
			skillName: skillName,
			timestamp: Date.now(),
		};
	} else if (packet.action === 0 || packet.action === 7) {
		// Normal attack detected
		recordSkillCast("Normal Attack");
	}

	return _originalSendPacket.call(Network, packet);
};
```

**Tracked Actions:**

- Skill usage packets (packets with `SKID` field)
- Normal attack packets (`CZ.REQUEST_ACT` with action 0 or 7)

### 4. Ground Skill Support

Ground skills (Fire Wall, Storm Gust, traps, etc.) are tracked using SKID-based matching:

**Problem:** Ground skills create separate entities on the server. Damage packets come from these entities (different AID), not directly from the player.

**Solution:** Track skills by SKID instead of entity AID:

```javascript
// When skill is used
_recentSkills[SKID] = {
	ownerGID: playerGID,
	skillName: skillName,
	timestamp: Date.now(),
};

// When damage arrives
if (pkt.SKID && _recentSkills[pkt.SKID]) {
	var skillUsage = _recentSkills[pkt.SKID];
	if (skillUsage.ownerGID === playerGID) {
		// This damage is from player's skill!
		recordDamage(skillUsage.skillName, pkt.damage);
	}
}
```

**Example Flow:**

```
Player casts Fire Wall (SKID: 18)
    ↓
Outgoing packet → _recentSkills[18] = { owner: player, name: "Fire Wall" }
    ↓
Server creates Fire Wall entity (AID: 2499)
    ↓
Monster walks into Fire Wall
    ↓
ZC.NOTIFY_SKILL (SKID: 18, AID: 2499, damage: 1500)
    ↓
Match SKID → _recentSkills[18] → owner = player ✓
    ↓
Record damage to "Fire Wall"
```

### 5. Player Damage Filtering

Only damage from the player is tracked:

```javascript
var playerGID = Session.Entity.GID;
var attackerGID = pkt.GID || pkt.AID;

// Check direct attack
var isPlayerDamage = attackerGID === playerGID;

// Check skill-based attack (for ground skills)
if (!isPlayerDamage && pkt.SKID && _recentSkills[pkt.SKID]) {
	var skillUsage = _recentSkills[pkt.SKID];
	if (skillUsage.ownerGID === playerGID) {
		isPlayerDamage = true;
	}
}
```

**Filtered Out:**

- Party member damage
- Other player damage
- Monster vs monster damage
- NPC damage

### 6. Critical Hit Detection

Critical hits are detected via the `action` field in damage packets:

```javascript
if (pkt.action === 10) {
	// This is a critical hit
	if (type === "NOTIFY_SKILL") {
		attackName += " (Crit)"; // Skill crit
	} else {
		attackName = "Critical"; // Normal attack crit
	}
}
```

**Critical Tracking:**

- **Normal Attack Crit**: Tracked separately as "Critical" with auto-incremented casts per hit
- **Skill Crit**: Tracked as "Skill Name (Crit)" with dash "-" for casts (modifier, not separate action)

### 7. Data Tracking Structure

Damage data is stored per skill/attack type:

```javascript
var _tracking = {
	active: false, // Is tracking enabled?
	startTime: 0, // Timestamp when tracking started
	totalDamage: 0, // Total damage dealt
	skills: {}, // Per-skill damage breakdown
	lastUpdateTime: 0, // Last UI update timestamp
};

// Skill structure:
_tracking.skills["Fire Wall"] = {
	damage: 12540, // Total damage
	hits: 45, // Number of hits
	casts: 3, // Number of times cast
};
```

### 8. Cast vs Hit Tracking

The plugin distinguishes between **casts** (skill usage) and **hits** (damage instances):

- **Casts**: Tracked from outgoing packets when player uses skill/attack
- **Hits**: Tracked from incoming damage packets
- **Special Case - Critical**: Auto-increment casts = hits (each crit is counted)
- **Modifiers**: Skills with "(Crit)" or "(Lucky)" show "-" for casts (not separate actions)

### 9. DPS Calculation

DPS is calculated as: `DPS = Total Damage / Elapsed Time`

```javascript
var currentTime = Date.now();
var elapsedSeconds = (currentTime - _tracking.startTime) / 1000;
var totalDPS =
	elapsedSeconds > 0 ? Math.floor(_tracking.totalDamage / elapsedSeconds) : 0;
```

Individual skill DPS:

```javascript
var skillDPS = elapsedSeconds > 0 ? skill.damage / elapsedSeconds : 0;
```

Percentage contribution:

```javascript
var percentage =
	_tracking.totalDamage > 0
		? (skill.damage / _tracking.totalDamage) * 100
		: 0;
```

## UI Components

### Window Structure

```html
<div id="DPSMeter">
	<div class="titlebar">
		<!-- Draggable title bar -->
		<div class="content">
			<div class="controls">
				<!-- Start/Stop/Reset buttons -->
				<div class="summary">
					<!-- Time, Total DPS, Total Damage -->
					<div class="skill-list">
						<!-- Skill breakdown table -->
						<div class="skill-header">
							<div>Skill</div>
							<div>Casts</div>
							<!-- NEW: Cast count -->
							<div>Damage</div>
							<div>DPS</div>
							<div>%</div>
						</div>
						<div class="skill-item">...</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
```

### Update Loop

The UI updates every 100ms when tracking is active:

```javascript
_updateInterval = setInterval(function () {
	self.updateDisplay();
}, 100);
```

**Update Process:**

1. Calculate elapsed time
2. Calculate total DPS
3. Update summary displays
4. Rebuild skill list (sorted by percentage)

### Skill List Sorting

Skills are sorted by damage percentage (highest first):

```javascript
skills.sort(function (a, b) {
	return b.percentage - a.percentage;
});
```

This ensures the most significant damage sources are at the top.

### Cast Display Logic

```javascript
var damageModifiers = ["(Crit)", "(Lucky)"];
var hasDamageModifier = false;

for (var m = 0; m < damageModifiers.length; m++) {
	if (skill.name.indexOf(damageModifiers[m]) !== -1) {
		hasDamageModifier = true;
		break;
	}
}

if (hasDamageModifier || castsDisplay === 0) {
	castsDisplay = "-"; // Don't show cast count for modifiers
}
```

## State Management

### Preferences

Window position and visibility are persisted:

```javascript
var _preferences = Preferences.get(
	"DPSMeter",
	{
		x: 100, // Window X position
		y: 100, // Window Y position
		show: false, // Visibility state
	},
	1.0,
); // Version
```

Saved on:

- Window close
- Window toggle
- Component removal

### Skill Context Management

Recent skill usage is tracked with automatic cleanup:

```javascript
var SKILL_CONTEXT_MAX_AGE = 60000; // 60 seconds

// Clean up old entries
var now = Date.now();
for (var skid in _recentSkills) {
	if (now - _recentSkills[skid].timestamp > SKILL_CONTEXT_MAX_AGE) {
		delete _recentSkills[skid];
	}
}
```

**Why 60 seconds?**

- Ground skills can persist for extended periods
- Traps can remain active for 30+ seconds
- DOT effects can last for multiple rounds
- Better to keep longer context than miss damage

### Lifecycle

```
Plugin Load → prepare() → append() → init()
    ↓
Hook Network Packets (incoming damage + outgoing skills)
    ↓
User clicks Start → Start tracking loop
    ↓
Packets intercepted:
  - Outgoing: Track casts, build skill context
  - Incoming: Match damage to skills, record data
    ↓
Update UI every 100ms
    ↓
User clicks Stop → Stop tracking loop (data preserved)
    ↓
User clicks Reset → Clear data → Restart tracking (optional)
    ↓
Component removal → Unhook packets → Save preferences
```

## Packet Structure Reference

### ZC.NOTIFY_ACT (0x8a)

```javascript
{
    GID: 2000001,           // Attacker entity ID
    targetGID: 110016683,   // Target entity ID
    startTime: 12345,
    attackMT: 500,
    attackedMT: 500,
    damage: 234,            // Damage amount
    count: 1,               // Number of hits
    action: 0,              // Action type (10 = critical)
    leftDamage: 0
}
```

### ZC.NOTIFY_SKILL (0x114)

```javascript
{
    SKID: 18,               // Skill ID (Fire Wall)
    AID: 2000001,           // Attacker ID
    targetID: 110016683,    // Target ID
    startTime: 12345,
    attackMT: 500,
    attackedMT: 500,
    damage: 1500,           // Damage amount
    level: 10,              // Skill level
    count: 1,
    action: 0
}
```

### ZC.NOTIFY_SKILL_POSITION (0x115)

```javascript
{
    SKID: 21,               // Skill ID (Thunder Storm)
    AID: 2689,              // Skill object ID (not player!)
    targetID: 110016758,
    startTime: 12345,
    attackMT: 500,
    attackedMT: 500,
    xPos: 164,              // Ground position X
    yPos: 223,              // Ground position Y
    damage: 5490,
    level: 10,
    count: 1,
    action: 8
}
```

### ZC.NOTIFY_GROUNDSKILL (0x117)

```javascript
{
    SKID: 21,               // Skill ID
    AID: 2000001,           // Player ID
    level: 10,
    xPos: 164,
    yPos: 223,
    startTime: 12345
}
// Note: No damage in this packet, just placement notification
```

## ES5 Compliance

### No ES6+ Features Used

✅ **Allowed:**

- `var` declarations
- `function` keyword
- `prototype` methods
- Callbacks
- AMD modules
- Object/Array methods (ES5)

❌ **Not Used:**

- `const` / `let`
- Arrow functions `=>`
- Template literals `` `${var}` ``
- Destructuring
- Classes
- Async/await
- Spread operator
- Default parameters
- Array/Object methods added after ES5

### Example ES5 Patterns

**Object iteration:**

```javascript
var skillName;
for (skillName in _tracking.skills) {
	var skill = _tracking.skills[skillName];
	// Process skill...
}
```

**Array iteration:**

```javascript
var i, count;
for (i = 0, count = skills.length; i < count; i++) {
	var skill = skills[i];
	// Process skill...
}
```

**Callbacks instead of promises:**

```javascript
setInterval(function () {
	self.updateDisplay();
}, 100);
```

## Performance Considerations

### Optimization Strategies

1. **Update Throttling**: UI updates only every 100ms instead of per-packet
2. **Efficient Sorting**: Skills sorted only during display update, not on each damage
3. **Context Cleanup**: Automatic cleanup of old skill context entries
4. **Minimal DOM Manipulation**: Skill list rebuilt efficiently with jQuery
5. **Number Formatting**: Cached regex pattern for comma separation

### Memory Management

- Original `Network.sendPacket` function is preserved and restored on unhook
- Skill context map is automatically cleaned up (60 second timeout)
- Event listeners are properly removed on component removal
- Update interval is cleared when tracking stops
- Preferences are saved to localStorage (browser-managed)

## Debugging

### Console Logging

The plugin includes extensive debug logging:

```javascript
console.log('[DPSMeter] Setting up damage packet hooks...');
console.log('[DPSMeter] Intercepted skill usage:', skillName, 'SKID:', packet.SKID);
console.log('[DPSMeter] Received damage packet:', { ... });
console.log('[DPSMeter] Player GID:', playerGID, 'Attacker GID:', attackerGID);
console.log('[DPSMeter] Recorded damage for:', skillName, 'Damage:', damage);
```

### Common Debug Scenarios

**"Damage not tracked for ground skills"**

- Check console for "Ground skill placed" log
- Verify SKID is in `_recentSkills` map
- Check if damage packet has matching SKID
- Ensure player GID matches owner in skill context

**"Critical hits not showing"**

- Check damage packet `action` field (should be 10)
- Verify casts are auto-incrementing
- Look for "Critical" in skill list

**"Skills showing wrong name"**

- Verify SKID in SkillInfo database
- Check console for skill name resolution
- Ensure packet has correct SKID field

### Inspecting State

Access plugin state via console:

```javascript
// In browser developer console
// Note: Variables are private, but logs show state
```

Add temporary debug method during development:

```javascript
DPSMeter.getDebugInfo = function () {
	return {
		active: _tracking.active,
		totalDamage: _tracking.totalDamage,
		skillCount: Object.keys(_tracking.skills).length,
		contextSize: Object.keys(_recentSkills).length,
	};
};
```

## Known Limitations

### 1. Packet Version Compatibility

**Issue:** Different server versions use different packet structures.

**Impact:** Plugin may not work on very old or very new server versions without packet structure updates.

**Mitigation:** Hooks multiple packet variants (ACT, ACT2, ACT3, SKILL, SKILL2).

### 2. Skill Name Resolution

**Issue:** Skill names come from `SkillInfo` database which may be incomplete.

**Fallback:** Shows "Skill #[SKID]" if skill name not found.

**Impact:** Minor - all damage is still tracked correctly.

### 3. Multi-Target Skills

**Issue:** AOE skills generate multiple damage packets (one per target).

**Behavior:** Each damage instance is counted separately.

**Impact:** This is actually correct behavior - total damage to all targets is summed.

### 4. Party Member Filtering

**Issue:** Only player damage is tracked, party members are excluded.

**Why:** This is intentional for personal DPS tracking.

**Future:** Could add party-wide tracking mode.

## Testing Checklist

### Basic Functionality

- [ ] Plugin loads without errors
- [ ] Alt+D toggles window visibility
- [ ] Window can be dragged
- [ ] Window position persists across sessions

### Tracking Controls

- [ ] Start button begins tracking
- [ ] Stop button pauses tracking
- [ ] Reset button clears all data
- [ ] Time display counts up correctly
- [ ] DPS calculation is accurate

### Damage Types

- [ ] Normal attacks tracked (damage + casts)
- [ ] Critical hits tracked (damage + auto casts)
- [ ] Skills tracked (damage + casts)
- [ ] Skill crits show "(Crit)" modifier
- [ ] Multi-hit skills accumulate correctly

### Ground Skills

- [ ] Fire Wall damage tracked
- [ ] Storm Gust damage tracked
- [ ] Thunder Storm damage tracked
- [ ] Lord of Vermillion damage tracked
- [ ] Traps damage tracked (Hunter/Ranger)

### Display

- [ ] Skills sorted by percentage
- [ ] Cast counts show correctly
- [ ] Damage numbers formatted with commas
- [ ] Percentage adds up to ~100%
- [ ] UI updates smoothly

### Cleanup

- [ ] Plugin unloads cleanly
- [ ] No memory leaks after multiple start/stop cycles
- [ ] No lingering packet hooks after removal
- [ ] Console logs stop after removal

## Future Enhancements

### Potential Improvements

1. **Packet 0xb1a Support**
    - Register and decode packet 0xb1a
    - May provide better ground skill attribution
    - Research official packet structure

2. **Advanced Statistics**
    - Damage per minute (DPM)
    - Burst damage windows (peak DPS)
    - Average damage per cast
    - Skill efficiency (damage per SP)
    - Miss rate tracking

3. **Session History**
    - Save damage logs to localStorage
    - View historical sessions
    - Compare performance over time
    - Export to JSON

4. **Visual Enhancements**
    - Damage type color coding
    - Real-time DPS graph
    - Damage distribution pie chart
    - Smooth animations for updates
    - Skill icons

5. **Party Mode**
    - Track party member damage
    - Comparative DPS meters
    - Party contribution percentages
    - Top damager highlights

6. **Buff Tracking**
    - Track damage with/without buffs
    - Correlate damage spikes with buff timings
    - Buff contribution analysis

7. **Target Information**
    - Track damage per monster type
    - Monster damage breakdown
    - Most damaged targets

## Code Style Notes

### Naming Conventions

- **Components**: PascalCase (`DPSMeter`)
- **Functions**: camelCase (`updateDisplay`, `recordDamage`)
- **Variables**: camelCase (`totalDamage`, `playerGID`)
- **Constants**: UPPER_SNAKE_CASE (`SKILL_CONTEXT_MAX_AGE`)
- **Private vars**: Leading underscore (`_tracking`, `_recentSkills`)
- **Packets**: UPPER with dots (`PACKET.ZC.NOTIFY_ACT`)

### Function Documentation

All public functions include JSDoc comments:

```javascript
/**
 * Handle damage packet from server
 *
 * @param {object} pkt - Packet data
 * @param {string} type - Packet type ('NOTIFY_ACT' or 'NOTIFY_SKILL')
 */
DPSMeter.handleDamagePacket = function handleDamagePacket(pkt, type) {
	// Implementation...
};
```

### Error Handling

Defensive programming with validation:

```javascript
if (!_tracking.active || !pkt || !pkt.damage || pkt.damage <= 0) {
	return;
}
```

## Contributing

### Submitting Changes

1. Follow ES5 coding standards
2. Add JSDoc comments for all functions
3. Test with multiple skills and scenarios
4. Update documentation
5. Check for memory leaks
6. Add debug logging for new features

### Code Review Checklist

- [ ] ES5 compliant (no ES6+ features)
- [ ] AMD module structure maintained
- [ ] Error handling included
- [ ] Memory cleanup implemented
- [ ] Documentation updated
- [ ] Debug logging included
- [ ] Consistent code style
- [ ] Tested in-game with various skills
- [ ] No console errors

## Version History

### Version 1.0 (Initial)

- Basic damage tracking
- Client-side rendering hooks

### Version 2.0 (Current)

- **Major refactor**: Server packet-based tracking
- Ground skill support (Fire Wall, Storm Gust, etc.)
- Accurate source filtering (player only)
- Cast count tracking
- Critical hit auto-counting
- Skill name resolution via SKID
- Improved accuracy and reliability

## License

This plugin is part of ROBrowser and follows the same license terms.

## Credits

- Built for ROBrowser Legacy
- Uses ROBrowser's network packet system
- Compatible with RequireJS AMD loader
- Follows ROBrowser ES5 coding standards
