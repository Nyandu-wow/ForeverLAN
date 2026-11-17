-- Standalone regression harness. No game install, SavedVariables, or network.
local ROOT = "addons/ForeverVendetta/"
local passed = 0
local function check(ok, msg) if not ok then error(msg or "assertion failed", 2) end end
local function eq(a, b, msg) check(a == b, (msg or "mismatch") .. ": " .. tostring(a) .. " ~= " .. tostring(b)) end

local function boot(name, saved, setup)
    local A, env, frames, out, messages, sounds = {}, {}, {}, {}, {}, {}
    local clock, lockdown, instance = 1000, false, false
    local enemy = { first = "Grim", last = "Reaper", realm = "Forever", enemy = true, player = true }
    setmetatable(env, { __index = _G })
    env._G = env
    env.SlashCmdList, env.UISpecialFrames = {}, {}
    env.UIParent = { GetWidth=function() return 1280 end, GetHeight=function() return 720 end }
    local widgets = {}
    local function widget(kind, parent, template)
        local w = { scripts = {}, shown = true, text = "", kind = kind, parent = parent,
            template = template, children = {}, enabled = true, x = 0, y = 0 }
        widgets[#widgets+1] = w
        if parent and parent.children then parent.children[#parent.children+1] = w end
        setmetatable(w, { __index = function(_, key)
            return function() end
        end })
        function w:SetScript(k, f) self.scripts[k] = f end
        function w:GetScript(k) return self.scripts[k] end
        function w:SetPoint(anchor, x, y)
            self.anchor = anchor
            if type(x)=="number" then self.x,self.y=x,-(y or 0) end
        end
        function w:SetSize(width,height) self.width,self.height=width,height end
        function w:SetWidth(width) self.width=width end
        function w:SetHeight(height) self.height=height end
        function w:SetScale(value) self.scale=value end
        function w:SetColorTexture(...) self.color={...} end
        function w:SetTextColor(...) self.textColor={...} end
        function w:SetFontObject(font) self.font=font end
        function w:SetChecked(value) self.checked=value end
        function w:GetChecked() return self.checked end
        function w:SetEnabled(value) self.enabled=value end
        function w:GetValue() return self.value end
        function w:SetValue(value)
            self.value=value
            if self.scripts.OnValueChanged then self.scripts.OnValueChanged(self,value) end
        end
        function w:SetScrollChild(child) self.scrollChild=child end
        function w:GetStringHeight() return math.max(14,math.ceil(#self.text / 43)*14) end
        function w:GetText() return self.text end
        function w:SetText(t) self.text = t; if self.scripts.OnTextChanged then self.scripts.OnTextChanged(self, false) end end
        function w:SetShown(v) self.shown = v end
        function w:Show() self.shown = true end
        function w:Hide()
            self.shown = false
            if self.scripts.OnHide then self.scripts.OnHide(self) end
        end
        function w:IsShown() return self.shown end
        function w:CreateFontString(_, _, font)
            local child=widget("FontString",self); child.font=font; return child
        end
        function w:CreateTexture(_,layer)
            local child=widget("Texture",self); child.layer=layer; return child
        end
        return w
    end
    env.CreateFrame = function(kind, globalName, parent, template)
        local w = widget(kind,parent,template); w.TitleText = widget("FontString",w)
        w.TitleText.isTemplateTitle=true
        frames[#frames + 1] = w
        if globalName then env[globalName] = w end
        return w
    end
    env.GetNormalizedRealmName = function() return "Forever" end
    env.UnitName = function(unit)
        if unit == "player" then return name:match("^(%S+)%s+(.+)$") end
        return enemy.first, enemy.last
    end
    env.UnitFullName = function(unit)
        if unit == "player" then return name, "Forever" end
        return enemy.first .. " " .. enemy.last, enemy.realm
    end
    env.UnitIsPlayer = function() return enemy.player end
    env.UnitIsEnemy = function() return enemy.enemy end
    env.IsInInstance = function() return instance end
    env.GetTime, env.time = function() return clock end, function() return clock end
    env.PlaySound = function(id, channel) sounds[#sounds + 1] = { id, channel } end
    env.DEFAULT_CHAT_FRAME = { AddMessage = function(_, msg) messages[#messages + 1] = msg end }
    env.C_ChatInfo = {
        RegisterAddonMessagePrefix = function() return true end,
        InChatMessagingLockdown = function() return lockdown end,
        SendAddonMessage = function(prefix, text, channel, target)
            out[#out + 1] = { prefix, text, channel, target }; return 0
        end,
    }
    env.Enum = { SendAddonMessageResult = { Success = 0 } }
    env.C_NamePlate = { GetNamePlates = function() return {} end }
    env.ForeverVendettaDB = saved
    if setup then setup(env) end
    for _, file in ipairs({ "Core.lua", "Comms.lua", "UI.lua", "Main.lua" }) do
        local chunk
        if _VERSION == "Lua 5.1" then chunk = assert(loadfile(ROOT .. file)); setfenv(chunk, env)
        else chunk = assert(loadfile(ROOT .. file, "t", env)) end
        chunk("ForeverVendetta", A)
    end
    local main = frames[1]
    main.scripts.OnEvent(main, "ADDON_LOADED", "ForeverVendetta")
    main.scripts.OnEvent(main, "PLAYER_LOGIN")
    return { a = A, env = env, out = out, messages = messages, sounds = sounds, frames = frames, enemy = enemy,
        advance = function(n) clock = clock + n end,
        lockdown = function(v) lockdown = v end,
        instance = function(v) instance = v end,
        event = function(event, ...) main.scripts.OnEvent(main, event, ...) end,
        tick = function(dt) main.scripts.OnUpdate(main, dt) end, widgets = widgets }
end

if VENDETTA_PREVIEW then return boot end

local function test(name, fn)
    fn(); passed = passed + 1; print("PASS " .. name)
end
local function deliver(from, to)
    for _ = 1, 1000 do if from.a.pendingCount() == 0 then break end; from.a.pump(0.31) end
    for _, msg in ipairs(from.out) do
        eq(msg[3], "WHISPER"); check(#msg[2] <= 255, "oversized addon packet")
        to.a.receive(msg[1], msg[2], msg[3], from.a.me.name .. "-Forever")
    end
    for i = #from.out, 1, -1 do from.out[i] = nil end
end

test("Forever surname and realm identity", function()
    local x = boot("Alice River")
    eq(x.a.me.name, "Alice River")
    eq(x.a.unitName("target").key, "grim reaper-forever")
    eq(x.a.sender("Alice River-Forever").key, x.a.me.key)
    x.enemy.first = "Grim Reaper"; x.enemy.last = "Reaper"
    eq(x.a.unitName("target").name, "Grim Reaper", "no duplicated surname")
end)

test("Mutual trust and peer catch-up after login", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    check(x.a.report("Grim Reaper", "Camped me three times", "AVOID"))
    check(x.a.trust("Bob Stone")); check(y.a.trust("Alice River"))
    y.a.sync()
    deliver(y, x); deliver(x, y); deliver(y, x); deliver(x, y)
    eq(#y.a.entries(), 1)
    eq(y.a.entries()[1].report.mode, "AVOID")
    eq(y.a.entries()[1].owner, x.a.me.key)
end)

test("Untrusted messages and other channels cannot change reports", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.report("Grim Reaper", "Reason")
    local wire = x.a.wire(x.a.entries()[1].report)
    y.a.receive(y.a.PREFIX, wire, "WHISPER", "Alice River-Forever")
    eq(#y.a.entries(), 0)
    y.a.trust("Alice River")
    y.a.receive(y.a.PREFIX, wire, "GUILD", "Alice River-Forever")
    eq(#y.a.entries(), 0)
    y.a.receive("OtherAddon", wire, "WHISPER", "Alice River-Forever")
    eq(#y.a.entries(), 0)
end)

test("Removal survives stale update, replay and reload", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    x.a.report("Grim Reaper", "Original")
    local stale = x.a.wire(x.a.entries()[1].report)
    deliver(x, y)
    x.a.report("Grim Reaper", "", "AVENGE", true); deliver(x, y)
    eq(#y.a.entries(), 0)
    local reload = boot("Bob Stone", y.env.ForeverVendettaDB)
    reload.a.receive(reload.a.PREFIX, stale, "WHISPER", "Alice River-Forever")
    eq(#reload.a.entries(), 0)
    eq(reload.a.store.reports[x.a.me.key]["grim reaper-forever"].rev, 2)
end)

test("Friends' reports remain independent", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    x.a.report("Grim Reaper", "Alice's reason"); y.a.report("Grim Reaper", "Bob's reason")
    deliver(x, y); eq(#y.a.match("grim reaper-forever"), 2)
    x.a.report("Grim Reaper", "", "AVENGE", true); deliver(x, y)
    eq(#y.a.match("grim reaper-forever"), 1)
    eq(y.a.match("grim reaper-forever")[1].report.note, "Bob's reason")
end)

test("Sound and banner, cooldown shared across unit tokens", function()
    local x = boot("Alice River")
    x.a.targetReport("Bad news", "AVOID")
    local banners = 0
    x.a.showBanner = function() banners = banners + 1 end
    x.event("NAME_PLATE_UNIT_ADDED", "nameplate1")
    x.event("PLAYER_TARGET_CHANGED")
    x.event("UPDATE_MOUSEOVER_UNIT")
    eq(#x.sounds, 1); eq(banners, 1)
    eq(x.sounds[1][2], "Master")
    x.advance(60); x.a.detect("focus")
    eq(#x.sounds, 2)
    x.a.store.settings.sound = false; x.advance(60); x.a.detect("target")
    eq(#x.sounds, 2); eq(banners, 3)
end)

test("Friendly units, NPCs, instances and inaccessible identities do not alert", function()
    local x = boot("Alice River")
    x.a.report("Grim Reaper", "Reason")
    x.enemy.enemy = false; x.a.detect("target")
    x.enemy.enemy = true; x.enemy.player = false; x.a.detect("target")
    x.enemy.player = true; x.instance(true); x.a.detect("target")
    x.instance(false)
    x.env.issecretvalue = function(v) return v == "Grim" end
    x.a.detect("target")
    eq(#x.sounds, 0)
    x.env.issecretvalue = function(v) return type(v) == "boolean" end
    x.a.detect("target"); eq(#x.sounds, 0)
end)

test("Untrust stops queued sends and hides received reports", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    x.a.report("Grim Reaper", "Reason"); deliver(x, y)
    eq(#y.a.entries(), 1)
    y.a.untrust("Alice River"); eq(#y.a.entries(), 0)
    x.a.report("Grim Reaper", "Updated")
    x.a.untrust("Bob Stone"); deliver(x, y)
    eq(#y.a.entries(), 0)
end)

test("Malformed payloads and invalid revisions are rejected", function()
    local x = boot("Alice River")
    x.a.trust("Bob Stone")
    for _, wire in ipairs({ "1|E|0|0|AVENGE|Grim Reaper|Forever|x", "1|E|999999999999|0|AVENGE|Grim Reaper|Forever|x",
        "1|E|1|0|WRONG|Grim Reaper|Forever|x", "1|E|1|0|AVENGE|Grim Reaper|Forever|x|fake author",
        "2|E|1|0|AVENGE|Grim Reaper|Forever|x", string.rep("x", 256) }) do
        x.a.receive(x.a.PREFIX, wire, "WHISPER", "Bob Stone-Forever")
    end
    eq(#x.a.entries(), 0)
    check(not x.a.validReport({ name = "Grim Reaper", realm = "Forever", mode = "AVENGE", rev = 1, deleted = false }))
    check(not x.a.report("Grim Reaper", string.rep("x", 97)))
end)

test("Combat messaging lockdown preserves the send queue", function()
    local x = boot("Alice River")
    x.a.trust("Bob Stone"); x.a.report("Grim Reaper", "Reason")
    x.lockdown(true); x.a.pump(1)
    eq(#x.out, 0); eq(x.a.pendingCount(), 1)
    x.lockdown(false); x.a.pump(1)
    eq(#x.out, 1); eq(x.a.pendingCount(), 0)
end)

test("Repeated sync coalesces and hello responses do not loop", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    for _ = 1, 100 do x.a.sync() end
    eq(x.a.pendingCount(), 1)
    for _ = 1, 5 do deliver(x, y); deliver(y, x) end
    eq(x.a.pendingCount(), 0); eq(y.a.pendingCount(), 0)
end)

test("Periodic reconciliation repairs a dropped update", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    x.a.report("Grim Reaper", "Missed update")
    x.a.pump(1)
    for i = #x.out, 1, -1 do x.out[i] = nil end -- Simulate packet loss.
    eq(#y.a.entries(), 0)
    x.advance(120); y.advance(120)
    x.a.sync(); deliver(x, y); deliver(y, x); deliver(x, y)
    eq(#y.a.entries(), 1)
end)

test("Failed sends are bounded and can recover on a later sync", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    x.a.report("Grim Reaper", "Reason")
    local send = x.env.C_ChatInfo.SendAddonMessage
    local attempts = 0
    x.env.C_ChatInfo.SendAddonMessage = function() attempts = attempts + 1; return 7 end
    for _ = 1, 10 do x.a.pump(1) end
    eq(attempts, 3); eq(x.a.pendingCount(), 0); check(x.a.lastSendError ~= nil)
    x.env.C_ChatInfo.SendAddonMessage = send
    x.a.sync(); deliver(x, y); deliver(y, x); deliver(x, y)
    eq(#y.a.entries(), 1)
end)

test("Record bound keeps tombstones without evicting reports", function()
    local x = boot("Alice River")
    x.a.MAX_REPORTS = 2
    check(x.a.report("Enemy One", "x")); check(x.a.report("Enemy Two", "x"))
    check(x.a.report("Enemy One", "", "WATCH", true))
    check(not x.a.report("Enemy Three", "x"))
    eq(x.a.count(x.a.store.reports[x.a.me.key]), 2)
end)

test("Maximum-size packets stay within WoW's message bound", function()
    local x = boot("Alice River")
    check(x.a.report(string.rep("a", 64), string.rep("b", 96), "AVENGE", false, string.rep("c", 48)))
    check(#x.a.wire(x.a.entries()[1].report) <= 255)
end)

test("Native windows and slash commands construct and refresh", function()
    local x = boot("Alice River")
    local cmd = x.env.SlashCmdList.FOREVERVENDETTA
    cmd(""); check(x.env.ForeverVendettaWindow:IsShown())
    cmd("add Grim Reaper; Test reason")
    eq(#x.a.entries(), 1)
    cmd("friends"); check(x.env.ForeverVendettaFriends:IsShown())
    check(x.env.ForeverVendettaWindow:IsShown(), "friends stay inside the main window")
    cmd("trust Bob Stone"); eq(x.a.count(x.a.store.friends), 1)
    cmd("sound off"); eq(x.a.store.settings.sound, false)
    cmd("cooldown 30"); eq(x.a.store.settings.cooldown, 30)
    cmd("test"); eq(#x.sounds, 0)
    cmd("remove Grim Reaper"); eq(#x.a.entries(), 0)
    cmd(""); check(not x.env.ForeverVendettaWindow:IsShown())
    check(not x.env.ForeverVendettaFriends:IsShown())
end)

test("Current Forever surname is not stored as the realm", function()
    local x = boot("Alice River", nil, function(env)
        env.GetNormalizedRealmName = function() return "Classic Beta PvE" end
        env.GetUnitName = function(unit)
            if unit == "player" then return "Alice River" end
            return "Grim Reaper"
        end
        env.UnitName = function(unit)
            if unit == "player" then return "Alice", "River" end
            return "Grim", "Reaper"
        end
        env.UnitNameUnmodified = function(unit)
            if unit == "player" then return nil end
            return "Grim", "Reaper"
        end
        env.UnitFullName = function(unit)
            if unit == "player" then return "Alice", "River" end
            return "Grim", "Reaper"
        end
    end)
    eq(x.a.me.name, "Alice River")
    eq(x.a.me.realm, "ClassicBetaPvE")
    local who = x.a.unitName("target")
    eq(who.name, "Grim Reaper")
    eq(who.realm, "ClassicBetaPvE", "surname must not become the realm")
    eq(who.key, "grim reaper-classicbetapve")
    check(x.a.report("Grim Reaper", "manual"))
    check(x.a.targetReport("from target", "WATCH"))
    eq(x.a.count(x.a.store.reports[x.a.me.key]), 1, "manual add and target add are one enemy")
    eq(x.a.entries()[1].report.rev, 2)
    eq(x.a.entries()[1].report.realm, "ClassicBetaPvE")
end)

test("Secret realm falls back and a secret surname is not a first name", function()
    local x = boot("Alice River", nil, function(env)
        env.GetNormalizedRealmName = function() return "HIDDEN" end
        env.GetRealmName = function() return "Forever" end
        env.issecretvalue = function(v) return v == "HIDDEN" end
    end)
    eq(x.a.me.realm, "Forever")
    eq(x.a.unitName("target").name, "Grim Reaper")
    x.env.issecretvalue = function(v) return v == "Reaper" end
    x.env.UnitName = function() return "Grim", "Reaper" end
    x.env.UnitFullName = function() return "Grim", "Reaper" end
    x.env.GetUnitName = function() return "Grim" end
    eq(x.a.unitName("target"), nil)
    x.env.issecretvalue = function() return false end
    x.env.GetUnitName = function() return "Grim" end
    x.env.UnitName = function() return "Grim" end
    x.env.UnitFullName = function() return "Grim" end
    eq(x.a.unitName("target"), nil, "first name alone is not an identity")
end)

test("Hyphenated addon senders are surnames and whispers use the full name", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    check(x.a.trust("Bob-Stone"))
    check(y.a.trust("Alice River"))
    eq(x.a.store.friends[y.a.me.key].name, "Bob Stone")
    x.a.report("Grim Reaper", "Camped", "AVOID")
    x.a.pump(1)
    eq(x.out[1][4], "Bob Stone")
    y.a.receive(x.out[1][1], x.out[1][2], x.out[1][3], "Alice-River")
    eq(#y.a.entries(), 1)
    eq(y.a.entries()[1].owner, x.a.me.key)
    eq(y.a.entries()[1].report.note, "Camped")
    y.a.receive(y.a.PREFIX, x.out[1][2], "WHISPER", "Mallory-Vex")
    eq(#y.a.entries(), 1)
    y.a.detect("target")
    check(y.messages[#y.messages]:find("Alice River", 1, true) ~= nil)
    check(y.messages[#y.messages]:find("alice river-forever", 1, true) == nil)
end)

test("A surname saved as the realm is repaired before detection", function()
    local saved = { realms = { forever = {
        friends = {}, settings = {},
        owners = { ["alice river-river"] = true },
        reports = { ["alice river-river"] = {
            ["grim reaper-reaper"] = {
                name = "Grim Reaper", realm = "Reaper", note = "Camped", mode = "AVOID",
                rev = 3, deleted = false,
            },
        } },
    } } }
    local x = boot("Alice River", saved)
    eq(x.a.store.reports["alice river-river"], nil)
    eq(x.a.store.reports[x.a.me.key]["grim reaper-forever"].rev, 3)
    eq(x.a.store.reports[x.a.me.key]["grim reaper-forever"].realm, "Forever")
    x.a.detect("target")
    eq(#x.sounds, 1)
end)

test("Numeric addon-message success survives a missing result enum", function()
    local x = boot("Alice River")
    x.a.trust("Bob Stone")
    x.a.report("Grim Reaper", "Reason")
    x.env.Enum = nil
    x.env.C_ChatInfo.SendAddonMessage = function() return 0 end
    x.a.pump(1)
    eq(x.a.pendingCount(), 0)
    eq(x.a.lastSendError, nil)
end)

test("A newly received report warns on the next scan and then cools down", function()
    local x, y = boot("Alice River"), boot("Bob Stone")
    x.a.trust("Bob Stone"); y.a.trust("Alice River")
    x.a.report("Grim Reaper", "Camped", "AVOID")
    deliver(x, y)
    eq(#y.sounds, 0)
    y.tick(0.2)
    eq(#y.sounds, 0)
    y.tick(1)
    eq(#y.sounds, 1)
    y.tick(1)
    eq(#y.sounds, 1)
end)

test("Instance alerts stay off until enabled", function()
    local x = boot("Alice River")
    x.a.report("Grim Reaper", "Reason")
    x.instance(true)
    x.a.detect("target")
    eq(#x.sounds, 0)
    x.env.SlashCmdList.FOREVERVENDETTA("instances on")
    x.a.detect("target")
    eq(#x.sounds, 1)
end)

test("Split UTF-8 is rejected and intact UTF-8 is kept", function()
    local x = boot("Alice River")
    check(not x.a.report("Grim Reaper", "bad\194"))
    eq(#x.a.entries(), 0)
    check(x.a.report("Grim Reaper", "caf\195\169"))
    eq(x.a.entries()[1].report.note, "caf\195\169")
end)

test("A different realm string still warns for the same full name", function()
    local x = boot("Alice River")
    check(x.a.merge(x.a.me.key, {
        name = "Grim Reaper", realm = "ClassicBetaPvE", note = "Camped", mode = "AVOID", rev = 1, deleted = false,
    }))
    eq(x.a.store.reports[x.a.me.key]["grim reaper-classicbetapve"].note, "Camped")
    x.a.detect("target")
    eq(#x.sounds, 1)
end)

test("Banner stays up for six seconds and then hides", function()
    local x = boot("Alice River")
    x.a.showBanner("Grim Reaper", "Camped")
    local banner = x.frames[#x.frames]
    eq(banner.shown, true)
    eq(banner.remaining, 6)
    banner.scripts.OnUpdate(banner, 5)
    eq(banner.shown, true)
    banner.scripts.OnUpdate(banner, 1)
    eq(banner.shown, false)
end)

local function visible(w)
    while w do if w.shown==false then return false end; w=w.parent end
    return true
end
local function findWidget(x, kind, caption, predicate)
    for _,w in ipairs(x.widgets) do
        local title=w.text:gsub("|c%x%x%x%x%x%x%x%x",""):gsub("|r","")
        if w.kind==kind and (not caption or title==caption) and visible(w) and (not predicate or predicate(w)) then return w end
    end
    error("Missing visible "..kind..": "..tostring(caption))
end
local function click(x,caption,predicate)
    local b=findWidget(x,"Button",caption,predicate)
    check(b.enabled,"disabled button: "..caption); b.scripts.OnClick(b); return b
end
local function editors(x)
    local fields={}
    for _,w in ipairs(x.widgets) do if w.kind=="EditBox" and visible(w) then fields[#fields+1]=w end end
    return fields
end

test("Blacklist groups reports and preserves independent reasons",function()
    local x=boot("Alice River")
    x.a.trust("Bob Stone")
    x.a.merge("bob stone-forever",{name="Grim Reaper",realm="Forever",note="Bob was camped",mode="AVOID",rev=1,deleted=false})
    x.a.toggle()
    local row=findWidget(x,"Button",nil,function(w) return type(w.group)=="table" end)
    eq(#row.group.reports,1); row.scripts.OnClick(row)
    local fields=editors(x)
    eq(fields[2]:GetText(),"Grim Reaper"); eq(fields[3]:GetText(),"","friend reason must not become your reason")
    check(not findWidget(x,"Button","Withdraw mine").enabled)
    fields[3]:SetText("My own reason"); click(x,"Save report")
    eq(#x.a.entries(),2)
    row=findWidget(x,"Button",nil,function(w) return type(w.group)=="table" end)
    eq(#row.group.reports,2,"one enemy with two reports")
    click(x,"Withdraw mine"); eq(#x.a.entries(),2,"first click only arms removal")
    click(x,"Confirm removal"); eq(#x.a.entries(),1)
    eq(x.a.entries()[1].report.note,"Bob was camped")
end)

test("Search, stance filters and paging have bounded navigation",function()
    local x=boot("Alice River")
    for i=1,7 do x.a.report("Enemy Number"..i,"Reason "..i,i==7 and "AVOID" or "AVENGE") end
    x.a.toggle()
    check(not findWidget(x,"Button","Previous").enabled)
    click(x,"Next"); check(not findWidget(x,"Button","Next").enabled)
    click(x,"Avoid",function(w) return w.width==107 end)
    local row=findWidget(x,"Button",nil,function(w) return type(w.group)=="table" end)
    eq(row.group.name,"Enemy Number7")
    local search=editors(x)[1]; search:SetText("nobody matches")
    eq(findWidget(x,"FontString","No enemies match"):GetText(),"No enemies match")
    click(x,"Clear search"); eq(search:GetText(),"")
end)

test("Incoming refresh preserves an unsaved draft",function()
    local x=boot("Alice River")
    x.a.toggle(); click(x,"Add target")
    local fields=editors(x); fields[3]:SetText("Still writing this reason")
    x.a.trust("Bob Stone")
    x.a.merge("bob stone-forever",{name="Other Enemy",realm="Forever",note="Friend report",mode="WATCH",rev=1,deleted=false})
    eq(fields[2]:GetText(),"Grim Reaper"); eq(fields[3]:GetText(),"Still writing this reason")
end)

test("Friends setup validates full names and removal needs confirmation",function()
    local x=boot("Alice River")
    x.a.toggleFriends()
    local field=editors(x)[1]
    field:SetText("Bob"); click(x,"Add trusted friend"); eq(x.a.count(x.a.store.friends),0)
    field:SetText("Bob Stone"); field.scripts.OnEnterPressed(field); eq(x.a.count(x.a.store.friends),1)
    findWidget(x,"FontString","Alice River")
    click(x,"Remove"); eq(x.a.count(x.a.store.friends),1)
    click(x,"Confirm"); eq(x.a.count(x.a.store.friends),0)
end)

test("Alerts controls update existing settings and preview respects sound",function()
    local x=boot("Alice River")
    x.a.toggle(); click(x,"Alerts")
    local c=findWidget(x,"CheckButton",nil,function(w) return w.y==81 end)
    c:SetChecked(false); c.scripts.OnClick(c); eq(x.a.store.settings.sound,false)
    local slider=findWidget(x,"Slider")
    slider:SetValue(90); eq(x.a.store.settings.cooldown,90)
    click(x,"Preview alert"); eq(#x.sounds,0)
    c:SetChecked(true); c.scripts.OnClick(c)
    click(x,"Preview alert"); eq(#x.sounds,1)
end)

test("Window scales to narrow and short screens",function()
    local x=boot("Alice River",nil,function(env)
        env.UIParent.GetWidth=function() return 640 end
        env.UIParent.GetHeight=function() return 480 end
    end)
    x.a.toggle(); local window=x.env.ForeverVendettaWindow
    check(window.width*window.scale<=600); check(window.height*window.scale<=440)
end)

print("Passed " .. passed .. " Forever Vendetta regression tests.")

