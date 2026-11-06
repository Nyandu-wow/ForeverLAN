"""Release queue lifecycle regressions; all state is generated in Lua fixtures."""
import json
import unittest
from lua_harness import boot, event


class QueueLifecycleTests(unittest.TestCase):
    def test_duplicate_roster_callback_burst_does_not_flood_queue(self):
        lua, env = boot()
        for _ in range(100): env.emitPartyRoster('GROUP_ROSTER_UPDATE')
        rows = [env.pending[i] for i in range(1, len(env.pending)+1)]
        self.assertEqual(sum(row.type == 'PARTY_ROSTER' for row in rows), 1)
        lua.execute('function UnitLevel() return 11 end')
        env.emitPartyRoster('GROUP_ROSTER_UPDATE')
        rows = [env.pending[i] for i in range(1, len(env.pending)+1)]
        self.assertEqual(sum(row.type == 'PARTY_ROSTER' for row in rows), 2)
        self.assertTrue(any(row.type == 'PLAYER_LEVEL_CHANGED' for row in rows))

    def test_receipt_bridge_does_not_delete_saved_or_unsaved_rows(self):
        lua, env = boot()
        first = event(lua, env)
        second = event(lua, env)
        env.saveForCollector()
        unsaved = event(lua, env)
        lua.globals().ForeverLAN_ReceiptBridge = lua.table_from({'version': 1, 'ids': lua.table_from({first.id: True, unsaved.id: True, 'other-character': True})})
        self.assertEqual(env.retireHostReceipts(), 0)
        self.assertEqual(len(env.pending), 3)
        self.assertEqual(env.pending[1].id, first.id)
        self.assertEqual(env.pending[2].id, second.id)
        self.assertEqual(env.pending[3].id, unsaved.id)
        self.assertEqual(env.seq, 3)
        env.saveForCollector()
        lua, env = boot(lua.globals().savedVariables())
        self.assertEqual(len(env.pending), 3)

    def test_pressure_reminder_counts_unsaved_not_history(self):
        lua, env = boot()
        for _ in range(1301):
            event(lua, env)
        env.saveForCollector()
        lua.execute('messages = {}; DEFAULT_CHAT_FRAME.AddMessage = function(_, msg) messages[#messages+1] = msg end')
        env.enteredWorld = True
        env.lastQueueCapRemindAt = 0
        event(lua, env)
        self.assertEqual(len(lua.globals().messages), 0)
        self.assertEqual(env.summarizePendingForPush()[:3], (1, 1301, 1302))
        self.assertEqual(env.pendingCountForButton(), 1)

    def test_existing_drop_diagnostic_and_sequence_are_preserved(self):
        lua, env = boot()
        env.charStore().dropped_total = 42
        for _ in range(1600):
            event(lua, env)
        env.saveForCollector()
        lua, env = boot(lua.globals().savedVariables())
        self.assertEqual(env.charStore().dropped_total, 42)
        self.assertEqual(len(env.pending), 1600)
        self.assertEqual(env.seq, 1600)
        event(lua, env)
        self.assertEqual(env.seq, 1601)

    def test_saved_history_cannot_evict_new_gameplay(self):
        lua, env = boot()
        seen = set()
        for batch in range(15):
            for _ in range(100):
                seen.add(event(lua, env, "PARTY_ROSTER").id)
            env.saveForCollector()
            lua, env = boot(lua.globals().savedVariables())
        before_seq = env.seq
        for kind in ["PLAYER_CRAFT", "PLAYER_LOCATION", "PLAYER_XP_SNAPSHOT",
                     "PLAYER_QUEST_PROGRESS", "PLAYER_PROFESSIONS", "PLAYER_COMBAT_TIME"]:
            seen.add(event(lua, env, kind).id)
        env.saveForCollector()
        rows = json.loads(env.charStore().export.split("|", 1)[1])["events"]
        self.assertEqual({row["id"] for row in rows}, seen)
        self.assertEqual(env.seq, before_seq + 6)
        self.assertEqual(env.charStore().dropped_total or 0, 0)

    def test_offline_repeated_push_reload_preserves_3000_events(self):
        lua, env = boot()
        ids = set()
        for batch in range(30):
            for _ in range(100):
                ids.add(event(lua, env, spell="Fixture bandage").id)
            self.assertEqual(env.summarizePendingForPush()[0], 100)
            env.saveForCollector()
            self.assertEqual(env.summarizePendingForPush()[0], 0)
            lua, env = boot(lua.globals().savedVariables())
        self.assertEqual(len(ids), 3000)
        self.assertEqual(len(env.pending), 3000)
        self.assertEqual(env.seq, 3000)
        self.assertEqual({env.pending[i].id for i in range(1, 3001)}, ids)
        self.assertEqual(env.charStore().dropped_total or 0, 0)


if __name__ == "__main__":
    unittest.main()
