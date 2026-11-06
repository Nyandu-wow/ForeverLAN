"""Load the shipping TOC and Lua 5.1 modules with small, offline WoW stubs."""
from pathlib import Path
from lupa.lua51 import LuaRuntime

ROOT = Path(__file__).resolve().parents[1]


def boot(saved="", receipts=""):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(r'''
clock = 1700000000
mockGUID, mockFirst, mockLast = "Player-1-TEST", "Alex", "River"
mockZone, mockSubzone = "Elwynn Forest", "Goldshire"
function time() return clock end
function GetTime() return clock end
function UnitGUID() return mockGUID end
function UnitName() return mockFirst, mockLast end
function UnitFullName() return mockFirst .. " " .. mockLast, "Forever" end
function GetNormalizedRealmName() return "Forever" end
function UnitExists(unit) return unit == "player" end
function GetZoneText() return mockZone end
function GetSubZoneText() return mockSubzone end
function UnitLevel() return 10 end
function UnitClass() return "Warrior", "WARRIOR" end
function UnitRace() return "Human", "Human" end
function UnitIsDeadOrGhost() return false end
function UnitIsConnected() return true end
function UnitAffectingCombat() return false end
function InCombatLockdown() return false end
function IsInGroup() return false end
function GetNumGroupMembers() return 0 end
function wipe(t) for key in pairs(t) do t[key] = nil end end
local function noop() end
function CreateFrame()
  local frame = { scripts = {}, registered = {} }
  function frame:RegisterEvent(event) self.registered[event] = true end
  function frame:SetScript(kind, fn) self.scripts[kind] = fn end
  function frame:CreateTexture() return setmetatable({}, {__index=function() return noop end}) end
  frame.CreateFontString = frame.CreateTexture
  return setmetatable(frame, {__index=function() return noop end})
end
UIParent = {}
DEFAULT_CHAT_FRAME = { AddMessage = function() end }
SlashCmdList = {}
function dump(value)
  if type(value) == "table" then
    local parts = {}
    for key, val in pairs(value) do
      parts[#parts+1] = "[" .. dump(key) .. "]=" .. dump(val)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif type(value) == "string" then return string.format("%q", value)
  else return tostring(value) end
end
function savedVariables()
  return "ForeverLANDB=" .. dump(ForeverLANDB) .. "\nForeverLANCharDB=" .. dump(ForeverLANCharDB)
end
''')
    if saved:
        lua.execute(saved)
    env = None
    for line in (ROOT / "ForeverLAN.toc").read_text(encoding="utf-8-sig").splitlines():
        if line.strip().endswith(".lua"):
            lua.execute((ROOT / line.strip()).read_text(encoding="utf-8-sig"), "ForeverLAN")
            if line.strip() == "ForeverLAN.lua":
                env = lua.globals().ForeverLAN_Env
    if receipts:
        lua.execute(receipts)
    env.frame.scripts.OnEvent(env.frame, "ADDON_LOADED", "ForeverLAN")
    return lua, env


def event(lua, env, kind="PLAYER_CRAFT", **fields):
    return env.enqueue(kind, lua.table_from({
        "guid": lua.globals().mockGUID,
        "character": "Alex River", "is_self": True, **fields,
    }), lua.table_from({"silent": True}))
