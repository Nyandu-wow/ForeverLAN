--[[
  Forever LAN

  Local SavedVariables event log for a house LAN leveling weekend.
  Queues events on disk. Does not use the network.

  ForeverLANDB     - account settings
  ForeverLANCharDB - per-character pending queue (schema 3)

  Push LAN writes SavedVariables to disk (reload), then an optional external
  companion may read that file. LoggingCombat(true) and CopyToClipboard are
  never called (protected on Forever).
]]

local addonName = ...

-- Private chunk environment. SavedVariables and slash globals stay on _G
-- because the client reads those names itself.
local private = {}
local seen = {}
local WORLD = {
  ForeverLANDB = true,
  ForeverLANCharDB = true,
  SLASH_FOREVERLAN1 = true,
  SLASH_FOREVERLAN2 = true,
  ForeverLAN_OnAddonCompartmentClick = true,
}

local env = setmetatable({}, {
  __index = function(_, key)
    if seen[key] then
      return private[key]
    end
    return _G[key]
  end,
  __newindex = function(_, key, value)
    if WORLD[key] then
      _G[key] = value
      return
    end
    private[key] = value
    seen[key] = true
  end,
})

_G.ForeverLAN_Env = env
setfenv(1, env)

ADDON_NAME = addonName
ADDON_VERSION = "0.1.70"
SV_SCHEMA = 3
-- Optional friend-pack inject (ForeverLAN_Party.lua). CurseForge ships empty.
BUILTIN_ROSTER = (ForeverLAN_Party and ForeverLAN_Party.roster) or {}
BUILTIN_ALIASES = (ForeverLAN_Party and ForeverLAN_Party.aliases) or {}
PREFIX = "FOREVERLAN_CLIP|"
MAX_PENDING = 1500
-- Prefer dropping these when the queue is full.
DROP_UNDER_PRESSURE = {
  PLAYER_DISTANCE = true,
  PLAYER_FOOD_BUFF = true,
  PLAYER_MAP_OPENED = true,
  PLAYER_POWER_STATS = true,
  PLAYER_MONEY = true,
  PLAYER_QUESTS = true,
  PLAYER_PROFESSIONS = true,
  PLAYER_COMBAT_TIME = true,
  PLAYER_CRAFT = true,
  PING = true,
  WORLD_ENTER = true,
  POSITION_UPDATE = true,
}
-- Keep one pending row per type+guid (+ map_kind). Crafts stay one-per-action.
COALESCE_PENDING = {
  PLAYER_DISTANCE = true,
  PLAYER_FOOD_BUFF = true,
  PLAYER_MAP_OPENED = true,
  PLAYER_POWER_STATS = true,
  PLAYER_MONEY = true,
  PLAYER_QUESTS = true,
  PLAYER_PROFESSIONS = true,
  PLAYER_COMBAT_TIME = true,
  PING = true,
  WORLD_ENTER = true,
  POSITION_UPDATE = true,
}
ROSTER_POLL = 4.0
SELF_POLL = 8.0
TRAVEL_POLL = 2.0
MAX_STEP_YARDS = 80
MIN_STEP_YARDS = 0.4
DISTANCE_EMIT_YARDS = 120
JUMP_EMIT_EVERY = 8

SETTINGS_DEFAULTS = {
  show_push_button = true,
  lock_push_button = false,
  announce_events = false,
  startup_hints = false,
  push_reminders = true,
  show_minimap_button = false,
}

-- Account-wide (settings + migration leftovers).
ForeverLANDB = ForeverLANDB or {}
-- Per-character telemetry queue (WoW writes a separate SV file per character).
ForeverLANCharDB = ForeverLANCharDB or {}

-- One table for UI forwards - keeps the main chunk under WoW's 200-local limit.
ui = {
  settingsCategory = nil,
  flushBtn = nil,
  dock = nil,
  minimapBtn = nil,
  optionsFrame = nil,
  applyUiSettings = nil,
  refreshPushButton = nil,
  openOptionsPanel = nil,
  doPushLan = nil,
  positionMinimapButton = nil,
  printHelp = nil,
  printStatus = nil,
}
