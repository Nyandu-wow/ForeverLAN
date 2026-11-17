local _, A = ...
local queue, queued, lastRequest, lastHello, lastSnapshot = {}, {}, {}, {}, {}
local elapsed = 0

function A.wire(r)
    return table.concat({ "1", "E", tostring(r.rev), r.deleted and "1" or "0",
        r.mode, r.name, r.realm, r.note }, "|")
end

local function digest(bucket)
    local lines = {}
    for _, r in pairs(bucket or {}) do lines[#lines + 1] = A.wire(r) end
    table.sort(lines)
    local hash = 5381.0
    for _, line in ipairs(lines) do
        for i = 1, #line do hash = (hash * 33 + line:byte(i)) % 2147483647 end
        hash = (hash * 33 + 10) % 2147483647
    end
    return string.format("%.0f", hash)
end

local function enqueue(peer, text)
    if not A.store.friends[peer.key] or #text > 255 or #queue >= 4400 then return false end
    local id = peer.key .. "\t" .. text
    if queued[id] then return true end
    queued[id] = true
    queue[#queue + 1] = { peer = peer, text = text, id = id, attempts = 0 }
    return true
end

function A.sync()
    if not A.ready then return end
    local hash = digest(A.store.reports[A.me.key])
    for _, peer in pairs(A.store.friends) do enqueue(peer, "1|H|" .. hash) end
end

function A.broadcast(r)
    for _, peer in pairs(A.store.friends) do enqueue(peer, A.wire(r)) end
end

-- Never accept an author in a packet: Blizzard's sender is the report owner.
-- Friends share their own reports only. A third party cannot impersonate A.
function A.receive(prefix, text, channel, sender)
    if not A.ready or not A.plain(prefix, "string") or prefix ~= A.PREFIX then return end
    if not A.plain(channel, "string") or channel ~= "WHISPER" then return end
    if not A.plain(text, "string") or #text > 255 then return end
    local who = A.sender(sender)
    local peer = who and A.store.friends[who.key]
    if not peer or who.key == A.me.key then return end
    local now = A.clock()
    local hash = text:match("^1|H|(%d+)$")
    if hash then
        if digest(A.store.reports[who.key]) ~= hash and (not now or not lastRequest[who.key] or now - lastRequest[who.key] >= 30) then
            if now then lastRequest[who.key] = now end
            enqueue(peer, "1|Q")
        end
        -- Reply once per minute so a newly logged-in friend also learns our hash.
        if not now or not lastHello[who.key] or now - lastHello[who.key] >= 60 then
            if now then lastHello[who.key] = now end
            enqueue(peer, "1|H|" .. digest(A.store.reports[A.me.key]))
        end
        return
    end
    if text == "1|Q" then
        if now and lastSnapshot[who.key] and now - lastSnapshot[who.key] < 60 then return end
        if now then lastSnapshot[who.key] = now end
        for _, r in pairs(A.store.reports[A.me.key]) do enqueue(peer, A.wire(r)) end
        return
    end
    local rev, deleted, mode, name, realm, note = text:match("^1|E|(%d+)|([01])|([^|]+)|([^|]+)|([^|]+)|([^|]*)$")
    if not rev then return end
    local r = { rev = tonumber(rev), deleted = deleted == "1", mode = mode, name = name, realm = realm, note = note }
    if A.merge(who.key, r) then
        local stamp = A.call(time)
        if A.plain(stamp, "number") then
            A.store.lastReceived = A.store.lastReceived or {}
            A.store.lastReceived[who.key] = stamp
        end
    end
end

function A.pump(dt)
    elapsed = elapsed + dt
    if elapsed < 0.3 then return end
    elapsed = 0
    if #queue == 0 or not A.ready then return end
    -- Keep the queue for later when WoW restricts messaging during combat.
    if A.flag(C_ChatInfo and C_ChatInfo.InChatMessagingLockdown) then return end
    if A.flag(C_ChatInfo and C_ChatInfo.AreOutgoingAddonChatMessagesRestricted) then return end
    local item = queue[1]
    if not A.store.friends[item.peer.key] then
        queued[item.id] = nil
        table.remove(queue, 1)
        return
    end
    if not C_ChatInfo or not C_ChatInfo.SendAddonMessage then return end
    -- Forever routes addon whispers to "First Last". A "-Realm" suffix is not the player name.
    local ok, result = pcall(C_ChatInfo.SendAddonMessage, A.PREFIX, item.text, "WHISPER", item.peer.name)
    -- Enum.SendAddonMessageResult.Success is 0. Older wrappers return nil. A missing enum
    -- must not treat that 0 as failure and drop the whisper.
    local success = ok and (result == nil or result == true or result == 0 or
        (Enum and Enum.SendAddonMessageResult and result == Enum.SendAddonMessageResult.Success))
    item.attempts = item.attempts + 1
    if success or item.attempts >= 3 then
        if success then A.lastSendError = nil else A.lastSendError = "Message deferred; next sync will retry." end
        queued[item.id] = nil
        table.remove(queue, 1)
    end
end

function A.pendingCount() return #queue end
