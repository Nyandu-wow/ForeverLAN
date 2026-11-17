local _, A = ...
A.PREFIX = "FVendetta1"
A.MAX_REPORTS, A.MAX_FRIENDS = 200, 20
A.modes = { AVENGE = true, AVOID = true, WATCH = true }

-- Secret values throw on boolean tests, comparison, concatenation, and arithmetic.
-- issecretvalue itself is safe. type() is not consulted until the value is readable.
function A.plain(v, kind)
    if issecretvalue and issecretvalue(v) then return false end
    if canaccessvalue and not canaccessvalue(v) then return false end
    return type(v) == kind
end

function A.call(fn, ...)
    if type(fn) ~= "function" then return nil end
    local ok, a, b = pcall(fn, ...)
    if ok then return a, b end
end

local function utf8ok(s)
    local i, n = 1, #s
    while i <= n do
        local c = s:byte(i)
        local len = 1
        if c >= 0xC2 and c <= 0xDF then len = 2
        elseif c >= 0xE0 and c <= 0xEF then len = 3
        elseif c >= 0xF0 and c <= 0xF4 then len = 4
        elseif c >= 0x80 then return false end
        if i + len - 1 > n then return false end
        for j = 1, len - 1 do
            local cc = s:byte(i + j)
            if not cc or cc < 0x80 or cc > 0xBF then return false end
        end
        i = i + len
    end
    return true
end

-- Bound bytes on the wire; reject oversized or split UTF-8 rather than cutting a character.
function A.text(v, max)
    if not A.plain(v, "string") then return nil end
    v = v:gsub("[%c|]", " "):gsub("%s+", " "):match("^%s*(.-)%s*$")
    if #v > max or not utf8ok(v) then return nil end
    return v
end

-- Realm comes only from the realm APIs. Never boolean-test a secret return.
function A.realm()
    local r = A.call(GetNormalizedRealmName)
    if not (A.plain(r, "string") and r ~= "") then r = A.call(GetRealmName) end
    r = A.text(r, 48) or ""
    return (r:gsub("%s+", ""))
end

local function token(v)
    if A.plain(v, "string") and v ~= "" then return v end
end

-- Current Forever (1.60.1, build 70009+): UnitName, UnitNameUnmodified, and UnitFullName
-- return first name, surname. The second value is not a realm. Older builds sometimes
-- returned the full "First Last" plus a real realm. GetUnitName returns "First Last".
-- A single token is incomplete, so detection refuses it instead of matching the first name.
function A.unitName(unit)
    local realm = A.realm()
    local norm = realm:lower()
    local function fullFrom(first, second)
        first = token(first)
        if not first then return nil end
        local lower = first:lower()
        if lower == "unknown" or lower == "unknown entity" then return nil end
        if first:find("%s") then
            local body, suffix = first:match("^(.*)%-([^%-]+)$")
            if body and body:find("%s") and suffix and suffix:gsub("%s", ""):lower() == norm and norm ~= "" then
                return body
            end
            return first
        end
        second = token(second)
        if second and not second:find("[%s%-]") and second:gsub("%s", ""):lower() ~= norm then
            return first .. " " .. second
        end
    end
    local best, blocked = nil, false
    local function hidden(v)
        if v == nil then return false end
        if issecretvalue and issecretvalue(v) then return true end
        if canaccessvalue and not canaccessvalue(v) then return true end
        return false
    end
    -- One secret name component makes the unit inaccessible. Do not backfill it
    -- from a different call that happened to return a plain string.
    local function consider(first, second)
        if hidden(first) or hidden(second) then blocked = true end
        if blocked then return end
        local full = fullFrom(first, second)
        if full and full:find("%s") then best = best or full end
    end
    if type(GetUnitName) == "function" then consider(A.call(GetUnitName, unit, true)) end
    if type(UnitNameUnmodified) == "function" then consider(A.call(UnitNameUnmodified, unit)) end
    if type(UnitName) == "function" then consider(A.call(UnitName, unit)) end
    if type(UnitFullName) == "function" then consider(A.call(UnitFullName, unit)) end
    if blocked or not best then return nil end
    return A.identity(best, realm)
end

function A.identity(name, realm)
    name = A.text(name, 64)
    realm = A.text(realm or A.realm(), 48)
    if not name or name == "" or not realm or realm == "" then return nil end
    if name:find("[-;]") or name:lower() == "unknown" or name:lower() == "unknown entity" then return nil end
    local key = name:lower() .. "-" .. realm:gsub("%s", ""):lower()
    return { name = name, realm = realm, key = key }
end

-- Chat and addon senders are "First Last" or "First-Last". The hyphen is the surname.
-- A "-Realm" suffix is accepted only when it is our realm and the name already has a space.
function A.sender(name)
    if not A.plain(name, "string") then return nil end
    local realm = A.realm()
    local norm = realm:lower()
    local body, suffix = name:match("^(.*)%-([^%-]+)$")
    if body and suffix and body:find("%s") and norm ~= "" and suffix:gsub("%s", ""):lower() == norm then
        return A.identity(body, realm)
    end
    local first, last = name:match("^(%S+)%-(%S+)$")
    if first and last then return A.identity(first .. " " .. last, realm) end
    return A.identity(name, realm)
end

function A.clock()
    local t = A.call(GetTime)
    if A.plain(t, "number") then return t end
end

function A.personName(key)
    if A.me and key == A.me.key then return A.me.name end
    local friend = A.store and A.store.friends and A.store.friends[key]
    if type(friend) == "table" and A.plain(friend.name, "string") then return friend.name end
    local stored = A.store and A.store.owners and A.store.owners[key]
    if A.plain(stored, "string") then return stored end
    if not A.plain(key, "string") then return "Unknown" end
    return (key:match("^(.-)%-[^%-]+$")) or key
end

function A.count(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

function A.print(msg)
    if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cffff7055Vendetta|r: " .. msg) end
end

-- Early builds stored UnitFullName's surname in the realm field. Move those records
-- onto the real realm so a manual add and a nameplate hit the same enemy.
function A.repairStore()
    local realm = A.realm()
    local norm = realm:lower()
    if norm == "" or type(A.store) ~= "table" then return end
    local function bad(name, suffix)
        local last = A.plain(name, "string") and name:match("%s(%S+)$")
        return last and A.plain(suffix, "string") and last:lower() == suffix:gsub("%s", ""):lower() and last:lower() ~= norm
    end
    local function movedKey(name, suffix)
        if not bad(name, suffix) then return nil end
        local who = A.identity(name, realm)
        return who and who.key or nil
    end
    local reports = {}
    for owner, bucket in pairs(type(A.store.reports) == "table" and A.store.reports or {}) do
        local ownerName, ownerSuffix = owner:match("^(.*)%-([^%-]+)$")
        local newOwner = movedKey(ownerName, ownerSuffix) or owner
        local dest = reports[newOwner] or {}
        if type(bucket) == "table" then
            for key, r in pairs(bucket) do
                local place = key
                if type(r) == "table" and bad(r.name, r.realm) then
                    local enemy = movedKey(r.name, r.realm)
                    if enemy then r.realm = realm; place = enemy end
                end
                local prev = dest[place]
                if type(r) == "table" and (type(prev) ~= "table" or (tonumber(r.rev) or 0) > (tonumber(prev.rev) or 0)) then
                    dest[place] = r
                end
            end
        end
        reports[newOwner] = dest
    end
    local owners, friends = {}, {}
    for key, value in pairs(type(A.store.owners) == "table" and A.store.owners or {}) do
        local name, suffix = key:match("^(.*)%-([^%-]+)$")
        owners[movedKey(name, suffix) or key] = owners[movedKey(name, suffix) or key] or value
    end
    for key, peer in pairs(type(A.store.friends) == "table" and A.store.friends or {}) do
        local newKey = key
        if type(peer) == "table" and bad(peer.name, peer.realm) then
            local who = A.identity(peer.name, realm)
            if who then peer.realm, peer.key, newKey = realm, who.key, who.key end
        end
        friends[newKey] = peer
    end
    A.store.reports, A.store.owners, A.store.friends = reports, owners, friends
end

function A.init()
    ForeverVendettaDB = ForeverVendettaDB or {}
    A.db = ForeverVendettaDB
    if type(A.db.realms) ~= "table" then A.db.realms = {} end
    local realm = A.realm()
    if realm == "" then return false end
    local key = realm:lower()
    local store = A.db.realms[key]
    if type(store) ~= "table" then store = {} end
    if type(store.friends) ~= "table" then store.friends = {} end
    if type(store.reports) ~= "table" then store.reports = {} end
    if type(store.owners) ~= "table" then store.owners = {} end
    if type(store.settings) ~= "table" then store.settings = {} end
    A.db.realms[key] = store
    A.store = store
    A.me = A.unitName("player")
    if not A.me then return false end
    A.repairStore()
    A.store.owners[A.me.key] = A.me.name
    if type(A.store.reports[A.me.key]) ~= "table" then A.store.reports[A.me.key] = {} end
    local s = A.store.settings
    if s.sound == nil then s.sound = true end
    if s.banner == nil then s.banner = true end
    if s.instances == nil then s.instances = false end
    s.cooldown = tonumber(s.cooldown) or 60
    A.lastAlert, A.lastSeen = {}, {}
    A.ready = true
    return true
end

function A.changed()
    if A.refresh then A.refresh() end
end

function A.trust(name)
    local who = A.sender(name)
    if not who or who.key == A.me.key then return false, "Enter your friend's full character name." end
    if who.realm:gsub("%s", ""):lower() ~= A.realm():gsub("%s", ""):lower() then
        return false, "This first version shares with friends on your realm."
    end
    if not A.store.friends[who.key] and A.count(A.store.friends) >= A.MAX_FRIENDS then
        return false, "Friend limit reached (20)."
    end
    A.store.friends[who.key] = who
    A.changed()
    return true
end

function A.untrust(name)
    local who = A.sender(name)
    if not who then return false end
    A.store.friends[who.key] = nil
    if not A.store.owners[who.key] then A.store.reports[who.key] = nil end
    A.changed()
    return true
end

function A.validReport(r)
    return type(r) == "table" and A.plain(r.name, "string") and A.plain(r.realm, "string")
        and A.plain(r.note, "string") and A.identity(r.name, r.realm) ~= nil
        and A.text(r.name, 64) == r.name and A.text(r.realm, 48) == r.realm
        and A.plain(r.rev, "number") and r.rev >= 1 and r.rev <= 2147483647 and r.rev == math.floor(r.rev)
        and type(r.deleted) == "boolean" and A.modes[r.mode] == true
        and A.text(r.note, 96) == r.note
end

function A.flag(fn, ...)
    local value = A.call(fn, ...)
    return A.plain(value, "boolean") and value == true
end

function A.merge(owner, r)
    if not A.validReport(r) then return false end
    local who = A.identity(r.name, r.realm)
    local bucket = A.store.reports[owner] or {}
    local old = bucket[who.key]
    if old and old.rev >= r.rev then return false end
    -- Tombstones count towards this bound. Never evict a removal and revive stale data.
    if not old and A.count(bucket) >= A.MAX_REPORTS then return false end
    A.store.reports[owner] = bucket
    bucket[who.key] = r
    A.changed()
    return true
end

function A.report(name, note, mode, deleted, realm)
    local who = A.identity(name, realm)
    note, mode = A.text(note or "", 96), mode or "AVENGE"
    if not who or not note or not A.modes[mode] then return false, "Use a full name, a reason up to 96 bytes, and AVENGE / AVOID / WATCH." end
    local old = A.store.reports[A.me.key][who.key]
    local r = { name = who.name, realm = who.realm, note = note, mode = mode,
        rev = old and old.rev + 1 or 1, deleted = deleted == true }
    if not A.merge(A.me.key, r) then return false, "Report limit reached (200, including removals)." end
    if A.broadcast then A.broadcast(r) end
    return true
end

function A.targetReport(note, mode)
    if not A.flag(UnitIsPlayer, "target") or not A.flag(UnitIsEnemy, "player", "target") then
        return false, "Target an enemy player first."
    end
    local who = A.unitName("target")
    if not who then return false, "Target identity is unavailable. Try outside combat." end
    return A.report(who.name, note, mode, false, who.realm)
end

function A.entries()
    local rows = {}
    for owner, bucket in pairs(A.store.reports) do
        if A.store.owners[owner] or A.store.friends[owner] then
            for key, r in pairs(bucket) do
                if not r.deleted then
                    rows[#rows + 1] = { key = key, owner = owner, report = r }
                end
            end
        end
    end
    table.sort(rows, function(a, b)
        if a.key == b.key then return a.owner < b.owner end
        return a.key < b.key
    end)
    return rows
end

-- Forever full names are unique in the region. Match the name even when two clients'
-- realm strings differ (ruleset label versus an internal shard name).
function A.enemyName(key)
    if not A.plain(key, "string") then return nil end
    return (key:match("^(.*)%-[^%-]+$")) or key
end

function A.match(key)
    local name = A.enemyName(key)
    local matches = {}
    for owner, bucket in pairs(A.store.reports) do
        if name and (A.store.owners[owner] or A.store.friends[owner]) then
            for stored, r in pairs(bucket) do
                if A.enemyName(stored) == name and not r.deleted then
                    matches[#matches + 1] = { owner = owner, report = r }
                end
            end
        end
    end
    table.sort(matches, function(a, b) return a.owner < b.owner end)
    return matches
end

function A.playSound()
    -- Built-in raid warning; no bundled audio or external dependencies.
    local sound = SOUNDKIT and SOUNDKIT.RAID_WARNING or 8959
    A.call(PlaySound, sound, "Master")
end

function A.alert(name, matches, test)
    local first = matches[1]
    local msg = (test and "TEST - " or "") .. name .. " - " .. first.report.mode
    local detail = first.report.note ~= "" and first.report.note or "Listed enemy"
    detail = detail .. " (" .. A.personName(first.owner) .. ")"
    if #matches > 1 then detail = detail .. " + " .. (#matches - 1) .. " more report(s)" end
    A.print(msg .. ": " .. detail)
    if A.store.settings.sound then A.playSound() end
    if A.store.settings.banner and A.showBanner then A.showBanner(msg, detail) end
end

function A.detect(unit)
    if not A.ready then return end
    if not A.store.settings.instances and A.flag(IsInInstance) then return end
    if not A.flag(UnitIsPlayer, unit) or not A.flag(UnitIsEnemy, "player", unit) then return end
    local who = A.unitName(unit)
    if not who then return end
    local matches = A.match(who.key)
    if #matches == 0 then return end
    local now = A.clock()
    if not now then return end
    A.lastSeen[who.key] = now
    if A.lastAlert[who.key] and now - A.lastAlert[who.key] < A.store.settings.cooldown then return end
    A.lastAlert[who.key] = now
    A.alert(who.name, matches)
end
