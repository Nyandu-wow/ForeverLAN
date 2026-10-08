setfenv(1, ForeverLAN_Env)

function closeCombatSegment()
  if not combat.entered_at then
    return
  end
  local delta = GetTime() - combat.entered_at
  if delta > 0 and delta < 3600 then
    combat.seconds = combat.seconds + delta
  end
  combat.entered_at = nil
end

function emitCombatTime(reason, silent)
  closeCombatSegment()
  if combat.seconds <= (combat.emitted or 0) and reason ~= "force" then
    return
  end
  if combat.seconds <= 0 then
    return
  end
  combat.emitted = combat.seconds
  local snap = snapshotUnit("player", {})
  enqueue("PLAYER_COMBAT_TIME", {
    character = snap and snap.character or UnitName("player") or "",
    realm = snap and snap.realm or "",
    class = snap and snap.class or "",
    guid = snap and snap.guid or playerGUID or "",
    level = snap and snap.level or UnitLevel("player") or 0,
    is_self = true,
    combat_seconds = math.floor(combat.seconds + 0.5),
    reason = reason or "tick",
  }, { silent = silent ~= false })
end

function qualityFromLootColor(color)
  if type(color) ~= "string" then
    return nil
  end
  local c = string.lower(color)
  -- Classic item link colors (with alpha prefix ff)
  if c == "ffa335ee" or c == "a335ee" then
    return 4
  end
  if c == "ff0070dd" or c == "0070dd" then
    return 3
  end
  return nil
end

function handleLootChat(msg)
  -- Same secret-string path as combat-log / tradeskill chat (party combat).
  if not isPlainString(msg) or msg == "" then
    return
  end
  if not (string.find(msg, "^You receive loot:") or string.find(msg, "^You receive item:")) then
    return
  end
  local link = string.match(msg, "|c%x+|Hitem:.-|h%[.-%]|h|r")
  if not link then
    return
  end
  local itemName, _, quality = GetItemInfo(link)
  if not itemName then
    itemName = string.match(link, "%[(.-)%]")
  end
  if type(quality) ~= "number" then
    local color = string.match(msg, "|c(%x%x%x%x%x%x%x%x)|Hitem:")
    quality = qualityFromLootColor(color)
  end
  if quality ~= 3 and quality ~= 4 then
    return
  end
  local snap = snapshotUnit("player", {})
  local eventType = quality == 4 and "PLAYER_LOOT_EPIC" or "PLAYER_LOOT_RARE"
  local itemId = nil
  local idStr = string.match(link, "item:(%d+)")
  if idStr then
    itemId = tonumber(idStr)
  end
  enqueue(eventType, {
    character = snap and snap.character or UnitName("player") or "",
    realm = snap and snap.realm or "",
    class = snap and snap.class or "",
    guid = snap and snap.guid or playerGUID or "",
    level = snap and snap.level or UnitLevel("player") or 0,
    zone = snap and snap.zone or "",
    is_self = true,
    item_name = itemName or "item",
    item_link = link,
    item_id = itemId,
    item_quality = quality,
    detection = "CHAT_MSG_LOOT",
  })
end

--- Forever zone-wide craft chat: "Name creates Item." Self only -> PLAYER_CRAFT.
function handleTradeskillChat(msg)
  -- Skip secret chat text (Forever SecretValues); comparing it throws while tainted.
  if not isPlainString(msg) or msg == "" then
    return
  end
  if not craftProbeIsSelfMessage(msg) then
    return
  end
  local item =
    string.match(msg, "^[Yy]ou create[sd]?%s+(.+)$")
    or string.match(msg, "^.- creates?%s+(.+)$")
  if not item then
    return
  end
  item = string.gsub(item, "%s+$", "")
  item = string.gsub(item, "%.$", "")
  -- Strip item links to plain name when present
  local linked = string.match(item, "|h%[(.-)%]|h")
  if linked then
    item = linked
  end
  if item == "" then
    return
  end
  local qty = 1
  local q, rest = string.match(item, "^(%d+)[xX]%s+(.+)$")
  if q and rest then
    qty = tonumber(q) or 1
    item = rest
  end
  local snap = snapshotUnit("player", {})
  enqueue("PLAYER_CRAFT", {
    character = snap and snap.character or UnitName("player") or "",
    realm = snap and snap.realm or "",
    class = snap and snap.class or "",
    guid = snap and snap.guid or playerGUID or "",
    level = snap and snap.level or UnitLevel("player") or 0,
    zone = snap and snap.zone or "",
    is_self = true,
    action = "create",
    item_name = item,
    quantity = qty,
    detection = "CHAT_MSG_TRADESKILLS",
  }, { silent = true })
end
