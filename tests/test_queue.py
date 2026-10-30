"""Regression checks execute real Lua, including UI/event wiring and SV reloads."""
import json
import unittest
from lua_harness import boot, event


def exported(env):
    return json.loads(env.charStore().export.split("|", 1)[1])["events"]


class QueueTests(unittest.TestCase):
    def test_quest_snapshot_waits_for_identity(self):
        lua, env = boot()
        original = env.snapshotUnit
        env.snapshotUnit = lua.eval('function() return {} end')
        progress = lua.table_from({'completed_ids': lua.table_from({1: True}), 'in_log': 2, 'ready_to_turn_in': 0})
        env.observeQuestProgress(progress, 'test', True)
        env.saveForCollector()
        self.assertFalse(any(row['type'] == 'PLAYER_QUEST_PROGRESS' for row in exported(env)))
        env.snapshotUnit = original
        env.observeQuestProgress(progress, 'test', True)
        env.saveForCollector()
        rows = [row for row in exported(env) if row['type'] == 'PLAYER_QUEST_PROGRESS']
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['guid'] and rows[0]['character'])

    def test_loot_link_formats_and_uncached_items(self):
        for prefix, expected in [("|cffa335ee", "PLAYER_LOOT_EPIC"),
                                 ("|cnIQ4:", "PLAYER_LOOT_EPIC"),
                                 ("|cff0070dd", "PLAYER_LOOT_RARE"),
                                 ("|cnIQ3:", "PLAYER_LOOT_RARE")]:
            with self.subTest(prefix=prefix):
                lua, env = boot()
                message = "You receive loot: " + prefix + "|Hitem:123:0:0|h[Ring of Spell Power]|h|r."
                env.frame.scripts.OnEvent(env.frame, "CHAT_MSG_LOOT", message)
                env.saveForCollector()
                rows = [row for row in exported(env) if row["type"] == expected]
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["item_id"], 123)
                self.assertEqual(rows[0]["item_name"], "Ring of Spell Power")

    def test_loot_does_not_count_other_players_or_unknown_quality(self):
        lua, env = boot()
        for msg in ["Sam receives loot: |cnIQ4:|Hitem:123|h[Ring]|h|r.",
                    "You receive loot: |cnIQ2:|Hitem:123|h[Ring]|h|r.",
                    "You receive loot: |Hitem:123|h[Ring]|h."]:
            env.handleLootChat(msg)
        env.saveForCollector()
        self.assertFalse(any(row["type"].startswith("PLAYER_LOOT") for row in exported(env)))

    def test_loot_item_api_failure_uses_explicit_link_quality(self):
        lua, env = boot()
        lua.execute("function GetItemInfo() error('unavailable') end")
        env.handleLootChat("You receive item: |cnIQ4:|Hitem:456|h[Arcane Bindings]|h|r.")
        env.saveForCollector()
        self.assertTrue(any(row["type"] == "PLAYER_LOOT_EPIC" for row in exported(env)))

    def test_offline_collector_survives_repeated_disk_saves(self):
        lua, env = boot()
        craft = event(lua, env, spell="Bandage")
        location = event(lua, env, "PLAYER_LOCATION", zone="Elwynn Forest", subzone="Goldshire")
        original = {craft.id, location.id}
        env.saveForCollector()
        saved = lua.globals().savedVariables()
        # Collector never reads the first disk image. A full new Lua VM models reload.
        for _ in range(3):
            lua, env = boot(saved)
            lua.globals().clock += 20
            event(lua, env, "PING")  # New play invalidates the previous export.
            env.saveForCollector()
            saved = lua.globals().savedVariables()
            self.assertTrue(original <= {row["id"] for row in exported(env)})
            self.assertEqual(env.charStore().dropped_total or 0, 0)

    def test_same_second_events_are_unsaved_in_summary_and_pin(self):
        lua, env = boot()
        event(lua, env)
        env.saveForCollector()
        self.assertTrue(env.pendingFullyFlushedToDisk())
        event(lua, env)  # Same second as save, different id.
        self.assertFalse(env.pendingFullyFlushedToDisk())
        self.assertEqual(env.summarizePendingForPush()[0], 1)
        self.assertEqual(env.pendingCountForButton(), 1)
        env.saveForCollector()
        self.assertEqual(env.pendingCountForButton(), 0)
        lua, env = boot(lua.globals().savedVariables())
        self.assertTrue(env.pendingFullyFlushedToDisk())
        self.assertEqual(env.pendingCountForButton(), 0)

    def test_coalescing_never_mutates_a_saved_id(self):
        lua, env = boot()
        first = event(lua, env, "PLAYER_DISTANCE", distance_yards=100)
        env.saveForCollector()
        second = event(lua, env, "PLAYER_DISTANCE", distance_yards=200)
        self.assertNotEqual(first.id, second.id)
        updated = event(lua, env, "PLAYER_DISTANCE", distance_yards=300)
        self.assertEqual(updated.id, second.id)
        self.assertEqual(first.distance_yards, 100)
        self.assertEqual(len(env.pending), 2)

    def test_location_transitions_survive_without_push(self):
        lua, env = boot()
        env.enteredWorld = True
        env.playerGUID = lua.globals().mockGUID
        env.observePlayerLocation("login", True)
        lua.globals().clock += 11
        lua.globals().mockSubzone = "Lion's Pride Inn"
        env.observePlayerLocation("zone", False)
        lua.globals().clock += 11
        lua.globals().mockSubzone = "Goldshire"
        env.observePlayerLocation("zone", False)
        env.saveForCollector()
        self.assertEqual([row["subzone"] for row in exported(env)],
                         ["Goldshire", "Lion's Pride Inn", "Goldshire"])

    def test_saved_high_signal_rows_do_not_lose_priority_under_cap_pressure(self):
        lua, env = boot()
        high = event(lua, env, "PLAYER_DIED")
        env.saveForCollector()
        for _ in range(env.MAX_PENDING):
            event(lua, env)
        self.assertEqual(len(env.pending), env.MAX_PENDING)
        self.assertEqual(env.pending[1].id, high.id)
        self.assertEqual(env.charStore().dropped_total, 1)

    def test_legacy_saved_timestamp_is_not_a_delivery_ack(self):
        lua, env = boot()
        retained = event(lua, env)
        env.saveForCollector()
        env.charStore().last_flush_ids = None
        lua, env = boot(lua.globals().savedVariables())
        self.assertEqual(env.pending[1].id, retained.id)
        self.assertFalse(env.pendingFullyFlushedToDisk())
        env.saveForCollector()
        self.assertTrue(env.pendingFullyFlushedToDisk())

    def test_logout_handler_saves_events_added_since_push(self):
        lua, env = boot()
        retained = event(lua, env)
        env.saveForCollector()
        lua, env = boot(lua.globals().savedVariables())
        env.enteredWorld = True
        env.playerGUID = lua.globals().mockGUID
        later = event(lua, env)
        env.frame.scripts.OnEvent(env.frame, "PLAYER_LOGOUT")
        self.assertTrue({retained.id, later.id} <= {row["id"] for row in exported(env)})
        self.assertTrue(env.pendingFullyFlushedToDisk())

    def test_migration_requires_exact_identity_and_respects_guid(self):
        lua, env = boot()
        player = lua.table_from({"guid": "G1", "fullName": "Alex River", "lastName": "River", "realm": "Forever"})
        self.assertFalse(env.eventSafelyBelongsToPlayer(lua.table_from({"character": "Alex"}), player))
        self.assertFalse(env.eventSafelyBelongsToPlayer(lua.table_from({"guid": "G2", "character": "Alex River"}), player))
        self.assertTrue(env.eventSafelyBelongsToPlayer(lua.table_from({"guid": "G1", "character": "Alex River"}), player))

    def test_full_login_reload_logout_retains_original_ids(self):
        lua, env = boot()
        retained = event(lua, env)
        env.saveForCollector()
        lua, env = boot(lua.globals().savedVariables())
        handler = env.frame.scripts.OnEvent
        handler(env.frame, "PLAYER_LOGIN")
        handler(env.frame, "PLAYER_ENTERING_WORLD", False, True)
        handler(env.frame, "PLAYER_LOGOUT")
        self.assertIn(retained.id, {row["id"] for row in exported(env)})


if __name__ == "__main__":
    unittest.main()
