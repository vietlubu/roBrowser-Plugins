/**
 * Example ROBrowser Configuration with DPS Meter Plugin
 *
 * Copy this configuration to your main ROBrowser config file
 * or use it as a reference to add the DPS Meter plugin
 */

var ROConfig = {
	// ... other config options ...

	/**
	 * Plugins Configuration
	 * Add DPS Meter plugin to track damage per second
	 */
	plugins: {
		// Simple configuration - just plugin path
		DPSMeter: 'Plugins/DPSMeter/DPSMeter',

		// OR with parameters (currently plugin doesn't use parameters, but this shows the format)
		// DPSMeter: {
		// 	path: 'Plugins/DPSMeter/DPSMeter',
		// 	pars: null
		// },

		// You can add other plugins here
		// OtherPlugin: 'Plugins/OtherPlugin/OtherPlugin'
	}

	// ... other config options ...
};

/**
 * Usage:
 * 1. Add the plugins configuration above to your ROBrowser config
 * 2. Reload the game
 * 3. Press Alt+D to toggle the DPS Meter window
 * 4. Click "Start" to begin tracking damage
 * 5. Fight monsters and watch your DPS statistics
 *
 * Controls:
 * - Start: Begin tracking damage
 * - Stop: Pause tracking (keeps current stats)
 * - Reset: Clear all stats and optionally restart
 *
 * The window can be dragged by its title bar
 * Window position is saved between sessions
 */
