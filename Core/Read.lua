setfenv(1, ForeverLAN_Env)

function splitNameRealm(unit)
  local first, second, realmFromFull = fetchUnitNameParts(unit)
  local realm = realmFromFull ~= "" and realmFromFull or realmLabel()
  return parseForeverName(first, second, realm)
end

function safeCall(fn, ...)
  if not fn then
    return nil
  end
  local results = { pcall(fn, ...) }
  local ok = table.remove(results, 1)
  if not ok then
    return nil
  end
  return unpack(results)
end

--- Single read door for Forever APIs. Call sites should not touch Unit*/C_Map raw.
--- One table keeps the main chunk under WoW's 200-local limit.
api = { call = safeCall }

function api.exists(unit)
  if not unit or not UnitExists then
    return false
  end
  return UnitExists(unit) and true or false
end

function api.text(fn, ...)
  local v = api.call(fn, ...)
  if type(v) ~= "string" then
    return ""
  end
  return v
end

--- true/false from a unit predicate. On throw/nil, keep `fallback` (avoid fake deaths/offline).
function api.flag(fn, unit, fallback)
  local v = api.call(fn, unit)
  if v == nil then
    return fallback
  end
  return v and true or false
end

--- Forever can return "secret numbers" that taint arithmetic (SecretValues).
function isPlainNumber(v)
  if type(v) ~= "number" then
    return false
  end
  if issecretvalue and issecretvalue(v) then
    return false
  end
  if canaccessvalue and not canaccessvalue(v) then
    return false
  end
  return true
end

function plainNumber(v)
  if isPlainNumber(v) then
    return v
  end
  return nil
end

--- Forever can also mark chat / system text as a secret string; comparing it while
--- tainted throws ("attempt to compare ... a secret string value").
function isPlainString(v)
  if type(v) ~= "string" then
    return false
  end
  if issecretvalue and issecretvalue(v) then
    return false
  end
  if canaccessvalue and not canaccessvalue(v) then
    return false
  end
  return true
end

--- Sum plain numbers; nil terms count as 0. Any secret term -> nil (blocked).
function sumPlain(...)
  local total = 0
  local n = select("#", ...)
  for i = 1, n do
    local raw = select(i, ...)
    if raw ~= nil then
      local v = plainNumber(raw)
      if v == nil then
        return nil
      end
      total = total + v
    end
  end
  return total
end

function maxPlain(a, b)
  local pa, pb = plainNumber(a), plainNumber(b)
  if pa == nil then
    return pb
  end
  if pb == nil then
    return pa
  end
  if pa > pb then
    return pa
  end
  return pb
end

api.num = plainNumber

--- Primary + secondary professions for the local player only.
