/**
 * Plugins/DPSMeter/DPSMeter.js
 *
 * DPS Meter Plugin - Track and display damage per second
 *
 * @author Vietlubu
 */
define(function (require) {
	"use strict";

	/**
	 * Dependencies
	 */
	var jQuery = require("Utils/jquery");
	var Preferences = require("Core/Preferences");
	var Renderer = require("Renderer/Renderer");
	var UIManager = require("UI/UIManager");
	var UIComponent = require("UI/UIComponent");
	var Events = require("Core/Events");
	var DB = require("DB/DBManager");
	var Session = require("Engine/SessionStorage");
	var Network = require("Network/NetworkManager");
	var PACKET = require("Network/PacketStructure");
	var SkillInfo = require("DB/Skills/SkillInfo");
	var htmlText = require("text!./DPSMeter.html");
	var cssText = require("text!./DPSMeter.css");

	/**
	 * Create Component
	 */
	var DPSMeter = new UIComponent("DPSMeter", htmlText, cssText);

	/**
	 * @var {Preferences} DPSMeter preferences
	 */
	var _preferences = Preferences.get(
		"DPSMeter",
		{
			x: 100,
			y: 100,
			show: false,
		},
		1.0,
	);

	/**
	 * DPS tracking state
	 */
	var _tracking = {
		active: false,
		startTime: 0,
		totalDamage: 0,
		skills: {},
		lastUpdateTime: 0,
	};

	/**
	 * Interval for updating display
	 */
	var _updateInterval = null;

	/**
	 * Original Damage.add function (backup)
	 */
	var _originalDamageAdd = null;

	/**
	 * Original Network.sendPacket function (backup)
	 */
	var _originalSendPacket = null;

	/**
	 * Recent skill usage context for correlating damage with skills
	 * Each entry: { skid, attackerGID, targetGID, timestamp, skillName }
	 */
	var _skillContext = [];

	/**
	 * Max age for skill context entries (milliseconds)
	 * Longer timeout to support ground skills like Fire Wall
	 */
	var SKILL_CONTEXT_MAX_AGE = 60000; // 60 seconds

	/**
	 * Track recently used skills by SKID for matching with damage
	 * Map: SKID -> { ownerGID, skillName, timestamp }
	 */
	var _recentSkills = {};

	/**
	 * Packet handlers backup
	 */
	var _packetHandlers = {
		onNotifyAct: null,
		onNotifySkill: null,
		onNotifySkillPosition: null,
	};

	/**
	 * Initialize UI
	 */
	DPSMeter.init = function init() {
		var self = this;

		// Make window draggable
		this.draggable(this.ui.find(".titlebar"));

		// Close button
		this.ui.find(".close").click(function () {
			self.toggle(false);
		});

		// Start button
		this.ui.find(".btn-start").click(function () {
			self.startTracking();
		});

		// Stop button
		this.ui.find(".btn-stop").click(function () {
			self.stopTracking();
		});

		// Reset button
		this.ui.find(".btn-reset").click(function () {
			self.resetTracking();
		});

		// Prevent mouse events from affecting game
		this.ui.mousedown(function (event) {
			event.stopImmediatePropagation();
			return false;
		});
	};

	/**
	 * When append to document
	 */
	DPSMeter.onAppend = function onAppend() {
		// Apply saved preferences
		this.ui.css({
			top: _preferences.y,
			left: _preferences.x,
		});

		if (_preferences.show) {
			this.ui.show();
		} else {
			this.ui.hide();
		}

		// Hook into damage packets from server (for damage tracking)
		console.log("[DPSMeter] Setting up damage packet hooks...");
		this.hookDamagePackets();

		// Hook skill usage packets (for cast counting)
		console.log("[DPSMeter] Setting up skill usage hooks...");
		this.hookSkillUsage();
	};

	/**
	 * When removed from document
	 */
	DPSMeter.onRemove = function onRemove() {
		// Save preferences
		_preferences.x = parseInt(this.ui.css("left"), 10);
		_preferences.y = parseInt(this.ui.css("top"), 10);
		_preferences.show = this.ui.is(":visible");
		_preferences.save();

		// Clean up
		this.stopTracking();
		this.unhookDamagePackets();
		this.unhookSkillUsage();
	};

	/**
	 * Hook into damage packets from server
	 * More reliable than client-side rendering hooks
	 */
	DPSMeter.hookDamagePackets = function hookDamagePackets() {
		var self = this;

		// Hook PACKET.ZC.NOTIFY_ACT - Normal attacks
		Network.hookPacket(PACKET.ZC.NOTIFY_ACT, function onNotifyAct(pkt) {
			self.handleDamagePacket(pkt, "NOTIFY_ACT");
		});

		// Hook PACKET.ZC.NOTIFY_ACT2
		Network.hookPacket(PACKET.ZC.NOTIFY_ACT2, function onNotifyAct2(pkt) {
			self.handleDamagePacket(pkt, "NOTIFY_ACT");
		});

		// Hook PACKET.ZC.NOTIFY_ACT3
		Network.hookPacket(PACKET.ZC.NOTIFY_ACT3, function onNotifyAct3(pkt) {
			self.handleDamagePacket(pkt, "NOTIFY_ACT");
		});

		// Hook PACKET.ZC.NOTIFY_SKILL - Skill damage
		Network.hookPacket(PACKET.ZC.NOTIFY_SKILL, function onNotifySkill(pkt) {
			self.handleDamagePacket(pkt, "NOTIFY_SKILL");
		});

		// Hook PACKET.ZC.NOTIFY_SKILL2
		Network.hookPacket(
			PACKET.ZC.NOTIFY_SKILL2,
			function onNotifySkill2(pkt) {
				self.handleDamagePacket(pkt, "NOTIFY_SKILL");
			},
		);

		// Hook PACKET.ZC.NOTIFY_SKILL_POSITION - Ground skill damage
		Network.hookPacket(
			PACKET.ZC.NOTIFY_SKILL_POSITION,
			function onNotifySkillPosition(pkt) {
				self.handleDamagePacket(pkt, "NOTIFY_SKILL");
			},
		);

		// Hook PACKET.ZC.NOTIFY_GROUNDSKILL - When ground skill is placed
		Network.hookPacket(
			PACKET.ZC.NOTIFY_GROUNDSKILL,
			function onNotifyGroundSkill(pkt) {
				console.log("[DPSMeter] Ground skill placed:", {
					SKID: pkt.SKID,
					AID: pkt.AID,
					level: pkt.level,
					xPos: pkt.xPos,
					yPos: pkt.yPos,
				});

				// Track ground skill by SKID
				var playerGID = Session.Entity.GID;
				var skillData = SkillInfo[pkt.SKID];
				var skillName =
					(skillData && skillData.SkillName) || "Skill #" + pkt.SKID;

				_recentSkills[pkt.SKID] = {
					ownerGID: playerGID,
					skillName: skillName,
					timestamp: Date.now(),
				};

				console.log(
					"[DPSMeter] Registered ground skill:",
					pkt.SKID,
					"->",
					skillName,
					"Owner:",
					playerGID,
				);

				// Clean up old entries (over 60 seconds)
				var now = Date.now();
				for (var skid in _recentSkills) {
					if (now - _recentSkills[skid].timestamp > 60000) {
						delete _recentSkills[skid];
					}
				}
			},
		);
	};

	/**
	 * Handle damage packet from server
	 *
	 * @param {object} pkt - Packet data
	 * @param {string} type - Packet type ('NOTIFY_ACT' or 'NOTIFY_SKILL')
	 */
	DPSMeter.handleDamagePacket = function handleDamagePacket(pkt, type) {
		if (!_tracking.active || !pkt) {
			return;
		}

		// Debug: Log all packet info
		console.log("[DPSMeter] Received damage packet:", {
			type: type,
			SKID: pkt.SKID,
			GID: pkt.GID,
			AID: pkt.AID,
			targetID: pkt.targetID,
			damage: pkt.damage,
			action: pkt.action,
			xPos: pkt.xPos,
			yPos: pkt.yPos,
		});

		if (!pkt.damage || pkt.damage <= 0) {
			console.log("[DPSMeter] Skipping - no damage or damage <= 0");
			return;
		}

		var playerGID = Session.Entity.GID;
		var attackerGID = pkt.GID || pkt.AID;

		console.log(
			"[DPSMeter] Player GID:",
			playerGID,
			"Attacker GID:",
			attackerGID,
		);

		// Check if damage is from player directly
		var isPlayerDamage = attackerGID === playerGID;

		// Check if damage is from a skill (by SKID) used by player
		var skillUsage = null;
		if (!isPlayerDamage && pkt.SKID && _recentSkills[pkt.SKID]) {
			skillUsage = _recentSkills[pkt.SKID];
			if (skillUsage.ownerGID === playerGID) {
				isPlayerDamage = true;
				console.log(
					"[DPSMeter] Damage from player's skill (SKID match):",
					skillUsage.skillName,
				);
			}
		}

		// Only track damage from player or player's skills
		if (!isPlayerDamage) {
			console.log("[DPSMeter] Skipping - not player damage");
			return;
		}

		var attackName;

		if (type === "NOTIFY_SKILL" && pkt.SKID) {
			// Skill damage - get skill name from SKID
			if (skillUsage) {
				// Use the skill name we stored when skill was used
				attackName = skillUsage.skillName;
			} else {
				// Regular skill - get from SKID
				var skillData = SkillInfo[pkt.SKID];
				attackName =
					(skillData && skillData.SkillName) || "Skill #" + pkt.SKID;
			}

			// Check for damage type modifiers from action flags
			if (pkt.action) {
				if (pkt.action === 10) {
					// Critical hit
					attackName += " (Crit)";
				}
			}

			console.log(
				"[DPSMeter] Skill damage:",
				attackName,
				"Damage:",
				pkt.damage,
			);
		} else {
			// Normal attack
			attackName = "Normal Attack";

			// Check action for critical
			if (pkt.action === 10) {
				attackName = "Critical";
			}

			console.log(
				"[DPSMeter] Normal attack damage:",
				attackName,
				"Damage:",
				pkt.damage,
			);
		}

		// Record the damage
		this.recordDamage(attackName, pkt.damage);
	};

	/**
	 * Hook Network.sendPacket to intercept outgoing skill/attack usage for cast counting
	 */
	DPSMeter.hookSkillUsage = function hookSkillUsage() {
		var self = this;

		// Backup original sendPacket if not already done
		if (!_originalSendPacket) {
			console.log(
				"[DPSMeter] Hooking Network.sendPacket for cast tracking",
			);
			_originalSendPacket = Network.sendPacket;

			// Wrap sendPacket
			Network.sendPacket = function (packet) {
				// Check if this is a skill usage packet (has valid SKID property)
				if (
					packet &&
					packet.SKID &&
					typeof packet.SKID === "number" &&
					packet.SKID > 0
				) {
					var skillData = SkillInfo[packet.SKID];
					var skillName =
						(skillData && skillData.SkillName) ||
						"Skill #" + packet.SKID;

					console.log(
						"[DPSMeter] Intercepted skill usage:",
						skillName,
						"SKID:",
						packet.SKID,
					);

					// Record skill cast for tracking
					if (
						_tracking.active &&
						skillName &&
						skillName !== "undefined"
					) {
						self.recordSkillCast(skillName);
					}

					// Track this skill usage by SKID for damage attribution
					var playerGID = Session.Entity.GID;
					_recentSkills[packet.SKID] = {
						ownerGID: playerGID,
						skillName: skillName,
						timestamp: Date.now(),
					};

					// Clean up old entries
					var now = Date.now();
					for (var skid in _recentSkills) {
						if (now - _recentSkills[skid].timestamp > 60000) {
							delete _recentSkills[skid];
						}
					}
				}
				// Check if this is a normal attack action (CZ.REQUEST_ACT, CZ.REQUEST_ACT2)
				else if (
					packet &&
					packet.action !== undefined &&
					packet.targetGID
				) {
					// This is an attack action packet
					if (packet.action === 0 || packet.action === 7) {
						console.log(
							"[DPSMeter] Intercepted normal attack action:",
							"Action:",
							packet.action,
						);

						// Record normal attack cast
						if (_tracking.active) {
							self.recordSkillCast("Normal Attack");
						}
					}
				}

				// Call original sendPacket
				return _originalSendPacket.call(Network, packet);
			};
		}
	};

	// getDamageTypeName is no longer needed with packet-based tracking
	// Keeping for backwards compatibility but not used

	/**
	 * Unhook damage packets
	 */
	DPSMeter.unhookDamagePackets = function unhookDamagePackets() {
		// Note: Network.hookPacket doesn't provide unhook mechanism
		// Packets will stop being processed when component is removed
	};

	/**
	 * Unhook skill usage interception
	 */
	DPSMeter.unhookSkillUsage = function unhookSkillUsage() {
		// Restore original Network.sendPacket function
		if (_originalSendPacket) {
			Network.sendPacket = _originalSendPacket;
			_originalSendPacket = null;
		}
	};

	/**
	 * Start tracking DPS
	 */
	DPSMeter.startTracking = function startTracking() {
		if (_tracking.active) {
			return;
		}

		console.log("[DPSMeter] Starting tracking...");
		_tracking.active = true;
		_tracking.startTime = Date.now();
		_tracking.lastUpdateTime = Date.now();

		// Visual feedback
		this.ui.find(".btn-start").addClass("active");

		// Start update loop
		var self = this;
		_updateInterval = setInterval(function () {
			self.updateDisplay();
		}, 100);
	};

	/**
	 * Stop tracking DPS
	 */
	DPSMeter.stopTracking = function stopTracking() {
		if (!_tracking.active) {
			return;
		}

		_tracking.active = false;

		// Visual feedback
		this.ui.find(".btn-start").removeClass("active");

		// Stop update loop
		if (_updateInterval !== null) {
			clearInterval(_updateInterval);
			_updateInterval = null;
		}

		// Final update
		this.updateDisplay();
	};

	/**
	 * Reset tracking data
	 */
	DPSMeter.resetTracking = function resetTracking() {
		var wasActive = _tracking.active;

		if (wasActive) {
			this.stopTracking();
		}

		_tracking.startTime = 0;
		_tracking.totalDamage = 0;
		_tracking.skills = {};
		_tracking.lastUpdateTime = 0;

		// Clear display
		this.ui.find("#dps-time").text("00:00");
		this.ui.find("#dps-total").text("0");
		this.ui.find("#dps-damage").text("0");
		this.ui.find("#dps-skills").empty();

		if (wasActive) {
			this.startTracking();
		}
	};

	/**
	 * Record skill cast (usage count)
	 *
	 * @param {string} skillName - Name of skill
	 */
	DPSMeter.recordSkillCast = function recordSkillCast(skillName) {
		if (!_tracking.active || !skillName || skillName === "undefined") {
			return;
		}

		if (!_tracking.skills[skillName]) {
			_tracking.skills[skillName] = {
				damage: 0,
				hits: 0,
				casts: 0,
			};
		}

		_tracking.skills[skillName].casts += 1;
		console.log(
			"[DPSMeter] Recorded cast for:",
			skillName,
			"Total casts:",
			_tracking.skills[skillName].casts,
		);
	};

	/**
	 * Record damage dealt
	 *
	 * @param {string} skillName - Name of skill or attack
	 * @param {number} damage - Amount of damage
	 */
	DPSMeter.recordDamage = function recordDamage(skillName, damage) {
		if (!_tracking.active) {
			return;
		}

		_tracking.totalDamage += damage;

		if (!_tracking.skills[skillName]) {
			_tracking.skills[skillName] = {
				damage: 0,
				hits: 0,
				casts: 0,
			};
		}

		_tracking.skills[skillName].damage += damage;
		_tracking.skills[skillName].hits += 1;

		console.log(
			"[DPSMeter] Recorded damage for:",
			skillName,
			"Damage:",
			damage,
			"Total damage:",
			_tracking.skills[skillName].damage,
		);

		// Auto-increment casts for Critical since it's counted per hit
		if (skillName === "Critical") {
			_tracking.skills[skillName].casts += 1;
		}
	};

	/**
	 * Update display with current stats
	 */
	DPSMeter.updateDisplay = function updateDisplay() {
		var currentTime = Date.now();
		var elapsedSeconds = (currentTime - _tracking.startTime) / 1000;

		// Update time display
		var minutes = Math.floor(elapsedSeconds / 60);
		var seconds = Math.floor(elapsedSeconds % 60);
		var timeStr = this.pad(minutes, 2) + ":" + this.pad(seconds, 2);
		this.ui.find("#dps-time").text(timeStr);

		// Calculate total DPS
		var totalDPS =
			elapsedSeconds > 0
				? Math.floor(_tracking.totalDamage / elapsedSeconds)
				: 0;
		this.ui.find("#dps-total").text(this.formatNumber(totalDPS));
		this.ui
			.find("#dps-damage")
			.text(this.formatNumber(_tracking.totalDamage));

		// Update skill list
		this.updateSkillList(elapsedSeconds, totalDPS);
	};

	/**
	 * Update skill list display
	 *
	 * @param {number} elapsedSeconds - Total elapsed time
	 * @param {number} totalDPS - Total DPS
	 */
	DPSMeter.updateSkillList = function updateSkillList(
		elapsedSeconds,
		totalDPS,
	) {
		var skillsContainer = this.ui.find("#dps-skills");
		var skills = [];

		// Convert skills object to array for sorting
		var skillName;
		for (skillName in _tracking.skills) {
			var skill = _tracking.skills[skillName];
			var skillDPS =
				elapsedSeconds > 0 ? skill.damage / elapsedSeconds : 0;
			var percentage =
				_tracking.totalDamage > 0
					? (skill.damage / _tracking.totalDamage) * 100
					: 0;

			skills.push({
				name: skillName,
				damage: skill.damage,
				hits: skill.hits,
				dps: skillDPS,
				percentage: percentage,
				casts: skill.casts || 0,
			});
		}

		// Sort by percentage (highest first)
		skills.sort(function (a, b) {
			return b.percentage - a.percentage;
		});

		// Clear and rebuild list
		skillsContainer.empty();

		var i, count;
		for (i = 0, count = skills.length; i < count; i++) {
			var skill = skills[i];
			var skillItem = jQuery('<div class="skill-item"></div>');

			skillItem.append(
				'<div class="skill-name" title="' +
					this.escapeHtml(skill.name) +
					'">' +
					this.escapeHtml(skill.name) +
					"</div>",
			);
			// Format casts display
			var castsDisplay = skill.casts;

			// List of damage modifiers that don't have separate casts (e.g., "Bash (Crit)")
			// TODO: Add "(Combo)" here if we decide to use it as modifier later
			var damageModifiers = ["(Crit)", "(Lucky)"];

			// Check if skill name contains damage modifiers
			// These modifiers don't have separate cast counts
			var hasDamageModifier = false;
			for (var m = 0; m < damageModifiers.length; m++) {
				if (skill.name.indexOf(damageModifiers[m]) !== -1) {
					hasDamageModifier = true;
					break;
				}
			}

			// Display "-" for skills with damage modifiers or zero casts, otherwise show the number
			if (hasDamageModifier || castsDisplay === 0) {
				castsDisplay = "-";
			}

			skillItem.append(
				'<div class="skill-casts">' + castsDisplay + "</div>",
			);

			skillItem.append(
				'<div class="skill-damage">' +
					this.formatNumber(skill.damage) +
					"</div>",
			);
			skillItem.append(
				'<div class="skill-dps">' +
					this.formatNumber(Math.floor(skill.dps)) +
					"</div>",
			);
			skillItem.append(
				'<div class="skill-percent">' +
					skill.percentage.toFixed(1) +
					"%</div>",
			);

			skillsContainer.append(skillItem);
		}
	};

	/**
	 * Toggle DPS Meter visibility
	 *
	 * @param {boolean} visible - Show or hide
	 */
	DPSMeter.toggle = function toggle(visible) {
		if (visible) {
			this.ui.show();
			this.focus();
		} else {
			this.ui.hide();
		}

		_preferences.show = visible;
		_preferences.save();
	};

	/**
	 * Format number with commas
	 *
	 * @param {number} num - Number to format
	 * @return {string} Formatted number
	 */
	DPSMeter.formatNumber = function formatNumber(num) {
		return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	};

	/**
	 * Pad number with leading zeros
	 *
	 * @param {number} num - Number to pad
	 * @param {number} size - Target size
	 * @return {string} Padded number
	 */
	DPSMeter.pad = function pad(num, size) {
		var s = num.toString();
		while (s.length < size) {
			s = "0" + s;
		}
		return s;
	};

	/**
	 * Escape HTML special characters
	 *
	 * @param {string} text - Text to escape
	 * @return {string} Escaped text
	 */
	DPSMeter.escapeHtml = function escapeHtml(text) {
		var map = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#039;",
		};
		return text.replace(/[&<>"']/g, function (m) {
			return map[m];
		});
	};

	/**
	 * Plugin initialization
	 *
	 * @param {object} params - Plugin parameters
	 * @return {boolean} Success
	 */
	return function init(params) {
		try {
			// Add to UI Manager
			UIManager.addComponent(DPSMeter);

			// Add to the page
			DPSMeter.prepare();
			DPSMeter.append();

			// Show if preference is set
			if (_preferences.show) {
				DPSMeter.toggle(true);
			}

			// Register shortcut to toggle (Alt+D)
			jQuery(window).on("keydown.dpsmeter", function (event) {
				if (event.altKey && event.which === 68) {
					// Alt+D
					event.preventDefault();
					DPSMeter.toggle(!DPSMeter.ui.is(":visible"));
				}
			});

			console.log("[DPSMeter] Plugin initialized successfully");
			console.log("[DPSMeter] Press Alt+D to toggle DPS Meter");
			console.log(
				"[DPSMeter] Intercepting Network.sendPacket for skill tracking",
			);

			return true;
		} catch (e) {
			console.error("[DPSMeter] Failed to initialize: " + e.message);
			console.error(e.stack);
			return false;
		}
	};
});
