# DPS Meter Plugin

A real-time damage tracking plugin for ROBrowser that accurately tracks your damage per second (DPS) using server packet interception.

<img width="1320" height="932" alt="image" src="https://github.com/user-attachments/assets/d798d64a-a93f-4937-a37a-080496f41f7f" />

## Author

**Vietlubu**

- GitHub: [https://github.com/vietlubu](https://github.com/vietlubu)
- Discord: vietlubu

## Features

### Core Functionality

- **Real-time DPS tracking**: Track your damage output as you fight
- **Accurate source filtering**: Only tracks YOUR damage using server packet GID matching
- **Ground skill support**: Properly tracks Fire Wall, Storm Gust, traps, and other persistent skills
- **Time tracking**: See how long you've been in combat (MM:SS format)
- **Total damage counter**: View cumulative damage dealt

### Detailed Statistics

- **Skill breakdown**: See damage contribution of each skill and attack type
- **Cast counting**: Track how many times you used each skill
- **Hit counting**: Track number of damage instances per skill
- **Percentage breakdown**: View what percentage of your total damage each skill contributes
- **Per-skill DPS**: See DPS for individual skills
- **Auto-sorting**: Skills automatically sorted by damage percentage (highest to lowest)

### Advanced Features

- **Critical hit tracking**: Separate tracking for critical hits with auto-count
- **Multi-hit skills**: Properly accumulates damage from skills that hit multiple times
- **AOE damage**: Tracks total damage to all targets from area skills
- **Start/Stop/Reset controls**: Full control over tracking sessions
- **Persistent settings**: Window position and visibility saved between sessions
- **Keyboard shortcut**: Press `Alt+D` to toggle window

## Installation

1. Copy the `DPSMeter` folder to `src/Plugins/DPSMeter`
2. Add the plugin to your `ROBrowser` configuration:

```javascript
plugins: {
	DPSMeter: "DPSMeter/DPSMeter";
}
```

Or with explicit configuration:

```javascript
plugins: {
    DPSMeter: {
        path: 'DPSMeter/DPSMeter',
        pars: null
    }
}
```

## Usage

### Opening the DPS Meter

Press `Alt+D` to toggle the DPS Meter window on/off.

### Controls

- **Start**: Begin tracking damage
- **Stop**: Pause damage tracking (preserves current stats)
- **Reset**: Clear all stats and restart tracking

### Display Information

**Summary Section:**

- **Time**: Elapsed time since tracking started (MM:SS format)
- **Total DPS**: Your average damage per second
- **Total Damage**: Cumulative damage dealt

**Skill List (per row):**

- **Skill Name**: Name of skill or attack type
- **Casts**: Number of times used (or `-` for damage modifiers)
- **Damage**: Total damage dealt by that skill
- **DPS**: Average damage per second for that skill
- **%**: Percentage of total damage

### Understanding the Display

**Attack Types:**

- **Normal Attack**: Regular attacks (tracked: casts + damage)
- **Critical**: Critical hits from normal attacks (tracked: auto-counted + damage)
- **Skill Name**: Actual skill names from database (tracked: casts + damage)
- **Skill Name (Crit)**: Skill with critical hit (tracked: damage only, `-` for casts)

**Cast Count (`-` means):**

- Damage modifiers like "(Crit)" or "(Lucky)" - these are not separate actions
- Skills that haven't been used yet but have damage (shouldn't happen normally)

## Technical Details

### How It Works

The plugin uses **server packet interception** for accurate tracking:

1. **Outgoing Packets**: Hooks `Network.sendPacket` to detect when you use skills/attacks
2. **Incoming Packets**: Hooks damage packets from server (`ZC.NOTIFY_ACT`, `ZC.NOTIFY_SKILL`, etc.)
3. **SKID Matching**: Correlates damage with skills using Skill ID (SKID) within 60-second window
4. **GID Filtering**: Only tracks damage where attacker GID matches your character GID

**Supported Packet Types:**

- `ZC.NOTIFY_ACT` (0x8a) - Normal attack damage
- `ZC.NOTIFY_ACT2` (0x2e1) - Normal attack (variant)
- `ZC.NOTIFY_ACT3` (0x8c8) - Normal attack (variant)
- `ZC.NOTIFY_SKILL` (0x114) - Skill damage
- `ZC.NOTIFY_SKILL2` (0x1de) - Skill damage (variant)
- `ZC.NOTIFY_SKILL_POSITION` (0x115) - Ground skill damage
- `ZC.NOTIFY_GROUNDSKILL` (0x117) - Ground skill placement

### Ground Skills

The plugin properly handles ground/persistent skills that create separate entities:

**Supported Skills:**

- Fire Wall
- Storm Gust
- Lord of Vermillion
- Thunder Storm
- Meteor Storm
- Heaven's Drive
- Magnus Exorcismus
- All Hunter/Ranger traps
- And more...

**How:** Tracks skills by SKID (Skill ID) instead of entity AID, maintaining a 60-second context window to match damage packets with the original caster.

### ES5 Compatible

This plugin is written in **pure ES5 JavaScript**:

- No ES6+ features (no `const`, `let`, arrow functions, etc.)
- AMD module system with RequireJS
- Compatible with older browsers
- Follows ROBrowser Legacy coding standards

## Tips & Tricks

### Maximizing Accuracy

- Start tracking before engaging enemies
- Keep tracking active throughout the fight
- Reset between different test scenarios
- Stop tracking when taking breaks (preserves stats)

### Interpreting Stats

- **High % skills**: Your primary damage dealers
- **Low % but high casts**: Filler skills or utility
- **Critical %**: Shows effectiveness of crit builds
- **DPS per skill**: Identifies most efficient skills
- **Hits vs Casts**: Multi-hit skills show more hits than casts

### Dragging the Window

Click and hold the title bar to drag the window anywhere on screen. Position is automatically saved.

## Troubleshooting

### Plugin doesn't load

**Symptoms:** No window appears, Alt+D doesn't work

**Solutions:**

- Check browser console (F12) for error messages
- Verify plugin path is correct in configuration
- Ensure all files exist in `src/Plugins/DPSMeter/`
- Refresh page and try again

### Damage not tracking

**Symptoms:** Total damage stays at 0, no skills appear

**Solutions:**

- Click the **Start** button (tracking must be active)
- Verify you're dealing damage (damage numbers appear on screen)
- Check console for packet errors
- Ensure your character GID is registered (try relogging)

### Ground skills not tracked

**Symptoms:** Fire Wall, Storm Gust, etc. don't show damage

**Solutions:**

- Make sure you cast the skill AFTER starting tracking
- Check console for "Ground skill placed" message
- Verify packet `ZC.NOTIFY_GROUNDSKILL` is being received
- Try casting again (skill context may have expired)

### Window won't show

**Symptoms:** Alt+D doesn't toggle window

**Solutions:**

- Press Alt+D multiple times (toggles on/off)
- Check browser console for errors
- Open developer tools → Application → Local Storage → Clear DPSMeter preferences
- Refresh page

### Casts not counting

**Symptoms:** Casts column shows 0 or `-` when it shouldn't

**Solutions:**

- Ensure tracking was started BEFORE using skill
- Check if skill name has modifiers like "(Crit)" (these show `-`)
- Critical hits auto-count, but modifiers don't
- Verify outgoing packets are being intercepted (check console)

### Wrong skill names

**Symptoms:** Shows "Skill #123" instead of skill name

**Solutions:**

- Skill may not be in `SkillInfo` database
- Check if SKID is correct in packet
- This doesn't affect damage tracking, just display

## Known Limitations

### Server Version Compatibility

The plugin relies on packet structures that may vary between server versions. It hooks multiple packet variants to maximize compatibility, but very old or very new servers might use different structures.

### Party Damage

The plugin intentionally filters out party member damage to focus on YOUR personal DPS. Party-wide tracking is not currently supported.

### Skill Database

Skill names come from `DB/Skills/SkillInfo`. If a skill is missing from the database, it will show as "Skill #[ID]". Damage tracking still works correctly.

### Delayed Packets

There may be slight delays between skill usage and damage packets arriving. The plugin uses a 60-second context window to handle this, but extremely delayed damage might not be attributed correctly.

## Development

### File Structure

```
DPSMeter/
├── DPSMeter.js           # Main plugin logic (AMD module)
├── DPSMeter.html         # UI template
├── DPSMeter.css          # Styling
├── README.md             # This file (user documentation)
├── IMPLEMENTATION.md     # Technical implementation details
└── example-config.js     # Configuration example
```

### Dependencies

```javascript
var jQuery = require("Utils/jquery");
var Preferences = require("Core/Preferences");
var Network = require("Network/NetworkManager");
var PACKET = require("Network/PacketStructure");
var Session = require("Engine/SessionStorage");
var SkillInfo = require("DB/Skills/SkillInfo");
// ... and more
```

### Extending the Plugin

To add new features:

1. **Hook new packets**: Add hooks in `hookDamagePackets()`
2. **Track new data**: Extend `_tracking.skills` structure
3. **Update UI**: Modify `DPSMeter.html` and `updateDisplay()`
4. **Add styling**: Update `DPSMeter.css`

See `IMPLEMENTATION.md` for detailed technical documentation.

### Debug Logging

The plugin includes extensive console logging prefixed with `[DPSMeter]`:

```
[DPSMeter] Setting up damage packet hooks...
[DPSMeter] Intercepted skill usage: Fire Wall SKID: 18
[DPSMeter] Received damage packet: {...}
[DPSMeter] Player GID: 2000001 Attacker GID: 2000001
[DPSMeter] Recorded damage for: Fire Wall Damage: 1500
```

Use browser console (F12) to monitor plugin activity.

## Changelog

### Version 2.0 (Current)

- **Major refactor**: Server packet-based tracking
- Added ground skill support (Fire Wall, Storm Gust, etc.)
- Added accurate player damage filtering
- Added cast count tracking
- Added critical hit auto-counting
- Improved skill name resolution via SKID
- Fixed multi-hit skill tracking
- Enhanced debug logging

### Version 1.0 (Legacy)

- Initial release
- Client-side rendering hooks
- Basic damage tracking

## FAQ

**Q: Does this work with all skills?**
A: Yes, all skills that deal damage through standard packets are supported.

**Q: Can I track party damage?**
A: Not currently. The plugin only tracks your personal damage.

**Q: Why does Critical show a number for Casts?**
A: Critical hits are counted per occurrence, unlike modifiers like "(Crit)".

**Q: Does this affect game performance?**
A: Minimal impact. UI updates every 100ms, packet hooks are lightweight.

**Q: Can I export the data?**
A: Not yet, but it's a planned feature for future versions.

**Q: Does it work on mobile?**
A: If ROBrowser works on mobile, the plugin should too. Keyboard shortcut may not work.

## Support

For issues, questions, or suggestions:

1. Check this README and `IMPLEMENTATION.md`
2. Enable browser console and check for error messages
3. Report issues with console logs and steps to reproduce

## License

This plugin is part of ROBrowser and follows the same license terms.

## Credits

- Built for ROBrowser Legacy
- Uses ROBrowser's network packet system
- Compatible with RequireJS AMD loader
- ES5 compliant for maximum compatibility
