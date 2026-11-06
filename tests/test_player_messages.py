"""Player messages must distinguish local saves from delivery to the board."""
import unittest
from lua_harness import boot, event


class PlayerMessageTests(unittest.TestCase):
    def test_push_reports_new_entries_without_presenting_history_as_backlog(self):
        lua, env = boot()
        for _ in range(20): event(lua, env)
        env.saveForCollector()
        event(lua, env)
        new, earlier, total, breakdown = env.summarizePendingForPush()
        lines = env.buildPushReportLines(new, earlier, total, breakdown)
        text = '\n'.join(lines[i] for i in range(1, len(lines)+1))
        self.assertIn('1|r new entry.', text)
        self.assertIn('when connected', text)
        self.assertNotIn('21', text)
        for term in ['receipt', 'collector', 'snapshot', 'retained', 'unsaved: 0']:
            self.assertNotIn(term, text.lower())
        self.assertEqual(len(env.pending), 21)

    def test_empty_and_previously_saved_logs_do_not_claim_delivery(self):
        lua, env = boot()
        empty = env.buildPushReportLines(0, 0, 0, '')
        self.assertIn('No adventures to save', empty[1])
        saved = env.buildPushReportLines(0, 1301, 1301, '')
        self.assertIn('saved on this PC', saved[1])
        self.assertNotIn('1301', saved[1])

    def test_status_explains_saved_entries_are_not_waiting_uploads(self):
        lua, env = boot()
        for _ in range(2): event(lua, env)
        env.saveForCollector()
        event(lua, env)
        lua.execute('messages = {}; DEFAULT_CHAT_FRAME.AddMessage = function(_, msg) messages[#messages+1] = msg end')
        env.ui.printStatus()
        messages = lua.globals().messages
        text = '\n'.join(messages[i] for i in range(1, len(messages)+1))
        self.assertIn('1 new entry to save; 2 saved entries kept on this PC', text)
        self.assertIn('may already be on the board', text)
        self.assertIn('companion window', text)
