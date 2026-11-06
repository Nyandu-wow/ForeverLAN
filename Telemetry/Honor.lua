setfenv(1, ForeverLAN_Env)

-- Match the game's localized HK credit, never generic bonus honor or kill blows.
local seenLines, lineOrder = {}, {}
local function honorPattern(template)
  if not isPlainString(template) or template == "" then return nil end
  local parts, i, hasName = { "^" }, 1, false
  while i <= #template do
    local rest = template:sub(i)
    local token = rest:match("^%%%d+%$[sd]") or rest:match("^%%[sd]")
    if token then
      local kind = token:sub(-1)
      parts[#parts + 1] = kind == "s" and ".+" or "%d+"
      hasName = hasName or kind == "s"
      i = i + #token
    elseif rest:sub(1, 2) == "%%" then
      parts[#parts + 1] = "%%"
      i = i + 2
    else
      parts[#parts + 1] = template:sub(i, i):gsub("(%W)", "%%%1")
      i = i + 1
    end
  end
  return hasName and (table.concat(parts) .. "$") or nil
end

function handleHonorCredit(message, lineId)
  if not isPlainString(message) then return false end
  local pattern = honorPattern(COMBATLOG_HONORGAIN)
  if not pattern or not message:match(pattern) then return false end
  local snap = snapshotUnit("player", {})
  if not snap or not isPlainString(snap.guid) or snap.guid == "" or not isPlainString(snap.character) or snap.character == "" then return false end
  lineId = plainNumber(lineId)
  if lineId and lineId > 0 and lineId == math.floor(lineId) then
    if seenLines[lineId] then return false end
  else
    lineId = nil
  end
  local db = charStore()
  local tracker = db.honor_tracker
  if type(tracker) ~= "table" or tracker.guid ~= snap.guid then
    tracker = { guid = snap.guid, key = snap.guid .. ":" .. tostring(now()) .. ":" .. tostring(seq + 1), observed = 0, started_at = now() }
    db.honor_tracker = tracker
  end
  tracker.observed = tracker.observed + 1
  enqueue("PLAYER_HONORABLE_KILLS", {
    guid = snap.guid, character = snap.character, realm = snap.realm,
    class = snap.class, is_self = true, hk_tracker = tracker.key,
    hk_observed = tracker.observed, hk_started_at = tracker.started_at, detection = "CHAT_MSG_COMBAT_HONOR_GAIN",
  }, { silent = true })
  if lineId then
    seenLines[lineId] = true
    lineOrder[#lineOrder + 1] = lineId
    if #lineOrder > 256 then seenLines[table.remove(lineOrder, 1)] = nil end
  end
  return true
end
