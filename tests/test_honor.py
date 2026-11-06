import unittest
from lua_harness import boot


class HonorTests(unittest.TestCase):
    def setup_honor(self):
        lua, env = boot()
        lua.execute('COMBATLOG_HONORGAIN = "%s dies, honorable kill Rank: %s (Estimated Honor Points: %d)"')
        return lua, env

    def test_confirmed_credit_only_and_duplicate_chat_line(self):
        lua, env = self.setup_honor()
        self.assertFalse(env.handleHonorCredit('You have been awarded 100 honor.', 1))
        self.assertFalse(env.handleHonorCredit('Enemy dies, dishonorable kill.', 2))
        text = 'Enemy dies, honorable kill Rank: Scout (Estimated Honor Points: 10)'
        self.assertTrue(env.handleHonorCredit(text, 3))
        self.assertFalse(env.handleHonorCredit(text, 3))
        self.assertTrue(env.handleHonorCredit(text, 4))
        self.assertEqual(env.charStore().honor_tracker.observed, 2)
        self.assertEqual(len(env.pending), 1)
        self.assertEqual(env.pending[1].hk_observed, 2)

    def test_reload_and_saved_ids_are_immutable(self):
        lua, env = self.setup_honor()
        text = 'Enemy dies, honorable kill Rank: Scout (Estimated Honor Points: 10)'
        env.handleHonorCredit(text, 1)
        first = env.pending[1].id
        env.saveForCollector()
        lua, env = boot(lua.globals().savedVariables())
        lua.execute('COMBATLOG_HONORGAIN = "%s dies, honorable kill Rank: %s (Estimated Honor Points: %d)"')
        env.handleHonorCredit(text, 2)
        self.assertEqual(env.pending[1].id, first)
        self.assertEqual(env.pending[1].hk_observed, 1)
        self.assertEqual(env.pending[2].hk_observed, 2)
        self.assertNotEqual(first, env.pending[2].id)

    def test_localized_format_and_missing_identity_or_template(self):
        lua, env = self.setup_honor()
        lua.execute('COMBATLOG_HONORGAIN = "%1$s besiegt (%3$d Ehre), Rang %2$s."')
        self.assertTrue(env.handleHonorCredit('Gegner besiegt (10 Ehre), Rang Scout.', 1))
        lua.execute('COMBATLOG_HONORGAIN = nil')
        self.assertFalse(env.handleHonorCredit('Anything dies, honorable kill', 2))
        lua.execute('COMBATLOG_HONORGAIN = "%s HK (%d)"')
        env.snapshotUnit = lua.eval('function() return {} end')
        self.assertFalse(env.handleHonorCredit('Enemy HK (10)', 3))

    def test_frame_wiring_and_separate_character(self):
        lua, env = self.setup_honor()
        args = ['Enemy dies, honorable kill Rank: Scout (Estimated Honor Points: 10)'] + ['']*9 + [100]
        env.frame.scripts.OnEvent(env.frame, 'CHAT_MSG_COMBAT_HONOR_GAIN', *args)
        self.assertEqual(env.charStore().honor_tracker.observed, 1)
        lua.globals().mockGUID = 'Player-OTHER'
        env.handleHonorCredit(args[0], 101)
        self.assertEqual(env.charStore().honor_tracker.observed, 1)
        self.assertEqual(env.pending[2].guid, 'Player-OTHER')
