"""Pre-launch tuning uses client observations, without fixed class/quest budgets."""
import unittest
from lua_harness import boot


class NovemberUpdateTests(unittest.TestCase):
    def test_variable_quest_xp_and_level_rollover_use_observed_values(self):
        lua, env = boot()
        lua.execute('''
xp, xpMax, level = 5, 400, 10
function UnitXP() return xp end
function UnitXPMax() return xpMax end
function UnitLevel() return level end
''')
        env.playerGUID = lua.globals().mockGUID
        env.enteredWorld = True
        env.observePlayerXP('baseline', True)
        lua.globals().xp = 280
        env.observePlayerXP('quest_reward', True)
        self.assertEqual(env.charStore().xp_tracker.observed, 275)
        lua.execute('xp, xpMax, level = 40, 600, 11')
        env.observePlayerXP('quest_reward_rollover', True)
        self.assertEqual(env.charStore().xp_tracker.observed, 435)

    def test_changed_combat_power_does_not_depend_on_talent_names_or_positions(self):
        lua, env = boot()
        lua.execute('''
function GetTalentInfo() error('talent layout must not be inferred') end
function GetSpellInfo() error('spell names must not determine power') end
baseAP, positiveAP, negativeAP = 80, 20, -5
function UnitAttackPower() return baseAP, positiveAP, negativeAP end
''')
        self.assertEqual(env.readCombatPower().attack_power, 95)
        lua.execute('baseAP, positiveAP, negativeAP = 150, 30, -10')
        self.assertEqual(env.readCombatPower().attack_power, 170)

    def test_quest_log_reordering_and_readiness_do_not_invent_completions(self):
        lua, env = boot()
        env.playerGUID = lua.globals().mockGUID
        lua.execute('''
completed = { [100] = true }
function GetQuestsCompleted() return completed end
function GetNumQuestLogEntries() return 2 end
function GetQuestLogTitle(i)
  if i == 1 then return 'Zone header', nil, nil, true end
  return 'An available quest', 15, nil, false, nil, nil
end
''')
        env.observeQuestProgress(env.readQuestProgress(), 'baseline', True)
        lua.execute('''
function GetQuestLogTitle(i)
  if i == 2 then return 'Changed zone header', nil, nil, true end
  return 'An available quest', 16, nil, false, nil, 1
end
''')
        ready = env.readQuestProgress()
        self.assertEqual(ready.ready_to_turn_in, 1)
        env.observeQuestProgress(ready, 'quest_log_reordered', True)
        self.assertEqual(env.charStore().quest_tracker.observed, 0)
        lua.execute('completed[101] = true')
        env.observeQuestProgress(env.readQuestProgress(), 'quest_turned_in', True)
        self.assertEqual(env.charStore().quest_tracker.observed, 1)


if __name__ == '__main__':
    unittest.main()
